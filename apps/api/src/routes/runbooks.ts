import { Router } from 'express';
import { createRunbookSchema, updateRunbookSchema, type RunbookDto } from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { intParam, validateBody } from '../middleware/validate.js';

export const runbooksRouter = Router();

type RunbookRow = {
  id: number;
  serviceId: number | null;
  title: string;
  bodyMd: string;
  version: number;
  updatedAt: Date;
  service: { name: string } | null;
  updatedByUser: { name: string } | null;
};

function toRunbookDto(r: RunbookRow): RunbookDto {
  return {
    id: r.id,
    serviceId: r.serviceId,
    serviceName: r.service?.name ?? null,
    title: r.title,
    bodyMd: r.bodyMd,
    version: r.version,
    updatedAt: r.updatedAt.toISOString(),
    updatedByName: r.updatedByUser?.name ?? null,
  };
}

const include = {
  service: { select: { name: true } },
  updatedByUser: { select: { name: true } },
} as const;

runbooksRouter.get('/runbooks', requireAuth, async (req, res, next) => {
  try {
    const serviceId = req.query.serviceId ? Number(req.query.serviceId) : undefined;
    const runbooks = await prisma.runbook.findMany({
      where: serviceId
        ? // A general runbook (serviceId null) applies everywhere, so include it.
          { OR: [{ serviceId }, { serviceId: null }] }
        : undefined,
      include,
      orderBy: { title: 'asc' },
    });
    res.json(runbooks.map(toRunbookDto));
  } catch (err) {
    next(err);
  }
});

runbooksRouter.get('/runbooks/:id', requireAuth, async (req, res, next) => {
  try {
    const runbook = await prisma.runbook.findUnique({
      where: { id: intParam(req, 'id') },
      include,
    });
    if (!runbook) throw new HttpError(404, 'NOT_FOUND', 'Runbook not found');
    res.json(toRunbookDto(runbook));
  } catch (err) {
    next(err);
  }
});

runbooksRouter.post(
  '/runbooks',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(createRunbookSchema),
  async (req, res, next) => {
    try {
      const { serviceId, title, bodyMd } = req.body;
      if (serviceId) {
        const service = await prisma.service.findUnique({ where: { id: serviceId } });
        if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service not found');
      }

      const runbook = await prisma.runbook.create({
        data: { serviceId: serviceId ?? null, title, bodyMd, updatedBy: req.user!.sub },
        include,
      });
      res.status(201).json(toRunbookDto(runbook));
    } catch (err) {
      next(err);
    }
  },
);

runbooksRouter.patch(
  '/runbooks/:id',
  requireAuth,
  requireRole('admin', 'engineer'),
  validateBody(updateRunbookSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.runbook.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Runbook not found');

      const { title, bodyMd, serviceId } = req.body;
      const runbook = await prisma.runbook.update({
        where: { id },
        data: {
          ...(title !== undefined && { title }),
          ...(bodyMd !== undefined && { bodyMd }),
          ...(serviceId !== undefined && { serviceId: serviceId ?? null }),
          // Editing a runbook bumps its version: "which version fixed it last
          // time" is a question worth being able to answer later.
          version: { increment: 1 },
          updatedBy: req.user!.sub,
          updatedAt: new Date(),
        },
        include,
      });
      res.json(toRunbookDto(runbook));
    } catch (err) {
      next(err);
    }
  },
);

runbooksRouter.delete(
  '/runbooks/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.runbook.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Runbook not found');
      await prisma.runbook.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);
