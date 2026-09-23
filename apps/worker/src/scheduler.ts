/**
 * The scheduling loop (guide 7.2).
 *
 * Each cycle claims a batch of due monitors, checks them with bounded
 * concurrency, then records each result and advances the state machine.
 */
import { nextState, type MonitorState, type Status } from '@pulsewatch/shared';
import { prisma } from './db.js';
import { runCheck, type CheckOutcome } from './checker.js';
import { env, targetPolicy } from './env.js';
import { sendAlert } from './alerts.js';
import { openIncident, resolveIncidentForMonitor } from './incidents.js';

/** Shape returned by the raw claim query (snake_case, straight from Postgres). */
interface ClaimedMonitor {
  id: number;
  service_id: number;
  url: string;
  method: string;
  timeout_ms: number;
  expected_status: number;
  failure_threshold: number;
  recovery_threshold: number;
  status: string;
  consecutive_failures: number;
  consecutive_successes: number;
}

/**
 * Claims due monitors and pushes their next check forward in one statement.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe to run in more than one
 * process: a row another worker has already locked is skipped rather than
 * waited on, so two workers never check the same monitor in the same cycle.
 */
export function claimDueMonitors(limit: number): Promise<ClaimedMonitor[]> {
  return prisma.$queryRaw<ClaimedMonitor[]>`
    UPDATE monitors
    SET next_check_at = now() + make_interval(secs => interval_seconds),
        last_checked_at = now()
    WHERE id IN (
      SELECT id FROM monitors
      WHERE status <> 'paused' AND next_check_at <= now()
      ORDER BY next_check_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, service_id, url, method, timeout_ms, expected_status,
              failure_threshold, recovery_threshold, status,
              consecutive_failures, consecutive_successes;
  `;
}

/** Runs tasks with a ceiling on how many are in flight at once. */
async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Persists one check and advances that monitor's state.
 * The insert and the state update go in one transaction so a crash between
 * them cannot leave the counters disagreeing with the recorded history.
 */
export async function recordResult(monitor: ClaimedMonitor, outcome: CheckOutcome) {
  // 'paused' never reaches here, so anything else maps onto the machine's Status.
  const current: MonitorState = {
    status: (monitor.status === 'paused' ? 'unknown' : monitor.status) as Status,
    failures: monitor.consecutive_failures,
    successes: monitor.consecutive_successes,
  };

  const { state, action } = nextState(
    current,
    outcome.success,
    monitor.failure_threshold,
    monitor.recovery_threshold,
  );

  await prisma.$transaction([
    prisma.checkResult.create({
      data: {
        monitorId: monitor.id,
        success: outcome.success,
        statusCode: outcome.statusCode,
        responseTimeMs: outcome.responseTimeMs,
        errorMessage: outcome.errorMessage,
      },
    }),
    prisma.monitor.update({
      where: { id: monitor.id },
      data: {
        status: state.status,
        consecutiveFailures: state.failures,
        consecutiveSuccesses: state.successes,
      },
    }),
  ]);

  return { state, action };
}

export async function runCycle(): Promise<number> {
  const monitors = await claimDueMonitors(env.WORKER_BATCH_SIZE);
  if (monitors.length === 0) return 0;

  await withConcurrency(monitors, env.WORKER_CONCURRENCY, async (monitor) => {
    try {
      const outcome = await runCheck(
        {
          url: monitor.url,
          method: monitor.method,
          timeoutMs: monitor.timeout_ms,
          expectedStatus: monitor.expected_status,
        },
        targetPolicy,
      );

      const { state, action } = await recordResult(monitor, outcome);

      const detail = outcome.success
        ? `${outcome.statusCode} in ${outcome.responseTimeMs}ms`
        : outcome.errorMessage;
      console.log(`[worker] monitor ${monitor.id} ${monitor.url} -> ${state.status} (${detail})`);

      if (action === 'open_incident') {
        const opened = await openIncident(monitor, outcome);
        console.warn(
          opened
            ? `[worker] monitor ${monitor.id} is DOWN — opened incident ${opened.incidentId}`
            : `[worker] monitor ${monitor.id} is DOWN — an incident is already open`,
        );
        if (opened) {
          await sendAlert({
            kind: 'opened',
            incidentId: opened.incidentId,
            serviceName: opened.serviceName,
            monitorUrl: monitor.url,
            severity: opened.severity,
            message: opened.message,
            seenBefore: opened.seenBefore,
          });
        }
      } else if (action === 'resolve_incident') {
        const resolved = await resolveIncidentForMonitor(monitor.id, monitor.recovery_threshold);
        console.log(
          resolved
            ? `[worker] monitor ${monitor.id} RECOVERED — resolved incident ${resolved.incidentId}`
            : `[worker] monitor ${monitor.id} RECOVERED — no open incident to resolve`,
        );
        if (resolved) {
          await sendAlert({
            kind: 'recovered',
            incidentId: resolved.incidentId,
            serviceName: resolved.serviceName,
            monitorUrl: monitor.url,
            severity: resolved.severity,
            message: 'Checks are passing again',
          });
        }
      }
    } catch (err) {
      // One bad monitor must not take down the cycle.
      console.error(`[worker] monitor ${monitor.id} failed to process:`, err);
    }
  });

  return monitors.length;
}
