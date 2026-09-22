# PulseWatch

Uptime monitoring and incident knowledge platform. It watches your services, opens an
incident when something breaks, and shows what fixed the same problem last time — using
error fingerprinting and ranked past fixes, not an AI model, so every match is explainable.

> Status: **Phase 3 complete** — auth, services, monitors, the check worker, and incidents
> with an automatic timeline. See [the project guide](../PulseWatch_Project_Guide.md) for
> the full 10-week build plan.

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
