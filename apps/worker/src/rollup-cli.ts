/**
 * Runs the rollup once and exits.
 *
 *   npm run rollup -w @pulsewatch/worker
 *
 * Useful after importing history, or to backfill uptime_daily without waiting
 * for the worker's hourly tick. Takes an optional window in days.
 */
import { prisma } from './db.js';
import { pruneCheckResults, rollupUptime } from './rollup.js';
import { env } from './env.js';

const windowDays = Number(process.argv[2] ?? 3);

async function main() {
  console.log(`[rollup] recomputing the last ${windowDays} day(s)…`);
  const rolled = await rollupUptime(windowDays);
  console.log(`[rollup] ${rolled} day-row(s) written`);

  const pruned = await pruneCheckResults();
  console.log(
    `[rollup] ${pruned} raw result(s) older than ${env.RESULTS_RETENTION_DAYS} days removed`,
  );
}

main()
  .catch((err) => {
    console.error('[rollup] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
