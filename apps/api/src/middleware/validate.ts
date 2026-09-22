import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { HttpError } from './errorHandler.js';

/**
 * Replaces req.body with the parsed result, so handlers get the coerced,
 * defaulted values rather than raw JSON. ZodError is turned into a 400 by the
 * central error handler.
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data as z.infer<T>;
    return next();
  };
}

/** Parses `:id` style params as positive integers, 400 if they are not. */
export function intParam(req: Request, name: string): number {
  const value = Number(req.params[name]);
  if (!Number.isInteger(value) || value < 1) {
    throw new HttpError(400, 'INVALID_PARAM', `${name} must be a positive integer`);
  }
  return value;
}
