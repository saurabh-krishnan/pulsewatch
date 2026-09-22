/**
 * Incident memory (guide 7.4 and 7.5).
 *
 * Candidate selection happens in SQL, where the indexes are; the ranking runs
 * in TypeScript, where it can be unit-tested and tuned without a database.
 */
import {
  MAX_RESULTS,
  MIN_SCORE,
  scoreIncident,
  successRate,
  type SimilarIncidentDto,
  type SuggestionDto,
  type IncidentSeverity,
} from '@pulsewatch/shared';
import { prisma } from '../db.js';

interface CandidateRow {
  id: number;
  title: string;
  service_id: number;
  service_name: string;
  error_type: string | null;
  severity: string;
  tags: string[];
  opened_at: Date;
  resolved_at: Date | null;
  resolution_note: string | null;
  fingerprint_id: number | null;
  sim: number;
}

/**
 * Narrow the search before scoring: same fingerprint, same service, or text
 * that already looks alike. Scoring 100 candidates in TypeScript is cheap;
 * scoring every incident ever recorded is not.
 */
const CANDIDATE_SQL = `
  SELECT i.id, i.title, i.service_id, s.name AS service_name, i.error_type,
         i.severity, i.tags, i.opened_at, i.resolved_at, i.resolution_note,
         i.fingerprint_id,
         COALESCE(similarity(f.normalized, $1), 0)::float8 AS sim
  FROM incidents i
  JOIN services s ON s.id = i.service_id
  LEFT JOIN fingerprints f ON f.id = i.fingerprint_id
  WHERE i.id <> $2
    AND i.status = 'resolved'
    AND (
      ($3::int IS NOT NULL AND i.fingerprint_id = $3::int)
      OR i.service_id = $4::int
      OR (f.normalized IS NOT NULL AND similarity(f.normalized, $1) > 0.3)
    )
  ORDER BY (($3::int IS NOT NULL AND i.fingerprint_id = $3::int)) DESC, i.resolved_at DESC NULLS LAST
  LIMIT 100
`;

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 86_400_000);
}

export async function findSimilarIncidents(incidentId: number): Promise<SimilarIncidentDto[]> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { fingerprint: { select: { normalized: true } } },
  });
  if (!incident) return [];

  const normalized = incident.fingerprint?.normalized ?? '';

  const candidates = await prisma.$queryRawUnsafe<CandidateRow[]>(
    CANDIDATE_SQL,
    normalized,
    incident.id,
    incident.fingerprintId,
    incident.serviceId,
  );

  return candidates
    .map((c) => {
      const { score, reasons } = scoreIncident({
        sameFingerprint:
          incident.fingerprintId !== null && c.fingerprint_id === incident.fingerprintId,
        similarity: c.sim,
        sameService: c.service_id === incident.serviceId,
        sameErrorType: c.error_type !== null && c.error_type === incident.errorType,
        sharedTag: c.tags.some((t) => incident.tags.includes(t)),
        resolvedDaysAgo: daysSince(c.resolved_at),
      });

      return {
        id: c.id,
        title: c.title,
        serviceId: c.service_id,
        serviceName: c.service_name,
        errorType: c.error_type,
        severity: c.severity as IncidentSeverity,
        openedAt: c.opened_at.toISOString(),
        resolvedAt: c.resolved_at?.toISOString() ?? null,
        resolutionNote: c.resolution_note,
        score,
        reasons,
      } satisfies SimilarIncidentDto;
    })
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS);
}

interface RunbookStatsRow {
  runbook_id: number;
  title: string;
  times_tried: bigint;
  times_worked: bigint;
}

/**
 * Ranks runbooks by how often they actually fixed the incidents that look like
 * this one. Laplace smoothing stops a single lucky success from outranking a
 * runbook with a real track record.
 */
export async function suggestRunbooks(incidentId: number): Promise<SuggestionDto[]> {
  const similar = await findSimilarIncidents(incidentId);
  if (similar.length === 0) return [];

  const rows = await prisma.$queryRawUnsafe<RunbookStatsRow[]>(
    `
      SELECT r.id AS runbook_id, r.title,
             count(*) AS times_tried,
             count(*) FILTER (WHERE ir.worked) AS times_worked
      FROM incident_runbooks ir
      JOIN runbooks r ON r.id = ir.runbook_id
      WHERE ir.incident_id = ANY($1::int[])
      GROUP BY r.id, r.title
    `,
    similar.map((s) => s.id),
  );

  return rows
    .map((r) => {
      const timesTried = Number(r.times_tried);
      const timesWorked = Number(r.times_worked);
      return {
        runbookId: r.runbook_id,
        title: r.title,
        timesTried,
        timesWorked,
        successRate: successRate(timesWorked, timesTried),
      } satisfies SuggestionDto;
    })
    .sort((a, b) => b.successRate - a.successRate || b.timesWorked - a.timesWorked);
}
