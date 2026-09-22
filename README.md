# PulseWatch

Uptime monitoring and incident knowledge platform. It watches your services, opens an
incident when something breaks, and shows what fixed the same problem last time — using
error fingerprinting and ranked past fixes, not an AI model, so every match is explainable.

> Status: **Phase 5 complete** — auth, services, monitors, the check worker, incidents with
> an automatic timeline, incident memory, full-text search, alerting and an ingest API. See
> [the project guide](../PulseWatch_Project_Guide.md) for the full 10-week build plan.

## How incident memory works

Two errors from the same underlying problem rarely look identical:

```
2026-09-21T10:15:32Z ERROR Timeout after 5000ms connecting to 10.0.3.17:5432 (request 8f14e45f-ceea-467f-a4a0-3b2f1c6a9d10)
2026-09-24T03:01:09Z ERROR Timeout after 3000ms connecting to 10.0.3.22:5432 (request 1b4e28ba-2fa1-11d2-883f-0016d3cca427)
```

Normalization replaces the variable parts, in a deliberate order — UUIDs, timestamps, URLs,
emails and IPs before bare numbers, because once `\d+` has run a UUID is unrecoverable.
Both messages become:

```
<ts> error timeout after <num>ms connecting to <ip>:<num> (request <uuid>)
```

That string is hashed with SHA-256 together with the error type. Same hash, same problem.
In the seed data, **26 historical incidents collapse into 12 fingerprints**.

A new incident is then ranked against past resolved ones:

| Signal | Points |
|---|---|
| Same fingerprint | 50 |
| Text similarity (`pg_trgm`, 0–1) | up to 25 |
| Same service | 15 |
| Same error type | 10 |
| Shares a tag | 5 |
| Resolved in the last 30 days | 5 |

Anything scoring 30 or more surfaces, top 5, each with the reason it matched. Candidate
selection happens in SQL; the scoring runs in TypeScript so it can be unit-tested without a
database.

Finally, the runbooks that fixed those incidents are ranked by a Laplace-smoothed success
rate, `(worked + 1) / (tried + 2)`, so a runbook that worked 1 of 1 does not outrank one
that worked 9 of 10. The result reads:

> **Seen 5 times before with the exact same error signature.**
> Suggested fixes: Restart DB connection pool — **71%**, fixed 4 of 5.

Every match is explainable, because nothing here is a model.

## Demo accounts

After `npm run db:seed`, all three use the password `pulsewatch123`:

| Email | Role | Can |
|---|---|---|
| `admin@pulsewatch.local` | admin | everything, including creating services and monitors |
| `engineer@pulsewatch.local` | engineer | acknowledge and resolve incidents (Phase 3) |
| `viewer@pulsewatch.local` | viewer | read only |

## Quick start

```bash
cp .env.example .env      # already done once
npm install
npm run db:up             # Postgres 16 + pg_trgm on :5432 (test DB on :5433)
npm run db:migrate        # create the schema
npm run dev               # api :4000 · web :5173 · worker · demo-target :4100
```

> On a machine where Docker cannot run, use `npm run pg:start` in place of `npm run db:up`.
> See [SETUP.md](SETUP.md).

Health check: <http://localhost:4000/api/health> · UI: <http://localhost:5173>

## Workspace layout

```
pulsewatch/
├── apps/
│   ├── api/           Express + TypeScript API (routes, middleware, services, lib)
│   ├── worker/        check scheduler + rollup job (separate process)
│   ├── web/           React + Vite + Tailwind frontend
│   └── demo-target/   fault-injection service you can break on purpose
├── packages/shared/   fingerprint · stateMachine · scoring (used by api + worker)
├── prisma/            schema, migrations, seed
├── docker/initdb/     Postgres bootstrap SQL (pg_trgm)
└── .github/workflows/ lint → typecheck → test → build
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | All four apps in parallel |
| `npm run dev:api` / `dev:web` / `dev:worker` / `dev:demo` | One app |
| `npm run db:up` / `db:down` | Start / stop Postgres via Docker Compose |
| `npm run db:migrate` | Apply Prisma migrations |
| `npm run db:seed` | Seed demo data |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | Project-wide TypeScript build |
| `npm run lint` / `format` | ESLint / Prettier |

## Demo target

```bash
curl -X POST http://localhost:4100/mode -H "content-type: application/json" -d "{\"mode\":\"failing\"}"
```

Modes: `healthy`, `slow` (8s response), `failing` (HTTP 503). Flip it to produce a
repeatable outage for demos and worker tests.

With the worker running and a 30s monitor interval, `failing` takes the monitor DOWN after
three consecutive failures (~90s) and `healthy` brings it back UP after two successes (~60s).

Going DOWN opens an incident automatically, with an `opened` timeline event and a severity
derived from the error type. Recovering resolves it automatically and adds a `resolved`
event. In between, an engineer can acknowledge, comment, change severity and resolve with a
note — every one of those writes to the timeline.

Note that all three seeded monitors point at the same demo target, so breaking it opens one
incident per monitor. That is the partial unique index doing its job: one active incident
per monitor, never one per service.

## Alerting

Set `DISCORD_WEBHOOK_URL` and/or `SMTP_URL` in `.env`. With neither set, PulseWatch stays
quiet. Alerts fire when an incident opens and again when it recovers, and either outcome is
recorded on the timeline as `alert_sent`.

To test alerting without a real Discord server, point it at the demo target's sink:

```
DISCORD_WEBHOOK_URL=http://localhost:4100/webhook
```

then read what was delivered:

```bash
curl http://localhost:4100/webhook
```

A failed alert never stops the worker — the incident is still opened, and the timeline says
the delivery failed.

## Reporting errors from another app

Create an API key on a service page (admin only; shown once, stored hashed), then:

```bash
curl -X POST http://localhost:4000/api/ingest/errors -H "X-Api-Key: pw_live_..." -H "content-type: application/json" -d "{\"errorType\":\"DB_TIMEOUT\",\"message\":\"Timeout after 5000ms connecting to 10.0.3.17:5432\",\"severity\":\"SEV2\"}"
```

The first report opens an incident. A second report of the *same underlying problem* —
even with different numbers, IPs or IDs — is deduplicated onto it by fingerprint and adds a
"seen again" timeline entry instead of creating a duplicate.

## Running two workers

The scheduler claims monitors with `FOR UPDATE SKIP LOCKED`, so a second worker process
never re-checks a monitor the first one already claimed:

```bash
npm run verify:skip-locked
```

Client A holds its locks in an open transaction while client B runs the identical claim
query; B returns a disjoint set immediately instead of blocking.

## Environment

All configuration lives in one root `.env` (see `.env.example`). `ALLOW_PRIVATE_MONITOR_TARGETS`
is `true` locally so monitors can reach the demo target, and **must be `false` in production** —
that flag is the SSRF guard on user-supplied monitor URLs.

## Still to come

README checklist from the guide (live link, screenshots, architecture diagram, "how incident
memory works", coverage badge, design decisions) gets filled in at Phase 8.
