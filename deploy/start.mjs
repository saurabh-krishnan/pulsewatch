/**
 * Production launcher.
 *
 *   node deploy/start.mjs            # api + worker + demo target, the default
 *   PROCESSES=api node deploy/start.mjs
 *   PROCESSES=worker node deploy/start.mjs
 *
 * On a platform where each process gets its own container, set PROCESSES to
 * run one. On a single free instance, the default runs all three side by side:
 * still separate OS processes -- the API stays responsive however slow the
 * checks get, which is the point of the separate worker -- just co-located.
 *
 * Before starting anything that serves traffic it applies migrations, and,
 * when SEED_ON_START=true, runs the idempotent seed. A child that exits
 * unexpectedly is restarted with backoff; SIGTERM is passed to every child so
 * the worker can finish its cycle before the platform stops the container.
 */
import { spawn, spawnSync } from 'node:child_process';

const ALL = ['api', 'worker', 'demo'];
const wanted = (process.env.PROCESSES ?? ALL.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter((s) => ALL.includes(s));

if (wanted.length === 0) {
  console.error(`[start] PROCESSES must list some of: ${ALL.join(', ')}`);
  process.exit(1);
}

function runOnce(label, command, args) {
  console.log(`[start] ${label}…`);
  const r = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`[start] ${label} failed (exit ${r.status}); not starting`);
    process.exit(r.status ?? 1);
  }
}

// Only the process that owns the schema migrates, so two containers starting
// together do not race each other through the same migrations.
if (wanted.includes('api')) {
  runOnce('applying migrations', 'npx', ['prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']);
  if (process.env.SEED_ON_START === 'true') {
    runOnce('seeding (idempotent)', 'node', ['--enable-source-maps', 'dist/server/seed.cjs']);
  }
}

let stopping = false;
const children = new Map();
/** Consecutive quick crashes per process, which drives the backoff. */
const quickCrashes = new Map();

function launch(name) {
  const startedAt = Date.now();
  const child = spawn('node', ['--enable-source-maps', `dist/server/${name}.cjs`], {
    stdio: 'inherit',
    env: process.env,
  });
  children.set(name, child);

  child.on('exit', (code, signal) => {
    children.delete(name);
    if (stopping) {
      if (children.size === 0) process.exit(0);
      return;
    }
    // Something that ran for a minute before dying is not crash-looping, so it
    // restarts promptly; repeated fast crashes back off up to 30s.
    const ranLong = Date.now() - startedAt >= 60_000;
    const crashes = ranLong ? 1 : (quickCrashes.get(name) ?? 0) + 1;
    quickCrashes.set(name, crashes);
    const delay = Math.min(30_000, 1000 * 2 ** (crashes - 1));
    console.error(`[start] ${name} exited (${signal ?? code}); restarting in ${delay}ms`);
    setTimeout(() => launch(name), delay);
  });
}

for (const name of wanted) launch(name);
console.log(`[start] running: ${wanted.join(', ')}`);

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[start] ${signal}: stopping ${[...children.keys()].join(', ')}`);
  for (const child of children.values()) child.kill('SIGTERM');
  // Do not hang forever on a child that ignores the signal.
  setTimeout(() => process.exit(0), 20_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
