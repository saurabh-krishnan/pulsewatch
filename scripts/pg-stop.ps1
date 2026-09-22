# Stops the portable PostgreSQL 16 used for local development.
$ErrorActionPreference = 'Stop'

$pgRoot = if ($env:PULSEWATCH_PGROOT) { $env:PULSEWATCH_PGROOT } else { Join-Path $env:USERPROFILE 'pgsql' }
$dataDir = Join-Path $pgRoot 'data'

& (Join-Path $pgRoot 'bin\pg_ctl.exe') -D $dataDir -m fast -w stop
Write-Host 'Postgres stopped.'
