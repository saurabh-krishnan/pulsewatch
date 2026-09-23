# Design decisions

Why things are the way they are. The guide says to keep this — it doubles as interview prep.

## Phase 0 — setup

**npm workspaces, not pnpm or Turborepo.**
Node 24 ships with npm 11, which handles workspaces fine at this size. One fewer tool to
install and explain. Revisit only if builds get slow.

**`@pulsewatch/shared` exports TypeScript source, not a compiled `dist`.**
`"exports": "./src/index.ts"` means `tsx` and Vite transpile it on the fly, so there is no
build step between editing `fingerprint.ts` and seeing it work in the API. Trade-off: the
Phase 8 production Docker build has to bundle (esbuild/tsup) or compile the package first,
because Node cannot `import` a `.ts` file from compiled output.

**Local Postgres runs from a portable install, not Docker.**
Docker Desktop cannot start on this machine: Windows 11 Home has no Hyper-V, so WSL2 is the
only backend, and the WSL installation is corrupted at the OS level. Rather than let that
block the project, local development uses the official Postgres 16.10 binaries extracted to
`%USERPROFILE%\pgsql` (`npm run pg:start` / `pg:stop`). Identical version, port and
connection string, so no application code knows the difference, and `docker-compose.yml`
stays correct for CI and Phase 8. The trade-off is that the compose file is unverified on
this machine — worth testing before relying on it for deployment.

**Two Postgres databases: `pulsewatch` and `pulsewatch_test` (containers `db`/`db-test` in compose).**
Phase 7 wants API integration tests against a real database. Keeping the test database
separate means tests can truncate tables without destroying dev data.

**`pg_trgm` is created in `docker/initdb/01-extensions.sql` *and* in the migration.**
The init script only runs on a fresh volume, so a teammate who already has a volume, or a
hosted database like Neon, still needs it from the migration. Belt and braces; it is
`CREATE EXTENSION IF NOT EXISTS`, so it is harmless twice.

**Raw SQL lives in `prisma/sql/init-extras.sql` and gets pasted into the init migration.**
Prisma's schema language cannot express the generated `tsvector` column, the GIN indexes,
the partial unique index on `incidents(monitor_id)`, or the `CHECK` constraints. Rather than
lose them, the workflow is `prisma migrate dev --create-only`, append the SQL, then apply.

**The state machine, fingerprinting and scoring are pure functions in `packages/shared`.**
No database, no network, no clock. That is what makes the 90% coverage target in Phase 7
realistic, and these three files are the parts of the project worth defending in an interview.

**`ALLOW_PRIVATE_MONITOR_TARGETS` defaults to `false` in code, `true` in local `.env`.**
The default has to be the safe one: a user-supplied monitor URL pointing at `169.254.169.254`
or `10.0.0.0/8` turns the worker into an SSRF proxy for the internal network. Local
development needs the exception so monitors can reach `localhost:4100`.

**Vite proxies `/api` to `:4000` in development.**
The frontend always calls a relative `/api`, so the same code works in production where the
API serves the React build from one origin. CORS config still exists for the case where they
are deployed separately.

## Phase 1 — auth and services

**`@pulsewatch/shared` has two entry points, and `fingerprint.ts` is not in the root one.**
The web app imports the shared Zod schemas, so anything the root `index.ts` re-exports ends
up in the browser bundle. `fingerprint.ts` imports `node:crypto`, which would break that
build. The root entry is browser-safe; the API and worker import hashing from
`@pulsewatch/shared/fingerprint`.

**Zod schemas live in `shared`, not in the API.**
One definition validates the request on the server and the form on the client, so the two
cannot drift. The server still validates independently — the client schema is a convenience,
never the security boundary.

**The first registered account becomes `admin`, everyone after is `engineer`.**
A fresh install needs some way to get an admin without a chicken-and-egg problem. The
alternative — an env var listing admin emails — is more configuration for no benefit at this
size.

**Login says "Email or password is incorrect" for both cases.** Distinct messages would let
someone enumerate which emails have accounts.

> **Correction (Phase 7):** this entry originally also said login "hashes even when the
> user does not exist". It did not — the Phase 1 code skipped bcrypt for an unknown email,
> so those requests answered ~50ms faster and the timing revealed which emails were real,
> despite the identical message. Fixed in Phase 7; see "Login runs bcrypt for unknown
> emails" below, which also covers the test that would have caught it.

**Only `paused` and `unknown` can be set on a monitor through the API.**
`up` and `down` belong to the worker's state machine. Accepting them over HTTP would let a
user contradict what the checks actually observed, and the recorded history would lie.
Resuming sets `nextCheckAt = now()` so it checks promptly instead of waiting out the old
schedule.

**Deleting a service is blocked when incidents reference it.**
Monitors cascade, because a monitor without its service is meaningless. Incidents do not:
outage history is the point of the product, and it should not disappear because someone
tidied up a service list. The foreign key uses `ON DELETE RESTRICT` and the API turns that
into a 409 with a count.

## Phase 2 — the worker

**The claim query advances `next_check_at` in the same statement that selects the rows.**
Claiming and rescheduling as one `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)`
means a monitor cannot be picked up twice, even by a second worker running concurrently.
`npm run verify:skip-locked` proves it: client A holds the locks in an open transaction while
client B runs the identical claim and gets an empty set in ~40ms rather than blocking.

The cost is that a monitor whose worker crashes mid-cycle is skipped for one interval — its
next check was already scheduled. That is the right trade: a missed check is recoverable, a
double-counted failure would corrupt the state machine's thresholds.

**`last_checked_at` is set when the check is claimed, not when it finishes.**
It means "we have started looking at this", which keeps it honest if the process dies
mid-check. The `check_results` row carries the authoritative timing.

**The check result and the monitor state update share one transaction.**
Otherwise a crash between them could leave `consecutive_failures` disagreeing with the
recorded history, and the state machine would make its next decision on a number that no
sequence of checks could have produced.

**Checker error messages are deliberately templated.**
`Timeout after 5000ms connecting to localhost:4100` and `HTTP 503 Service Unavailable` keep
identical wording with only the values varying, because Phase 4 fingerprints them. A message
that rephrases itself would defeat the grouping before it starts. A unit test pins the
timeout template for that reason.

**Errors are classified into `ErrorType` at check time, not at incident time.**
The worker has the exception object with its `cause.code`; by the time an incident is opened
that context is gone. Classifying early gives fingerprinting a clean `errorType|message` key.

**One failing monitor cannot fail the cycle, and one failing cycle cannot kill the worker.**
Both are wrapped. An uptime monitor that stops monitoring because one URL misbehaved is
worse than useless, because it looks like everything is fine.

## Phase 3 — incidents

**An incident and its first timeline event are written in one transaction.**
An incident with no `opened` event would be a hole in exactly the history this product
exists to keep. The same applies to acknowledge, resolve and severity changes: every state
change writes its timeline entry in the same transaction that makes the change.

**The duplicate-incident race is handled by the database, not by checking first.**
`openIncident` just inserts. If another worker got there first, the partial unique index
`incidents(monitor_id) WHERE status <> 'resolved'` raises a unique violation, and Prisma's
`P2002` is treated as "already open" rather than an error. A read-then-write check would
still have a window between the read and the write; the constraint has none.

Verified directly: a second active incident for the same monitor is rejected, while a
*resolved* one is accepted — so history is never blocked, only concurrent duplicates.

**Severity is auto-assigned coarsely, and any human change is logged.**
Failures that mean "nobody can reach this" (timeout, connection refused, DNS, TLS, 5xx)
open at SEV2; anything else at SEV3. It is a starting point, not a judgement: an engineer
adjusts it from the UI and that adjustment appears in the timeline as `severity_changed`
with the before and after.

**State transitions are guarded, but comments are not.**
Acknowledging twice or resolving twice returns 409 — those are mistakes worth surfacing.
Commenting on a resolved incident is allowed on purpose: the postmortem conversation
usually happens after the fire is out.

**Known gap: manually resolving an incident while its monitor is still down.**
The state machine only fires `open_incident` on the transition into DOWN, so no new
incident appears until the monitor recovers and fails again. That is the correct behaviour
for a machine with no memory of manual actions, but it does mean a premature manual resolve
leaves an ongoing outage without an active incident. Worth revisiting if it bites.

## Phase 4 — incident memory

**`@pulsewatch/shared` gained a second entry point specifically so the browser never sees
`node:crypto`.** Fingerprinting is imported as `@pulsewatch/shared/fingerprint` by the API,
worker and seed; the root entry stays browser-safe for the Zod schemas the forms use.

**Normalization order is the whole trick, and the tests pin it.**
UUIDs, timestamps, URLs, emails and IPs are replaced before the generic `\d+` rule, because
once bare numbers are substituted a UUID is an unrecoverable mess of `<num>` fragments.
Three tests assert exactly that ordering rather than just the final output, so a future
tidy-up of the rules cannot silently break grouping.

Proof it works: the seed's 26 historical incidents collapse into 12 fingerprints (27 from
Phase 8, when a third 503 was added for the live demo — still 12 fingerprints). The five
pool-exhaustion incidents differ in connection counts and wait times, and the four database
timeouts differ in timestamp, IP, port and request UUID — each family becomes one hash.

**The fingerprint upsert runs before the incident insert, and outside its transaction.**
An occurrence happened whether or not this worker wins the race to create the incident, so
the count should reflect it. The upsert is a single `ON CONFLICT DO UPDATE`, so two workers
seeing the same error both increment instead of one overwriting the other.

**Manual incidents are fingerprinted too, on `description` or failing that `title`.**
It means a hand-raised incident can match a past machine-detected one. The error type
defaults to `MANUAL` so a human's phrasing never collides with a real `TIMEOUT` group.

**Candidate selection in SQL, scoring in TypeScript.**
The SQL narrows to ~100 rows using the fingerprint, the service, or a trigram similarity
above 0.3 — the part that needs indexes. The weighting then runs in plain TypeScript, where
it is unit-tested against the guide's worked examples without a database anywhere near it.

**Same service plus same error type scores 25, below the cutoff of 30, on purpose.**
That combination describes half the history of a busy service. Without text agreement it is
not a memory, it is noise. A test documents the boundary: the pair needs a similarity of at
least 0.2 to surface. An exact fingerprint match alone always clears the bar.

**Suggestions are computed over the top 5 similar incidents, not all history.**
This makes the evidence a sliding window, which is subtle in practice: resolving a new
incident can add a success while an older one drops out of the window, leaving the ratio
apparently unchanged. Observed exactly that during testing — "restart the pool" stayed at
4 of 5 because the incident that fell out had also succeeded. Correct, but worth knowing
before trusting a ratio that did not move.

**Every resolution records what was tried, including what failed.**
The resolve dialog offers "not tried / tried / worked / did not" per runbook, and only the
touched ones are sent. Failures are the more valuable signal: without them a runbook that
never works keeps its perfect record, because nobody logs the attempts that did nothing.

## Phase 5 — search, alerts and ingest

**Incidents use a stored `tsvector`; runbooks use an expression index.**
Incidents are written constantly and searched constantly, so the generated column earns its
keep. Runbooks are a small, rarely-written table, so
`gin (to_tsvector('english', title || ' ' || body_md))` is enough and avoids another
generated column. The `'english'` config has to be spelled out as a constant, because
`to_tsvector` is only `IMMUTABLE` — and therefore only indexable — when it is.

**`plainto_tsquery`, not `to_tsquery`.**
`to_tsquery` would make a user typing `timeout & !pool` hit a syntax error instead of a
search. `plainto_tsquery` treats the input as words.

**Full-text falls back to trigram matching when it finds nothing.**
Stemming handles "restarting" against "restarted", but it cannot rescue a typo. When the
tsvector query returns no rows, the search retries against `similarity(title, q) > 0.25`
and the response says `fuzzy: true` so the UI can explain itself. Verified: "databse
timeuts" finds six incidents this way and none without it.

**`ts_headline` output is parsed, not injected.**
Postgres returns snippets with `<b>` around the matches. Rendering that with
`dangerouslySetInnerHTML` would work, and would be a habit worth not forming — the markers
are split out and turned into real `<mark>` elements instead.

**A failed alert can never fail a cycle, and is never silent either.**
Every channel is wrapped individually, failures are logged, and the incident timeline
records what actually happened: "Sent to Discord", or "No alert delivered — failed:
Discord". Verified by pointing the webhook at a dead port: the incident still opened, the
timeline said the alert failed, and the worker kept checking. A monitoring system that
stops monitoring because Discord is down is worse than one with no alerting, because it
looks healthy.

Discord requests also carry a 5s `AbortController` timeout, since a loaded webhook endpoint
tends to hang rather than refuse.

**The demo target doubles as a webhook sink.**
`POST /webhook` on the demo target captures payloads and `GET /webhook` returns them, so
alerting can be tested end to end without a real Discord server or putting someone's
webhook URL in a repo.

**API keys are hashed with plain SHA-256 and no salt.**
Unlike a password, the key is already 24 random bytes from `randomBytes`, so there is
nothing to brute-force and no rainbow table to defeat; a slow KDF would only add latency to
every ingest request. Only the hash and a 14-character prefix are stored, the full key is
returned exactly once, and revoking sets `revoked_at` rather than deleting so the audit
trail survives. A revoked key and a nonexistent key return the same error.

**Ingest deduplicates on fingerprint, not on message.**
Two reports of the same failure with different connection counts or IPs normalize to one
fingerprint, so the second attaches a "seen again" event to the open incident instead of
opening a duplicate. Verified: `Timeout after 5000ms connecting to 10.0.9.11:5432` and
`Timeout after 3000ms connecting to 10.0.9.57:5432` landed on the same incident.

The `P2002` fallback is there for two reports racing: the loser looks up the winner's
incident and attaches to it rather than returning an error to a client that did nothing
wrong.

**Ingest is rate limited per API key, not per IP.**
An SDK retrying during an outage comes from one host but many keys, or one key and many
hosts. The key is the thing worth limiting.

## Phase 6 — dashboard, status page, postmortems

**The rollup recomputes a 3-day window instead of updating incrementally.**
Today's row is still accumulating, so it has to be rewritten anyway, and recomputing is
idempotent: running the job twice, or after a crash mid-run, cannot double-count. Days
older than the window are already final and are never touched again.

**Real rollup data overwrites seeded history, deliberately.**
The seed backfills 90 days of `uptime_daily` so a fresh install has a presentable status
page. The rollup then overwrites any of those days that have real `check_results`. Real
measurements should beat fiction, and it means a demo install gradually becomes a real one
rather than keeping a pretty lie at the front of the chart.

**`make_interval(days => $1::int)` — the cast is not optional.**
Prisma sends JS numbers as `bigint`, and Postgres has no `make_interval(days => bigint)`
overload, so the uncast version fails at runtime with `42883`. It is worth knowing that a
`PREPARE` test in psql does *not* reproduce this: psql infers `int` on its own, so the
statement looks fine there and fails only through Prisma.

This was found because the failure was invisible: the worker's rollup is wrapped in a
`catch` (housekeeping must never stop monitoring), so it logged and carried on while
`uptime_daily` silently kept its seeded values. The `catch` is right; not having a way to
run the job on demand was not. Hence `npm run rollup -w @pulsewatch/worker`, which runs it
once in the foreground and reports what it did.

**The rollup runs on the worker's existing loop, not a cron.**
One process, one shutdown path, no second scheduler to reason about. It checks the elapsed
time each cycle and runs at most hourly.

**MTTR and MTTA cover 30 days, not all time.**
A lifetime average is dominated by whatever happened at the beginning of the project and
stops reflecting how the team is doing now.

**The repeat rate is counted over fingerprinted incidents only.**
Incidents created before fingerprinting existed have no fingerprint, and including them
would drag the rate down for a reason that has nothing to do with repeats.

**The public status page exposes nothing but names, status and daily percentages.**
No monitor URLs, no error text, no incident titles, no severities. Verified by asserting
the response body contains neither the monitor URL nor any error string. It reads
`uptime_daily`, so a customer refreshing the page costs 90 small rows per monitor rather
than a scan of every check ever recorded.

**The postmortem fills in facts and leaves judgement blank.**
Timeline, duration, severity, who acknowledged, which runbook worked, linked commits — all
derived. Root cause, what went well, and action items stay `_(fill in)_`, because a
template that guesses at root cause is worse than one that asks. If the incident's
fingerprint has been seen before, the document says so and asks whether the cause or only
the symptom is being treated.

## Phase 7 — testing and security

**SSRF is defended in three layers, and only the last one is real enforcement.**
1. The API checks a monitor URL when it is saved (create *and* edit — checking only on
   create would make `PATCH` the way around it), so the mistake gets a clear 400.
2. The worker checks again before every request, because DNS answers change over time.
3. The worker's socket resolves hostnames through `createGuardedLookup`, which checks the
   address actually being connected to. That is what stops DNS rebinding: a hostname that
   resolved to a public address during checks 1 and 2 and a private one a millisecond later.

Checks 1 and 2 alone leave a time-of-check/time-of-use gap; check 3 closes it. The API
deliberately allows a hostname that does not resolve yet, because nothing can be reached
through it today and check 3 will judge whatever it resolves to later.

**The address rules are strict parsers, not regexes over the URL.**
`new URL()` canonicalizes `http://2130706433/`, `http://0x7f000001/`, `http://0177.0.0.1/`
and `http://127.1/` to `127.0.0.1` before the check runs, so each is caught as loopback.
The tests prove the normalization rather than assume it: if it did not happen, those hosts
would fall through to DNS, fail to resolve, and be *allowed* — and the tests would fail.
IPv6 addresses carrying an IPv4 address (`::ffff:169.254.169.254`, NAT64, 6to4) are judged
by the IPv4 inside them. Beyond the ranges the guide lists, CGNAT, multicast, benchmarking
and reserved space are blocked too.

**The checker moved from `fetch` to `http.request`.** `fetch` has no supported hook for the
connection's DNS lookup; `http.request` takes a `lookup` option, which is where check 3 lives.

**Checks never reuse a connection (`agent: false`).** Found by a test, not by design: Node
19+ makes the global HTTP agent keep-alive by default, and a request that reuses a pooled
socket skips DNS entirely — so the guarded lookup never ran and a strict-policy request went
straight through a socket a permissive one had opened. In production the policy is fixed per
process, so that exact case could not occur, but it made the security check depend on
connection history. It was also a monitoring bug in its own right: a warm socket hides DNS,
TCP and TLS time from the measurement, and a server that has stopped accepting *new*
connections still looks healthy over an old one.

**Redirects are not followed.** A public URL answering `302 Location: http://169.254.169.254/`
would otherwise bounce the worker inward. The monitor reports the 302 instead.

**Credentials in monitor URLs are refused.** They would be stored in plain text and printed
in the worker's log lines, and `http://trusted@169.254.169.254` is a classic disguise.

**Login runs bcrypt for unknown emails.** It compares against a fixed hash computed at
startup, so "no such user" costs the same as "wrong password". The test spies on
`bcrypt.compare` and asserts it runs for an unknown email; temporarily reverting to the
Phase 1 code makes that test fail with "expected 1 call, got 0", which is the proof it
guards the right thing. A timing assertion would have been flaky on shared CI runners.

**Unsafe production settings refuse to boot rather than warn.** In production the API exits
if `JWT_SECRET` is a known placeholder or shorter than 32 characters, and both the API and
worker exit if `ALLOW_PRIVATE_MONITOR_TARGETS=true`. A specific internal host belongs in
`MONITOR_HOST_ALLOWLIST` instead. A warning scrolls past in a deploy log; a failed deploy
does not.

**Malformed request bodies are the client's fault, and now say so.** `express.json()` throws
for invalid JSON or an oversized body, and those errors used to fall through to the generic
500. They now return 400 `INVALID_JSON` and 413 `PAYLOAD_TOO_LARGE`.

**Registration is rate limited too.** It was the one unthrottled write reachable without an
account, and it has to reveal whether an email is taken to be usable.

**An expired session redirects to login.** With a one-hour JWT, sessions end mid-use; the
UI used to show a page of errors. A 401 from any non-`/auth` route now drops the token and
redirects, with `?next=` restricted to same-site paths so it cannot become an open redirect.

**API tests run against a real Postgres, one file at a time, and cannot touch dev data.**
Each file truncates every table, so the files run sequentially. Before migrating and before
every reset, the suite checks that the database name ends in `_test` and refuses otherwise —
verified by pointing it at the dev database, which it refused while leaving it untouched.
The environment is set in a setup file that deliberately imports nothing from the app,
because ES imports are hoisted and would parse the config before the overrides applied.

**Every fix in this phase was mutation-tested.** Passing on the first run proves little, so
each security fix was temporarily reverted to confirm its test fails: the timing fix, the
malformed-JSON 400, the oversized-body 413, and the SSRF check on `PATCH`.

**E2E runs a separate copy of the whole stack.** Playwright starts the API, worker, demo
target and web on ports shifted by 10, against the test database, so it never collides with
a running dev stack. The outage test is genuinely end to end — the incident appears because
the real worker checked the real demo target and saw it fail. Locally it drives the Edge that
ships with Windows, avoiding a browser download; CI installs Chromium.

## Phase 8 — deployment

**Production runs esbuild bundles, which settles the Phase 0 trade-off.** `@pulsewatch/shared`
exports TypeScript source, which Node cannot import. Rather than add a compile step to the
package and teach every tool about it, each Node process is bundled into one CommonJS file
that contains the shared code. Development is untouched. CommonJS rather than ESM because
the server code uses neither `import.meta` nor top-level `await`, and it avoids the
`require()` shim an ESM bundle of CommonJS dependencies needs.

**The runtime image holds only Prisma in `node_modules`.** Every other dependency is inside
the bundles. Prisma stays external because its generated client and native query engine must
live in `node_modules`, and its CLI applies migrations at start-up. The build and runtime
stages use the same Debian base so the engine the build generates matches the runtime.

**One Dockerfile, several targets.** `api`, `worker`, `demo`, an nginx `web`, and an
all-in-one `all` share one build stage, so the web app and bundles are built once. `all` is
last so a plain `docker build .` produces it, which is what a platform building the default
target gets.

**Docker is verified in CI, because it cannot run on this machine.** The `docker` job builds
every target, starts `docker-compose.prod.yml`, and runs `scripts/smoke-test.sh` against it.
The same script checks a real deploy afterwards.

**The API serves the web app in production.** One origin, one deployable, no CORS between
them. Client-side routes fall back to `index.html`, but anything under `/api/` does not, so a
typo in an API path still gets a JSON 404 instead of a web page. Fingerprinted assets are
cached for a year; `index.html` is never cached, so a deploy reaches returning visitors.

**`TRUST_PROXY` is a hop count, not `true`.** Behind a load balancer every request arrives
from the proxy's address, so without trusting it the rate limiters would treat every visitor
as one client. Trusting *everything* would be worse: a client could send its own
`X-Forwarded-For` and pick whatever address it liked, walking straight past the login limit.

**On the free tier, the three processes share one container — as processes, not threads.**
Render's free plan has web services but no free background workers. The launcher
(`deploy/start.mjs`) runs the API, worker and demo target as separate OS processes, so the
separate-worker point still holds: a slow batch of checks cannot delay an API request. It
restarts a crashed process with backoff, and resets the backoff for anything that ran for a
minute, so a process that crashes once after days is restarted promptly. On a paid plan the
same image splits into separate services with `PROCESSES=api` and `PROCESSES=worker`.

**Only the API process migrates.** If the API and worker containers start together, only one
of them should be walking the schema forward. The worker waits for the API's health check.

**The public demo has one published password, and it is the read-only one.** Locally every
seeded account shares `pulsewatch123`. In production the seed refuses to run unless
`DEMO_ADMIN_PASSWORD` is set and differs from the viewer's, so publishing the demo login
never publishes the admin account. The seed re-applies the hash on each run, so rotating the
secret and redeploying changes it.

**The demo target is private, and admins flip it through the API.** Exposing it publicly
would let any visitor fake an outage, and a second free service would cold-start and cause
false incidents. So it listens only inside the container, and `POST /api/demo/mode`
(admin-only) relays the mode. The URL comes from configuration, never from the request, so
this is not a way to make the server fetch arbitrary URLs.

**The seed was changed so the live demo hits the headline moment.** Checking the demo path
end to end showed a gap: breaking the demo target records `HTTP 503 Service Unavailable`, but
the seeded 503s read `...from https://api.example.com/...`, which normalizes differently — so
the live demo would have shown "similar" matches but never "seen before". The 503 family now
uses the exact message the checker records, and the payments-api monitor checks every 30s
with a threshold of two. Rehearsed on the production build: the incident opened 56 seconds
after breaking the target, matched three past incidents by fingerprint, and suggested
"Scale out replicas — 80%, fixed 3 of 3".

**Pages load on demand.** Route-level code splitting cut the first download from 287 KB to
116 KB gzipped. It matters most for the public status page, which is what a stranger opens
first and which has no use for the charting library or the Markdown renderer.

**Deploys come from CI, not from pushes.** `render.yaml` sets `autoDeploy: false`; the
`deploy` job calls Render's deploy hook only after the build, API, end-to-end and Docker jobs
pass on `main`. Without the secret it skips cleanly, so the pipeline is green before there is
anything to deploy to.

**Supabase over Neon for the free database.** Neon's free tier suspends an idle database to
save compute, but the worker queries every few seconds, so it would never be idle and would
exhaust the monthly allowance. Supabase's free database stays up. Its session pooler is used
rather than the direct host, which is IPv6-only on the free plan, and session rather than
transaction mode, because the worker depends on real transactions.

**Keeping the free instance awake is opt-in.** A sleeping free instance means a sleeping
worker, so the status page would show gaps. `keepalive.yml` pings the health check every 10
minutes once a repository variable is set. It is a workaround with a known limitation —
scheduled workflows can be delayed — and the honest fix is a paid instance.
