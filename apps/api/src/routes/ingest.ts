import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ingestErrorSchema, type IngestResponse } from '@pulsewatch/shared';
import { upsertFingerprint } from '@pulsewatch/shared/fingerprint';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

export const ingestRouter = Router();

/**
 * An SDK in a retry loop can hammer this endpoint during the very outage it is
 * reporting, so the limit is per API key rather than per IP.
 */
const ingestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.header('x-api-key') ?? req.ip ?? 'unknown',
  message: {
    error: { code: 'RATE_LIMITED', message: 'Too many reports, slow down' },
  },
});

ingestRouter.post(
  '/ingest/errors',
  ingestLimiter,
  requireApiKey,
  validateBody(ingestErrorSchema),
  async (req, res, next) => {
    try {
      const serviceId = req.apiKeyServiceId!;
      const { errorType, message, severity, title } = req.body;

      const fp = await upsertFingerprint(prisma, errorType, message);

      // Deduplication: if this exact problem is already being worked on for
      // this service, add to that incident instead of opening a second one.
      const existing = await prisma.incident.findFirst({
        where: { serviceId, fingerprintId: fp.id, status: { not: 'resolved' } },
        select: { id: true },
      });

      if (existing) {
        await prisma.incidentEvent.create({
          data: {
            incidentId: existing.id,
            userId: null,
            type: 'comment',
            message: `Seen again via ingest API (${fp.occurrences} total occurrences): ${message}`,
          },
        });
        return res.status(200).json({
          incidentId: existing.id,
          created: false,
          occurrences: fp.occurrences,
        } satisfies IngestResponse);
      }

      const service = await prisma.service.findUnique({
        where: { id: serviceId },
        select: { name: true },
      });
      if (!service) throw new HttpError(404, 'NOT_FOUND', 'Service no longer exists');

      try {
        const incident = await prisma.$transaction(async (tx) => {
          const created = await tx.incident.create({
            data: {
              serviceId,
              fingerprintId: fp.id,
              title: title || `${service.name}: ${errorType}`,
              description: message,
              errorType,
              severity,
              status: 'open',
              source: 'api',
            },
          });
          await tx.incidentEvent.create({
            data: {
              incidentId: created.id,
              userId: null,
              type: 'opened',
              message:
                `Reported via ingest API: ${message}` +
                (fp.occurrences > 1 ? ` — seen ${fp.occurrences} times` : ''),
            },
          });
          return created;
        });

        return res
          .status(201)
          .json({ incidentId: incident.id, created: true, occurrences: fp.occurrences });
      } catch (err) {
        // Two reports racing: the loser attaches to the winner's incident.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const winner = await prisma.incident.findFirst({
            where: { serviceId, fingerprintId: fp.id, status: { not: 'resolved' } },
            select: { id: true },
          });
          if (winner) {
            return res
              .status(200)
              .json({ incidentId: winner.id, created: false, occurrences: fp.occurrences });
          }
        }
        throw err;
      }
    } catch (err) {
      return next(err);
    }
  },
);
