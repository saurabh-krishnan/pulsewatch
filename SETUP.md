# Machine setup (Windows 11)

What is already installed and verified on this machine, and the one step still outstanding.

## Installed

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.19.0 LTS | via winget `OpenJS.NodeJS.LTS` |
| npm | 11.17.0 | workspaces enabled |
| Git | 2.55.0 | repo identity set locally, not globally |
| GitHub CLI | 2.101.0 | run `gh auth login` before creating the remote |
| Docker Desktop | **not installed** | blocked on WSL2, see below |

## Outstanding: WSL2, then Docker Desktop

Docker Desktop's installer exits with `-5` on this machine because WSL2 is missing
(`wsl --status` returns `REGDB_E_CLASSNOTREG`). Virtualization is already enabled in
firmware, so only the Windows feature is needed.

**1. Open PowerShell as Administrator** (Start → type "PowerShell" → Run as administrator), then:

```powershell
wsl --install --no-distribution
```

**2. Reboot.** This is required — the Virtual Machine Platform feature does not activate until then.

**3. Back in a normal terminal, confirm and install Docker:**

```powershell
wsl --status
winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements
```

**4. Launch Docker Desktop once** and let it finish first-run setup, then:

```powershell
docker --version
npm run db:up
npm run db:migrate
```

## npm install scripts

npm 11 blocks lifecycle scripts by default. Prisma and esbuild need theirs, so they are
approved in `package.json#allowScripts`. If `npm install` ever warns about pending scripts
again, review them with `npm approve-scripts --allow-scripts-pending` rather than `--all`.

## First migration

The schema is written but not yet applied (no database running). Once Postgres is up:

```powershell
npx prisma migrate dev --create-only --name init
```

Then paste the contents of `prisma/sql/init-extras.sql` at the end of the generated
`prisma/migrations/<timestamp>_init/migration.sql`, and apply it:

```powershell
npx prisma migrate dev
```

That SQL carries the `pg_trgm` extension, the `CHECK` constraints, the generated
`search_vector` column, the GIN indexes and the partial unique index that guarantees one
active incident per monitor — none of which Prisma's schema language can express.
