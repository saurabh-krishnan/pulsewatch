import { createHash, randomBytes } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db.js';
import { HttpError } from './errorHandler.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireApiKey: the service the key belongs to. */
      apiKeyServiceId?: number;
    }
  }
}

const PREFIX = 'pw_live_';

export function generateApiKey(): { key: string; hash: string; prefix: string } {
  const key = PREFIX + randomBytes(24).toString('hex');
  return {
    key,
    hash: hashApiKey(key),
    // Enough to recognise a key in a list, not enough to use it.
    prefix: key.slice(0, PREFIX.length + 6),
  };
}

/**
 * Keys are stored hashed, like passwords. A leaked database dump then contains
 * no working credentials. No salt is needed: the key is already 24 random
 * bytes, so there is nothing to brute-force or rainbow-table.
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export async function requireApiKey(req: Request, _res: Response, next: NextFunction) {
  const presented = req.header('x-api-key');
  if (!presented) {
    return next(new HttpError(401, 'MISSING_API_KEY', 'X-Api-Key header is required'));
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(presented) },
    select: { serviceId: true, revokedAt: true },
  });

  if (!record || record.revokedAt) {
    // Same answer either way: a revoked key should not be distinguishable
    // from one that never existed.
    return next(new HttpError(401, 'INVALID_API_KEY', 'API key is not valid'));
  }

  req.apiKeyServiceId = record.serviceId;
  return next();
}
