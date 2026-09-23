/**
 * Hourly rollup and retention (guide Phase 6 step 1).
 *
 * The status page needs 90 days of uptime per monitor. Computing that from raw
 * check_results would mean scanning ~130,000 rows per monitor every time
 * somebody loads a public page. Instead the raw results are aggregated into one
 * row per monitor per day, and the raw rows are dropped once they are older
 * than the retention window.
 */
import { prisma } from './db.js';
import { env } from './env.js';

/**
 * Recomputes rather than incrementally updates. Two reasons: today's row is
 * still accumulating so it has to be rewritten anyway, and recomputing is
 * idempotent -- running the job twice, or after a crash mid-run, cannot
 * double-count.
 *
 * Only the last few days are touched; older days are already final.
 */
const ROLLUP_SQL = `
  INSERT INTO uptime_daily (monitor_id, day, total, successful, avg_response_ms)
  SELECT monitor_id,
         (checked_at AT TIME ZONE 'UTC')::date AS day,
         count(*)::int,
         count(*) FILTER (WHERE success)::int,
         avg(response_time_ms)::int
  FROM check_results
  -- $1 must be cast: Prisma sends JS numbers as bigint, and there is no
  -- make_interval(days => bigint) overload.
  WHERE checked_at >= now() - make_interval(days => $1::int)
  GROUP BY monitor_id, (checked_at AT TIME ZONE 'UTC')::date
  ON CONFLICT (monitor_id, day) DO UPDATE
    SET total = EXCLUDED.total,
        successful = EXCLUDED.successful,
        avg_response_ms = EXCLUDED.avg_response_ms
`;

/** Days of recent history to recompute on each run. */
const RECOMPUTE_WINDOW_DAYS = 3;

export async function rollupUptime(windowDays = RECOMPUTE_WINDOW_DAYS): Promise<number> {
  return prisma.$executeRawUnsafe(ROLLUP_SQL, windowDays);
}

/**
 * Drops raw results past the retention window. Safe only because the rollup
 * has already summarised them, so this runs after it, never before.
 */
export async function pruneCheckResults(): Promise<number> {
  return prisma.$executeRawUnsafe(
    `DELETE FROM check_results WHERE checked_at < now() - make_interval(days => $1::int)`,
    env.RESULTS_RETENTION_DAYS,
  );
}

export async function runRollupCycle(): Promise<void> {
  const rolled = await rollupUptime();
  const pruned = await pruneCheckResults();
  console.log(
    `[rollup] ${rolled} day-row(s) written, ${pruned} raw result(s) older than ` +
      `${env.RESULTS_RETENTION_DAYS} days removed`,
  );
}
