import { Router } from 'express';
import {
  createMonitorSchema,
  createServiceSchema,
  updateServiceSchema,
  type MonitorDto,
  type ServiceDto,
} from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { intParam, validateBody } from '../middleware/validate.js';
import { toMonitorDto } from './monitors.js';

export const servicesRouter = Router();

type ServiceRow = {
  id: number;
  name: string;
  description: string | null;
  ownerId: number | null;
  tags: string[];
  isPublic: boolean;
  createdAt: Date;
  owner: { name: string } | null;
  _count: { monitors: number };
};

function toServiceDto(s: ServiceRow): ServiceDto {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    ownerId: s.ownerId,
    ownerName: s.owner?.name ?? null,
    tags: s.tags,
    isPublic: s.isPublic,
    createdAt: s.createdAt.toISOString(),
    monitorCount: s._count.monitors,
  };
}

const withRelations = {
  owner: { select: { name: true } },
  _count: { select: { monitors: true } },
} as const;

// Any authenticated user can read services.
servicesRouter.get('/services', requireAuth, async (_req, res, next) => {
  try {
    const services = await prisma.service.findMany({
      include: withRelations,
      orderBy: { name: 'asc' },
    });
    res.json(services.map(toServiceDto));
  } catch (err) {
    next(err);
  }
});

servicesRouter.post(
  '/services',
  requireAuth,
  requireRole('admin'),
  validateBody(createServiceSchema),
  async (req, res, next) => {
    try {
      const { name, description, tags, isPublic } = req.body;

      const existing = await prisma.service.findUnique({ where: { name } });
      if (existing) {
        throw new HttpError(409, 'NAME_TAKEN', `A service named '${name}' already exists`);
      }

      const service = await prisma.service.create({
        data: {
          name,
          description: description || null,
          tags,
          isPublic,
          ownerId: req.user!.sub,
        },
        include: withRelations,
      });
      res.status(201).json(toServiceDto(service));
    } catch (err) {
      next(err);
    }
  },
);

servicesRouter.get('/services/:id', requireAuth, async (req, res, next) => {
  try {
    const service = await prisma.service.findUnique({
      where: { id: intParam(req, 'id') },
      include: withRelations,
    });
    if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
    res.json(toServiceDto(service));
  } catch (err) {
    next(err);
  }
});

servicesRouter.patch(
  '/services/:id',
  requireAuth,
  requireRole('admin'),
  validateBody(updateServiceSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.service.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Service not found');

      const { name, description, tags, isPublic } = req.body;
      const service = await prisma.service.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(description !== undefined && { description: description || null }),
          ...(tags !== undefined && { tags }),
          ...(isPublic !== undefined && { isPublic }),
        },
        include: withRelations,
      });
      res.json(toServiceDto(service));
    } catch (err) {
      next(err);
    }
  },
);

servicesRouter.delete(
  '/services/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.service.findUnique({
        where: { id },
        include: { _count: { select: { incidents: true } } },
      });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Service not found');

      // Monitors cascade, but incidents reference services with ON DELETE RESTRICT
      // on purpose: outage history should not vanish because someone tidied up.
      if (existing._count.incidents > 0) {
        throw new HttpError(
          409,
          'SERVICE_HAS_INCIDENTS',
          `Cannot delete: ${existing._count.incidents} incident(s) reference this service`,
        );
      }

      await prisma.service.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

// ---------- monitors nested under a service ----------

servicesRouter.get('/services/:id/monitors', requireAuth, async (req, res, next) => {
  try {
    const serviceId = intParam(req, 'id');
    const service = await prisma.service.findUnique({ where: { id: serviceId } });
    if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');

    const monitors = await prisma.monitor.findMany({
      where: { serviceId },
      orderBy: { id: 'asc' },
    });
    res.json(monitors.map(toMonitorDto) satisfies MonitorDto[]);
  } catch (err) {
    next(err);
  }
});

servicesRouter.post(
  '/services/:id/monitors',
  requireAuth,
  requireRole('admin'),
  validateBody(createMonitorSchema),
  async (req, res, next) => {
    try {
      const serviceId = intParam(req, 'id');
      const service = await prisma.service.findUnique({ where: { id: serviceId } });
      if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');

      const monitor = await prisma.monitor.create({
        data: { serviceId, ...req.body },
      });
      res.status(201).json(toMonitorDto(monitor));
    } catch (err) {
      next(err);
    }
  },
);
