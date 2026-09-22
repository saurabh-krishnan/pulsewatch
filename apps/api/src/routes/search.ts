import { Router } from 'express';
import type { SearchResponse, SearchHitDto } from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

export const searchRouter = Router();

interface IncidentHitRow {
  id: number;
  title: string;
  service_name: string;
  status: string;
  severity: string;
  opened_at: Date;
  snippet: string;
  rank: number;
}

interface RunbookHitRow {
  id: number;
  title: string;
  service_name: string | null;
  snippet: string;
  rank: number;
}

/**
 * `plainto_tsquery` treats the input as plain words rather than tsquery syntax,
 * so a user typing `timeout & !pool` gets a search instead of a syntax error.
 * `ts_headline` returns the matching fragment with the terms marked.
 */
const INCIDENT_SEARCH_SQL = `
  SELECT i.id, i.title, s.name AS service_name, i.status, i.severity, i.opened_at,
         ts_headline('english',
           coalesce(i.description, i.title),
           plainto_tsquery('english', $1),
           'MaxWords=24, MinWords=10, ShortWord=2, MaxFragments=1'
         ) AS snippet,
         ts_rank(i.search_vector, plainto_tsquery('english', $1))::float8 AS rank
  FROM incidents i
  JOIN services s ON s.id = i.service_id
  WHERE i.search_vector @@ plainto_tsquery('english', $1)
  ORDER BY rank DESC, i.opened_at DESC
  LIMIT 25
`;

const RUNBOOK_SEARCH_SQL = `
  SELECT r.id, r.title, s.name AS service_name,
         ts_headline('english', r.body_md, plainto_tsquery('english', $1),
           'MaxWords=24, MinWords=10, ShortWord=2, MaxFragments=1'
         ) AS snippet,
         ts_rank(to_tsvector('english', r.title || ' ' || r.body_md),
                 plainto_tsquery('english', $1))::float8 AS rank
  FROM runbooks r
  LEFT JOIN services s ON s.id = r.service_id
  WHERE to_tsvector('english', r.title || ' ' || r.body_md) @@ plainto_tsquery('english', $1)
  ORDER BY rank DESC
  LIMIT 25
`;

/**
 * Fallback for when full-text finds nothing: stemming will not rescue a typo
 * or a partial word, but trigram similarity on the title will.
 */
const INCIDENT_FUZZY_SQL = `
  SELECT i.id, i.title, s.name AS service_name, i.status, i.severity, i.opened_at,
         i.title AS snippet,
         similarity(i.title, $1)::float8 AS rank
  FROM incidents i
  JOIN services s ON s.id = i.service_id
  WHERE similarity(i.title, $1) > 0.25
  ORDER BY rank DESC
  LIMIT 10
`;

searchRouter.get('/search', requireAuth, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2) {
      return res.json({ query: q, incidents: [], runbooks: [], fuzzy: false } satisfies SearchResponse);
    }

    const [incidentRows, runbookRows] = await Promise.all([
      prisma.$queryRawUnsafe<IncidentHitRow[]>(INCIDENT_SEARCH_SQL, q),
      prisma.$queryRawUnsafe<RunbookHitRow[]>(RUNBOOK_SEARCH_SQL, q),
    ]);

    let incidents = incidentRows;
    let fuzzy = false;
    if (incidents.length === 0) {
      incidents = await prisma.$queryRawUnsafe<IncidentHitRow[]>(INCIDENT_FUZZY_SQL, q);
      fuzzy = incidents.length > 0;
    }

    return res.json({
      query: q,
      fuzzy,
      incidents: incidents.map(
        (r): SearchHitDto => ({
          id: r.id,
          title: r.title,
          serviceName: r.service_name,
          snippet: r.snippet,
          rank: r.rank,
          meta: `${r.status} · ${r.severity} · ${r.opened_at.toISOString().slice(0, 10)}`,
        }),
      ),
      runbooks: runbookRows.map(
        (r): SearchHitDto => ({
          id: r.id,
          title: r.title,
          serviceName: r.service_name,
          snippet: r.snippet,
          rank: r.rank,
          meta: r.service_name ?? 'General',
        }),
      ),
    } satisfies SearchResponse);
  } catch (err) {
    return next(err);
  }
});
