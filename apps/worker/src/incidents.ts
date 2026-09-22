/**
 * Incident lifecycle driven by the worker (guide Phase 3 steps 1-2).
 *
 * Opening an incident and writing its first timeline event happen in one
 * transaction: an incident with no "opened" event would be a hole in exactly
 * the history this product exists to keep.
 */
import type { ErrorType, IncidentSeverity } from '@pulsewatch/shared';
import { upsertFingerprint } from '@pulsewatch/shared/fingerprint';
import { Prisma } from '@prisma/client';
import { prisma } from './db.js';
import type { CheckOutcome } from './checker.js';

/**
 * Failures that mean "nobody can reach this at all" are treated as more
 * serious than a wrong-but-responding endpoint. Deliberately coarse: a human
 * adjusts the severity from the UI, and that adjustment is itself logged.
 */
function severityFor(errorType: ErrorType | null): IncidentSeverity {
  switch (errorType) {
    case 'TIMEOUT':
    case 'CONNECTION_REFUSED':
    case 'DNS_FAILURE':
    case 'TLS_ERROR':
    case 'HTTP_5XX':
      return 'SEV2';
    default:
      return 'SEV3';
  }
}

export interface MonitorContext {
  id: number;
  service_id: number;
  url: string;
  failure_threshold: number;
}

/**
 * Returns the incident id, or null if one was already open for this monitor.
 *
 * The partial unique index on incidents(monitor_id) WHERE status <> 'resolved'
 * is what makes this safe under a race between two worker cycles: the loser of
 * the race gets a unique violation instead of creating a duplicate.
 */
export async function openIncident(
  monitor: MonitorContext,
  outcome: CheckOutcome,
): Promise<number | null> {
  const service = await prisma.service.findUnique({
    where: { id: monitor.service_id },
    select: { name: true },
  });
  const serviceName = service?.name ?? `service ${monitor.service_id}`;
  const errorMessage = outcome.errorMessage ?? 'check failed';

  // Fingerprint first: the upsert must land even if the incident insert then
  // loses the race to another worker, because the occurrence still happened.
  const fp = await upsertFingerprint(prisma, outcome.errorType ?? 'UNKNOWN', errorMessage);

  try {
    const incident = await prisma.$transaction(async (tx) => {
      const created = await tx.incident.create({
        data: {
          serviceId: monitor.service_id,
          monitorId: monitor.id,
          fingerprintId: fp.id,
          title: `${serviceName} health check failing`,
          description:
            `Monitor ${monitor.url} failed ${monitor.failure_threshold} consecutive checks.\n` +
            `Last error: ${errorMessage}`,
          errorType: outcome.errorType,
          severity: severityFor(outcome.errorType),
          status: 'open',
          source: 'monitor',
        },
      });

      await tx.incidentEvent.create({
        data: {
          incidentId: created.id,
          userId: null, // system
          type: 'opened',
          message:
            `${monitor.failure_threshold} failed checks (${errorMessage})` +
            (fp.occurrences > 1 ? ` — this error has been seen ${fp.occurrences} times` : ''),
        },
      });

      return created;
    });

    return incident.id;
  } catch (err) {
    // P2002 = unique constraint: an incident is already active for this monitor.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return null;
    }
    throw err;
  }
}

/** Resolves whatever incident is active for this monitor. Returns its id, or null. */
export async function resolveIncidentForMonitor(
  monitorId: number,
  recoveryThreshold: number,
): Promise<number | null> {
  const active = await prisma.incident.findFirst({
    where: { monitorId, status: { not: 'resolved' } },
    select: { id: true },
  });
  if (!active) return null;

  await prisma.$transaction([
    prisma.incident.update({
      where: { id: active.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolutionNote: 'Recovered automatically: monitor checks are passing again.',
      },
    }),
    prisma.incidentEvent.create({
      data: {
        incidentId: active.id,
        userId: null,
        type: 'resolved',
        message: `Recovered after ${recoveryThreshold} successful checks`,
      },
    }),
  ]);

  return active.id;
}
