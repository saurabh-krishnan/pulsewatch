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

**Login says "Email or password is incorrect" for both cases, and hashes even when the user
does not exist.** Distinct messages would let someone enumerate which emails have accounts.

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

Proof it works: the seed's 26 historical incidents collapse into 12 fingerprints. The five
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
