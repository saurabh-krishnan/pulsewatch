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
