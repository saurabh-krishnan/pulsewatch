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

**Two Postgres containers: `db` on 5432 and `db-test` on 5433.**
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
