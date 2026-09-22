# Machine setup (Windows 11)

What is installed and verified on this machine.

## Installed

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.19.0 LTS | via winget `OpenJS.NodeJS.LTS` |
| npm | 11.17.0 | workspaces enabled |
| Git | 2.55.0 | repo identity set locally, not globally |
| GitHub CLI | 2.101.0 | authenticated as `saurabh-krishnan` |
| PostgreSQL | 16.10 | portable install at `%USERPROFILE%\pgsql`, see below |
| Docker Desktop | installed, **engine not running** | blocked on WSL2, see below |

## The database: portable Postgres, not Docker

Docker Desktop is installed but its engine cannot start, because on Windows 11 Home the
only available backend is WSL2 and this machine's WSL installation is corrupted
(`wsl --status` → `REGDB_E_CLASSNOTREG`). Rather than block the project on that, local
development uses a **portable PostgreSQL 16.10** — the official EnterpriseDB binaries zip
extracted to `%USERPROFILE%\pgsql`, with a data directory at `%USERPROFILE%\pgsql\data`.

Same version, same port, same connection string as the Docker setup. Nothing in the
application knows the difference.

```powershell
npm run pg:start     # start Postgres on localhost:5432
npm run pg:stop      # stop it
```

Cluster details: superuser `pulsewatch` / password `pulsewatch`, databases `pulsewatch`
and `pulsewatch_test`, scram-sha-256 auth. The server log is at `%USERPROFILE%\pgsql\postgres.log`.

`docker-compose.yml` is still correct and still used by CI — it just has not been run on
this machine.

### If you want Docker working later

1. Admin PowerShell: `winget install --id Microsoft.WSL -e --source winget`
2. Reboot (the `VirtualMachinePlatform` and `Microsoft-Windows-Subsystem-Linux` features
   are already enabled, but need a restart to activate)
3. `wsl --version` should print a version rather than "Class not registered"
4. Launch Docker Desktop, then `npm run db:up` works instead of `npm run pg:start`

## npm install scripts

npm 11 blocks lifecycle scripts by default. Prisma and esbuild need theirs, so they are
approved in `package.json#allowScripts`. If `npm install` ever warns about pending scripts
again, review them with `npm approve-scripts --allow-scripts-pending` rather than `--all`.

## First migration — applied

`20260922165744_init` is applied. It was produced with `--create-only`, then the contents
of `prisma/sql/init-extras.sql` were appended before applying, because Prisma's schema
language cannot express the `CHECK` constraints, the generated `search_vector` column, the
GIN indexes or the partial unique index that guarantees one active incident per monitor.

Verified in the database:

- 12 tables + `_prisma_migrations`
- `incidents.search_vector` is `is_generated = ALWAYS`
- `idx_one_active_per_monitor`, `idx_fp_trgm`, `idx_incidents_search`, `idx_monitors_due`
- `pg_trgm` extension installed

Use the same `--create-only` → append → apply flow for any future migration that needs raw
SQL. A plain `npx prisma migrate dev` is fine for ordinary schema changes.

> Note: `prisma migrate dev` does not always exit cleanly on this machine — it applies the
> migration and then hangs holding the console. If that happens, Ctrl-C and confirm the
> result with `npx prisma migrate status`.
