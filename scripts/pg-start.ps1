# Starts the portable PostgreSQL 16 used for local development.
#
# This is a stand-in for `npm run db:up` (Docker) on machines where Docker
# Desktop cannot run. Same database, same port, same connection string --
# it is just started directly instead of inside a container.
$ErrorActionPreference = 'Stop'

$pgRoot = if ($env:PULSEWATCH_PGROOT) { $env:PULSEWATCH_PGROOT } else { Join-Path $env:USERPROFILE 'pgsql' }
$dataDir = Join-Path $pgRoot 'data'
$logFile = Join-Path $pgRoot 'postgres.log'

if (-not (Test-Path (Join-Path $pgRoot 'bin\pg_ctl.exe'))) {
  throw "Postgres binaries not found at $pgRoot. See SETUP.md."
}

$status = & (Join-Path $pgRoot 'bin\pg_ctl.exe') -D $dataDir status 2>&1
if ($LASTEXITCODE -eq 0) {
  Write-Host 'Postgres is already running on port 5432.'
  exit 0
}

& (Join-Path $pgRoot 'bin\pg_ctl.exe') -D $dataDir -l $logFile -o '-p 5432' -w start
Write-Host "Postgres 16 listening on localhost:5432 (log: $logFile)"
