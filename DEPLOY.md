# Deploying PulseWatch

The free path: **Render** runs the app from the included `render.yaml` Blueprint, and
**Supabase** hosts Postgres. About 20 minutes, no credit card.

Everything that can be prepared in the repository already is: the Docker image, the
Blueprint, CI that deploys only after the tests pass, and a smoke test for afterwards. What
is left needs your accounts.

> Hosting dashboards rename things. If a label below does not match what you see, look for
> the equivalent setting — the *what* matters more than the exact click path.

## What gets deployed

One free Render web service built from the `Dockerfile`'s default target. Inside it, three
processes run side by side:

- **API** — serves the JSON API *and* the built React app, on one origin
- **Worker** — checks monitors, opens and resolves incidents, sends alerts
- **Demo target** — the fault-injection service, listening only inside the container

They stay separate processes, so a slow batch of checks never delays an API request; they
just share one free instance. The demo target is deliberately unreachable from the internet,
so visitors cannot break it — an admin flips it from the dashboard's **Demo target** panel.

On start-up the container applies migrations and runs the idempotent seed, which creates the
demo accounts, three services, five runbooks, 27 past incidents and 90 days of uptime.

## 1. Create the database (Supabase)

1. Sign in at [supabase.com](https://supabase.com) with GitHub and create a **new project**.
   Pick the region closest to where you will run the app, and save the database password.
2. Open **Connect** and copy the **Session pooler** connection string (port 5432). Replace
   `[YOUR-PASSWORD]` with the database password.

   Use the *session pooler*, not the direct connection: on the free plan the direct host
   is IPv6-only, and Render connects over IPv4. Use *session* rather than *transaction*
   mode, because the worker relies on real transactions (`FOR UPDATE SKIP LOCKED`).

Nothing else to set up: the migrations create the `pg_trgm` extension and every table.

**Why not Neon?** It works, but Neon's free tier saves money by suspending an idle
database, and PulseWatch's worker queries every few seconds, so the database would never
be idle and would use up the monthly compute allowance.

## 2. Create the app (Render)

1. Sign in at [render.com](https://render.com) with GitHub.
2. **New → Blueprint**, and pick the `pulsewatch` repository. Render reads `render.yaml`.
3. It asks for the values the Blueprint leaves blank:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Supabase session-pooler string from step 1 |
   | `DEMO_ADMIN_PASSWORD` | a password for the admin and engineer demo accounts — keep it private |
   | `DISCORD_WEBHOOK_URL` | optional; leave blank for no alerts |

   `JWT_SECRET` is generated for you.
4. **Apply**. The first build takes several minutes. When it finishes, the service page
   shows the URL, e.g. `https://pulsewatch-xxxx.onrender.com`.

## 3. Check it

From the repository root. In **Git Bash** (or any Linux/macOS shell):

```bash
BASE_URL=https://pulsewatch-xxxx.onrender.com ADMIN_PASSWORD='your-admin-password' bash scripts/smoke-test.sh
```

In **PowerShell**, the `NAME=value command` form above does not work, and a bare `bash` may
start WSL instead of Git Bash. Set the variables first and call Git Bash by its full path:

```powershell
$env:BASE_URL = 'https://pulsewatch-xxxx.onrender.com'; $env:ADMIN_PASSWORD = 'your-admin-password'; & "C:\Program Files\Git\bin\bash.exe" scripts/smoke-test.sh
```

`ADMIN_PASSWORD` is optional; without it, the admin-only check is skipped.

It checks the health endpoint, that the app and status page load, that security headers
are present, that the published viewer login works and cannot write, that the worker is
checking monitors, and that the admin demo controls reach the demo target.

Then open the URL and sign in as the public viewer: `viewer@pulsewatch.local` /
`pulsewatch123`.

## 4. Deploy from CI, not on every push

`render.yaml` sets `autoDeploy: false`, so Render does not deploy on its own. Instead the
`deploy` job in `.github/workflows/ci.yml` runs after the build, API, end-to-end and Docker
jobs have all passed on `main`, so a broken commit never reaches the live site.

1. In Render: the service's **Settings → Deploy Hook**, copy the URL.
2. In GitHub: the repository's **Settings → Secrets and variables → Actions → New
   repository secret**, named `RENDER_DEPLOY_HOOK_URL`, with that URL.

Until the secret exists, the deploy job reports that it is skipping and passes.

## 5. Keep it awake (optional)

Render's free web services sleep after about 15 minutes without a request, and waking takes
up to a minute. Because the worker lives in the same instance, **asleep means not
monitoring**: the status page would show gaps, and outages during the gap go unnoticed.

`.github/workflows/keepalive.yml` pings the health check every 10 minutes, but only once you
opt in: **Settings → Secrets and variables → Actions → Variables → New repository
variable**, named `PULSEWATCH_URL`, set to your app's URL.

Trade-offs to know about: one always-on free instance fits within Render's monthly free
hours, but GitHub may delay scheduled workflows under load, so an occasional short sleep is
still possible. The proper fix is a paid instance, where you would also split the worker
into its own background service.

## 6. Finish the README

Replace the *Live demo* line near the top of `README.md` with your URL.

## Alternative: a server with Docker (option B)

On any machine with Docker — an EC2 instance, a VPS — the same images run from
`docker-compose.prod.yml`:

```bash
export JWT_SECRET="$(openssl rand -base64 48)"
export DEMO_ADMIN_PASSWORD='choose-one'
docker compose -f docker-compose.prod.yml up -d --build
```

That runs Postgres, the API, the worker and the demo target as four containers, on port
4000. Put a TLS-terminating reverse proxy in front of it (Caddy does this in two lines), set
`TRUST_PROXY=1` so rate limits see real client addresses, and `PUBLIC_URL` to the site's
address. CI builds and smoke-tests exactly this compose file on every push.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Build fails at `npm ci` | The lockfile is out of date: run `npm install` locally and commit `package-lock.json` |
| Logs say `Refusing to start in production` | `JWT_SECRET` is a placeholder or too short, or `ALLOW_PRIVATE_MONITOR_TARGETS` is true |
| Logs say `DEMO_ADMIN_PASSWORD must be set` | The seed needs it in production — add it in Render's environment settings |
| Health check fails with the database `down` | Wrong `DATABASE_URL`, or the direct Supabase host instead of the session pooler |
| Monitors never leave `unknown` | The worker is not running, or asleep — check the logs and step 5 |
| Every monitor shows `BLOCKED_TARGET` | A monitor points at a private address; allow a specific host with `MONITOR_HOST_ALLOWLIST` |
