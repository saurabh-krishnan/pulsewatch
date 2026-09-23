/**
 * PulseWatch check worker.
 *
 * A separate process from the API on purpose: checking hundreds of URLs a
 * minute is background work, and the API has to stay responsive. They share
 * only the database.
 *
 * Phase 5 adds alerts.ts, Phase 6 adds the hourly rollup job.
 */
import { prisma } from './db.js';
import { env } from './env.js';
import { runRollupCycle } from './rollup.js';
import { runCycle } from './scheduler.js';

let running = true;
let cycleInFlight = false;
let lastRollupAt = 0;

const ROLLUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Runs on the same loop as the checks rather than on a cron, so there is one
 * process, one shutdown path and no second scheduler to reason about.
 */
async function maybeRollup() {
  if (Date.now() - lastRollupAt < ROLLUP_INTERVAL_MS) return;
  lastRollupAt = Date.now();
  try {
    await runRollupCycle();
  } catch (err) {
    // Same rule as alerts: housekeeping must never stop the monitoring.
    console.error('[rollup] failed:', err);
  }
}

async function main() {
  console.log(
    `[worker] started — polling every ${env.WORKER_POLL_SECONDS}s, ` +
      `concurrency ${env.WORKER_CONCURRENCY}, batch ${env.WORKER_BATCH_SIZE}, ` +
      `rollup hourly, keeping raw results ${env.RESULTS_RETENTION_DAYS} days`,
  );

  while (running) {
    cycleInFlight = true;
    try {
      const checked = await runCycle();
      if (checked > 0) console.log(`[worker] cycle complete — ${checked} monitor(s) checked`);
      await maybeRollup();
    } catch (err) {
      // A failing cycle must never kill the worker.
      console.error('[worker] cycle failed:', err);
    } finally {
      cycleInFlight = false;
    }

    if (!running) break;
    await new Promise((r) => setTimeout(r, env.WORKER_POLL_SECONDS * 1000));
  }

  // Let an in-flight cycle finish writing before the connection closes.
  while (cycleInFlight) await new Promise((r) => setTimeout(r, 100));
  await prisma.$disconnect();
  console.log('[worker] stopped');
  process.exit(0);
}

function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, stopping after this cycle`);
  running = false;
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('[worker] fatal:', err);
  process.exit(1);
});
