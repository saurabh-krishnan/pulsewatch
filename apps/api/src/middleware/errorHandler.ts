import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

/** Every error response is shaped `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express only treats a 4-argument function as an error handler, so _next must stay.
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }

  console.error('Unhandled error:', err);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
