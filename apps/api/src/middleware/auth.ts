import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@pulsewatch/shared';
import { verifyToken, type TokenPayload } from '../lib/auth.js';
import { HttpError } from './errorHandler.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Missing bearer token'));
  }

  const payload = verifyToken(header.slice('Bearer '.length).trim());
  if (!payload) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Token is invalid or expired'));
  }

  req.user = payload;
  return next();
}

/**
 * Role gate. Must run after requireAuth.
 * `admin` is deliberately not implicit: list every role that may pass.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new HttpError(403, 'FORBIDDEN', `This action requires one of: ${roles.join(', ')}`),
      );
    }
    return next();
  };
}
