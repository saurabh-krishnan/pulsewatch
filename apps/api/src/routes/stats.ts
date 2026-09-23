import { Router } from 'express';
import type { StatsOverviewDto } from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const statsRouter = Router();

interface OverviewRow {
  open_incidents: bigint;
  acknowledged_incidents: bigint;
  resolved_30d: bigint;
  mttr_seconds: number | null;
  mtta_seconds: number | null;
}

/**
 * MTTR and MTTA over the last 30 days only. A lifetime average is dominated by
 * whatever happened at the start of the project and stops reflecting how the
 * team is doing now.
 */
const OVERVIEW_SQL = `
  SELECT
    count(*) FILTER (WHERE status = 'open')::bigint AS open_incidents,
    count(*) FILTER (WHERE status = 'acknowledged')::bigint AS acknowledged_incidents,
    count(*) FILTER (WHERE status = 'resolved'
                       AND resolved_at >= now() - interval '30 days')::bigint AS resolved_30d,
    avg(EXTRACT(EPOCH FROM (resolved_at - opened_at)))
      FILTER (WHERE resolved_at IS NOT NULL
                AND resolved_at >= now() - interval '30 days')::float8 AS mttr_seconds,
    avg(EXTRACT(EPOCH FROM (acknowledged_at - opened_at)))
      FILTER (WHERE acknowledged_at IS NOT NULL
                AND opened_at >= now() - interval '30 days')::float8 AS mtta_seconds
  FROM incidents
`;

/**
 * The repeat rate is the number that justifies the whole incident-memory
 * feature: how much of the outage load is the same problem coming back.
 * Counted over incidents that actually carry a fingerprint, since incidents
 * predating fingerprinting would otherwise drag it down.
 */
const REPEAT_SQL = `
  SELECT count(*) FILTER (WHERE f.occurrences > 1)::bigint AS repeats,
         count(*)::bigint AS total
  FROM incidents i
  JOIN fingerprints f ON f.id = i.fingerprint_id
`;

const PER_SERVICE_SQL = `
  SELECT s.id, s.name,
         count(i.id)::bigint AS incidents,
         count(i.id) FILTER (WHERE i.status <> 'resolved')::bigint AS open
  FROM services s
  LEFT JOIN incidents i ON i.service_id = s.id
  GROUP BY s.id, s.name
  ORDER BY incidents DESC, s.name
`;

const HEALTH_SQL = `
  SELECT s.id AS service_id, s.name AS service_name,
         -- One bad monitor makes the service unhealthy; 'unknown' only counts
         -- when nothing better is known.
         CASE
           WHEN count(m.id) = 0 THEN 'unknown'
           WHEN count(*) FILTER (WHERE m.status = 'down') > 0 THEN 'down'
           WHEN count(*) FILTER (WHERE m.status = 'up') > 0 THEN 'up'
           WHEN count(*) FILTER (WHERE m.status = 'paused') = count(m.id) THEN 'paused'
           ELSE 'unknown'
         END AS status,
         count(m.id)::bigint AS monitors
  FROM services s
  LEFT JOIN monitors m ON m.service_id = s.id
  GROUP BY s.id, s.name
  ORDER BY s.name
`;

statsRouter.get('/stats/overview', requireAuth, async (_req, res, next) => {
  try {
    const [overview, repeat, perService, health] = await Promise.all([
      prisma.$queryRawUnsafe<OverviewRow[]>(OVERVIEW_SQL),
      prisma.$queryRawUnsafe<{ repeats: bigint; total: bigint }[]>(REPEAT_SQL),
      prisma.$queryRawUnsafe<{ id: number; name: string; incidents: bigint; open: bigint }[]>(
        PER_SERVICE_SQL,
      ),
      prisma.$queryRawUnsafe<
        { service_id: number; service_name: string; status: string; monitors: bigint }[]
      >(HEALTH_SQL),
    ]);

    const o = overview[0]!;
    const r = repeat[0]!;
    const total = Number(r.total);

    res.json({
      openIncidents: Number(o.open_incidents),
      acknowledgedIncidents: Number(o.acknowledged_incidents),
      resolvedLast30Days: Number(o.resolved_30d),
      mttrSeconds: o.mttr_seconds === null ? null : Math.round(o.mttr_seconds),
      mttaSeconds: o.mtta_seconds === null ? null : Math.round(o.mtta_seconds),
      repeatRate: total === 0 ? null : Number(r.repeats) / total,
      repeatCount: Number(r.repeats),
      fingerprintedIncidents: total,
      perService: perService.map((s) => ({
        serviceId: s.id,
        serviceName: s.name,
        incidents: Number(s.incidents),
        open: Number(s.open),
      })),
      health: health.map((h) => ({
        serviceId: h.service_id,
        serviceName: h.service_name,
        status: h.status as 'up' | 'down' | 'paused' | 'unknown',
        monitors: Number(h.monitors),
      })),
    } satisfies StatsOverviewDto);
  } catch (err) {
    next(err);
  }
});
