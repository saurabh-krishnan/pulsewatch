import { Router } from 'express';
import {
  commentSchema,
  createIncidentSchema,
  incidentFiltersSchema,
  resolveIncidentSchema,
  updateIncidentSchema,
  type IncidentDto,
  type IncidentEventDto,
  type IncidentSeverity,
  type IncidentSource,
  type IncidentStatus,
} from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { intParam, validateBody } from '../middleware/validate.js';

export const incidentsRouter = Router();

type IncidentRow = {
  id: number;
  serviceId: number;
  monitorId: number | null;
  title: string;
  description: string | null;
  errorType: string | null;
  severity: string;
  status: string;
  source: string;
  tags: string[];
  openedAt: Date;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  service: { name: string };
  monitor: { url: string } | null;
  events?: {
    id: bigint;
    type: string;
    message: string | null;
    createdAt: Date;
    user: { name: string } | null;
  }[];
};

function toIncidentDto(i: IncidentRow): IncidentDto {
  return {
    id: i.id,
    serviceId: i.serviceId,
    serviceName: i.service.name,
    monitorId: i.monitorId,
    monitorUrl: i.monitor?.url ?? null,
    title: i.title,
    description: i.description,
    errorType: i.errorType,
    severity: i.severity as IncidentSeverity,
    status: i.status as IncidentStatus,
    source: i.source as IncidentSource,
    tags: i.tags,
    openedAt: i.openedAt.toISOString(),
    acknowledgedAt: i.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: i.resolvedAt?.toISOString() ?? null,
    resolutionNote: i.resolutionNote,
    ...(i.events && {
      events: i.events.map(
        (e): IncidentEventDto => ({
          id: Number(e.id),
          type: e.type,
          message: e.message,
          createdAt: e.createdAt.toISOString(),
          userName: e.user?.name ?? null,
        }),
      ),
    }),
  };
}

const listInclude = {
  service: { select: { name: true } },
  monitor: { select: { url: true } },
} as const;

/** Every state change writes a timeline entry; nothing changes an incident without one. */
async function logEvent(
  incidentId: number,
  userId: number | null,
  type: string,
  message: string | null,
) {
  await prisma.incidentEvent.create({ data: { incidentId, userId, type, message } });
}

incidentsRouter.get('/incidents', requireAuth, async (req, res, next) => {
  try {
    const filters = incidentFiltersSchema.parse(req.query);

    const incidents = await prisma.incident.findMany({
      where: {
        ...(filters.status && { status: filters.status }),
        ...(filters.serviceId && { serviceId: filters.serviceId }),
        ...(filters.severity && { severity: filters.severity }),
        // Phase 5 replaces this with proper full-text search over search_vector.
        ...(filters.q && {
          OR: [
            { title: { contains: filters.q, mode: 'insensitive' as const } },
            { description: { contains: filters.q, mode: 'insensitive' as const } },
          ],
        }),
      },
      include: listInclude,
      orderBy: [{ status: 'asc' }, { openedAt: 'desc' }],
      take: 200,
    });

    res.json(incidents.map(toIncidentDto));
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post(
  '/incidents',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(createIncidentSchema),
  async (req, res, next) => {
    try {
      const { serviceId, title, description, severity, errorType, tags } = req.body;

      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');

      const incident = await prisma.$transaction(async (tx) => {
        const created = await tx.incident.create({
          data: {
            serviceId,
            title,
            description: description || null,
            errorType: errorType || null,
            severity,
            tags,
            status: 'open',
            source: 'manual',
          },
          include: listInclude,
        });

        await tx.incidentEvent.create({
          data: {
            incidentId: created.id,
            userId: req.user!.sub,
            type: 'opened',
            message: 'Opened manually',
          },
        });

        return created;
      });

      res.status(201).json(toIncidentDto(incident));
    } catch (err) {
      next(err);
    }
  },
);

incidentsRouter.get('/incidents/:id', requireAuth, async (req, res, next) => {
  try {
    const incident = await prisma.incident.findUnique({
      where: { id: intParam(req, 'id') },
      include: {
        ...listInclude,
        events: {
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!incident) throw new HttpError(404, 'NOT_FOUND', 'Incident not found');
    res.json(toIncidentDto(incident));
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post(
  '/incidents/:id/acknowledge',
  requireAuth,
  requireRole('admin', 'engineer'),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const incident = await prisma.incident.findUnique({ where: { id } });
      if (!incident) throw new HttpError(404, 'NOT_FOUND', 'Incident not found');
      if (incident.status === 'resolved') {
        throw new HttpError(409, 'ALREADY_RESOLVED', 'This incident is already resolved');
      }
      if (incident.status === 'acknowledged') {
        throw new HttpError(409, 'ALREADY_ACKNOWLEDGED', 'This incident is already acknowledged');
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.incident.update({
          where: { id },
          data: { status: 'acknowledged', acknowledgedAt: new Date() },
          include: listInclude,
        });
        await tx.incidentEvent.create({
          data: { incidentId: id, userId: req.user!.sub, type: 'acknowledged', message: null },
        });
        return result;
      });

      res.json(toIncidentDto(updated));
    } catch (err) {
      next(err);
    }
  },
);

incidentsRouter.post(
  '/incidents/:id/resolve',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(resolveIncidentSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const incident = await prisma.incident.findUnique({ where: { id } });
      if (!incident) throw new HttpError(404, 'NOT_FOUND', 'Incident not found');
      if (incident.status === 'resolved') {
        throw new HttpError(409, 'ALREADY_RESOLVED', 'This incident is already resolved');
      }

      const { note } = req.body;
      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.incident.update({
          where: { id },
          data: {
            status: 'resolved',
            resolvedAt: new Date(),
            resolutionNote: note || null,
          },
          include: listInclude,
        });
        await tx.incidentEvent.create({
          data: {
            incidentId: id,
            userId: req.user!.sub,
            type: 'resolved',
            message: note || null,
          },
        });
        return result;
      });

      res.json(toIncidentDto(updated));
    } catch (err) {
      next(err);
    }
  },
);

incidentsRouter.post(
  '/incidents/:id/comments',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(commentSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const incident = await prisma.incident.findUnique({ where: { id } });
      if (!incident) throw new HttpError(404, 'NOT_FOUND', 'Incident not found');

      await logEvent(id, req.user!.sub, 'comment', req.body.message);
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  },
);

incidentsRouter.patch(
  '/incidents/:id',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(updateIncidentSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const incident = await prisma.incident.findUnique({ where: { id } });
      if (!incident) throw new HttpError(404, 'NOT_FOUND', 'Incident not found');

      const { severity } = req.body;
      if (!severity || severity === incident.severity) {
        return res.json(
          toIncidentDto(
            await prisma.incident.findUniqueOrThrow({ where: { id }, include: listInclude }),
          ),
        );
      }

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.incident.update({
          where: { id },
          data: { severity },
          include: listInclude,
        });
        await tx.incidentEvent.create({
          data: {
            incidentId: id,
            userId: req.user!.sub,
            type: 'severity_changed',
            message: `${incident.severity} → ${severity}`,
          },
        });
        return result;
      });

      return res.json(toIncidentDto(updated));
    } catch (err) {
      return next(err);
    }
  },
);
