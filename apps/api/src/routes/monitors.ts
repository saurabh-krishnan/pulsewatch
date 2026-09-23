import { Router } from 'express';
import { updateMonitorSchema, type MonitorDto, type MonitorStatus } from '@pulsewatch/shared';
import { prisma } from '../db.js';
import { assertAllowedTarget } from '../lib/targets.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { intParam, validateBody } from '../middleware/validate.js';

export const monitorsRouter = Router();

type MonitorRow = {
  id: number;
  serviceId: number;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  expectedStatus: number;
  failureThreshold: number;
  recoveryThreshold: number;
  status: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  nextCheckAt: Date;
  lastCheckedAt: Date | null;
};

export function toMonitorDto(m: MonitorRow): MonitorDto {
  return {
    id: m.id,
    serviceId: m.serviceId,
    url: m.url,
    method: m.method,
    intervalSeconds: m.intervalSeconds,
    timeoutMs: m.timeoutMs,
    expectedStatus: m.expectedStatus,
    failureThreshold: m.failureThreshold,
    recoveryThreshold: m.recoveryThreshold,
    status: m.status as MonitorStatus,
    consecutiveFailures: m.consecutiveFailures,
    consecutiveSuccesses: m.consecutiveSuccesses,
    nextCheckAt: m.nextCheckAt.toISOString(),
    lastCheckedAt: m.lastCheckedAt?.toISOString() ?? null,
  };
}

monitorsRouter.get('/monitors/:id', requireAuth, async (req, res, next) => {
  try {
    const monitor = await prisma.monitor.findUnique({ where: { id: intParam(req, 'id') } });
    if (!monitor) throw new HttpError(404, 'NOT_FOUND', 'Monitor not found');
    res.json(toMonitorDto(monitor));
  } catch (err) {
    next(err);
  }
});

monitorsRouter.patch(
  '/monitors/:id',
  requireAuth,
  requireRole('admin'),
  validateBody(updateMonitorSchema),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.monitor.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Monitor not found');

      const { status, url } = req.body;
      // Changing the URL is the obvious way around a check done only on create.
      if (url !== undefined) await assertAllowedTarget(url);

      // Only pausing and resuming are user-driven. up/down/unknown belong to the
      // worker's state machine, so accepting them here would corrupt its view.
      if (status !== undefined && status !== 'paused' && status !== 'unknown') {
        throw new HttpError(
          400,
          'INVALID_STATUS',
          "Only 'paused' (pause) and 'unknown' (resume) can be set manually",
        );
      }

      const monitor = await prisma.monitor.update({
        where: { id },
        data: {
          ...req.body,
          // Resuming should check promptly rather than waiting out the old schedule.
          ...(status === 'unknown' && { nextCheckAt: new Date() }),
        },
      });
      res.json(toMonitorDto(monitor));
    } catch (err) {
      next(err);
    }
  },
);

monitorsRouter.delete(
  '/monitors/:id',
  requireAuth,
  requireRole('admin'),
  async (req, res, next) => {
    try {
      const id = intParam(req, 'id');
      const existing = await prisma.monitor.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'NOT_FOUND', 'Monitor not found');
      await prisma.monitor.delete({ where: { id } });
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
);

/** Response-time chart data (guide section 8). Filled with real rows in Phase 2. */
monitorsRouter.get('/monitors/:id/results', requireAuth, async (req, res, next) => {
  try {
    const id = intParam(req, 'id');
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const results = await prisma.checkResult.findMany({
      where: {
        monitorId: id,
        ...((from || to) && {
          checkedAt: { ...(from && { gte: from }), ...(to && { lte: to }) },
        }),
      },
      orderBy: { checkedAt: 'desc' },
      take: 500,
    });

    res.json(
      results.map((r) => ({
        id: Number(r.id),
        checkedAt: r.checkedAt.toISOString(),
        success: r.success,
        statusCode: r.statusCode,
        responseTimeMs: r.responseTimeMs,
        errorMessage: r.errorMessage,
      })),
    );
  } catch (err) {
    next(err);
  }
});
