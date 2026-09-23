import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { PublicStatusDto, PublicServiceDto, UptimeDayDto } from '@pulsewatch/shared';
import { prisma } from '../db.js';

export const publicRouter = Router();

/** No auth on this route, so it gets its own limit. */
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

const DAYS = 90;

interface StatusRow {
  service_id: number;
  service_name: string;
  description: string | null;
  status: string;
}

interface UptimeRow {
  service_id: number;
  day: Date;
  total: bigint;
  successful: bigint;
}

/**
 * Reads the rollup table, not check_results: 90 small rows per monitor instead
 * of every raw check ever recorded. This is the whole reason uptime_daily
 * exists.
 *
 * Only services flagged is_public are exposed, and nothing here reveals URLs,
 * error messages or incident detail.
 */
const STATUS_SQL = `
  SELECT s.id AS service_id, s.name AS service_name, s.description,
         CASE
           WHEN count(m.id) = 0 THEN 'unknown'
           WHEN count(*) FILTER (WHERE m.status = 'down') > 0 THEN 'down'
           WHEN count(*) FILTER (WHERE m.status = 'up') > 0 THEN 'up'
           ELSE 'unknown'
         END AS status
  FROM services s
  LEFT JOIN monitors m ON m.service_id = s.id
  WHERE s.is_public
  GROUP BY s.id, s.name, s.description
  ORDER BY s.name
`;

const UPTIME_SQL = `
  SELECT m.service_id, u.day, sum(u.total)::bigint AS total, sum(u.successful)::bigint AS successful
  FROM uptime_daily u
  JOIN monitors m ON m.id = u.monitor_id
  JOIN services s ON s.id = m.service_id
  WHERE s.is_public AND u.day >= (current_date - ($1::int - 1))
  GROUP BY m.service_id, u.day
  ORDER BY u.day
`;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

publicRouter.get('/public/status', publicLimiter, async (_req, res, next) => {
  try {
    const [services, uptime] = await Promise.all([
      prisma.$queryRawUnsafe<StatusRow[]>(STATUS_SQL),
      prisma.$queryRawUnsafe<UptimeRow[]>(UPTIME_SQL, DAYS),
    ]);

    const byService = new Map<number, Map<string, UptimeDayDto>>();
    for (const row of uptime) {
      const total = Number(row.total);
      const successful = Number(row.successful);
      const map = byService.get(row.service_id) ?? new Map();
      map.set(isoDay(row.day), {
        day: isoDay(row.day),
        total,
        successful,
        uptime: total === 0 ? null : successful / total,
      });
      byService.set(row.service_id, map);
    }

    // A continuous 90-day axis, so gaps render as "no data" rather than
    // silently shifting the bars along.
    const today = new Date();
    const axis: string[] = [];
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      axis.push(isoDay(d));
    }

    const payload: PublicStatusDto = {
      generatedAt: new Date().toISOString(),
      days: DAYS,
      services: services.map((s): PublicServiceDto => {
        const map = byService.get(s.service_id) ?? new Map<string, UptimeDayDto>();
        const history = axis.map(
          (day): UptimeDayDto =>
            map.get(day) ?? { day, total: 0, successful: 0, uptime: null },
        );
        const withData = history.filter((h) => h.uptime !== null);
        const overall =
          withData.length === 0
            ? null
            : withData.reduce((sum, h) => sum + h.successful, 0) /
              withData.reduce((sum, h) => sum + h.total, 0);

        return {
          serviceId: s.service_id,
          name: s.service_name,
          description: s.description,
          status: s.status as PublicServiceDto['status'],
          uptime90d: overall,
          history,
        };
      }),
    };

    res.json(payload);
  } catch (err) {
    next(err);
  }
});
