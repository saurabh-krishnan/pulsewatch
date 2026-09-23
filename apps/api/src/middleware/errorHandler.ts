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

const BODY_PARSER_ERRORS: Record<string, { status: number; body: { code: string; message: string } }> = {
  'entity.parse.failed': {
    status: 400,
    body: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' },
  },
  'entity.too.large': {
    status: 413,
    body: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
  },
  'encoding.unsupported': {
    status: 415,
    body: { code: 'UNSUPPORTED_ENCODING', message: 'Request body encoding is not supported' },
  },
};

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

  // express.json() throws these for the client's mistakes: a body that is not
  // JSON, or one over the size limit. Without this they would fall through to
  // the 500 below and blame the server.
  const bodyError = BODY_PARSER_ERRORS[(err as { type?: string } | null)?.type ?? ''];
  if (bodyError) {
    return res.status(bodyError.status).json({ error: bodyError.body });
  }

  console.error('Unhandled error:', err);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
