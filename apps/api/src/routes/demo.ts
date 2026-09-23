/**
 * Admin-only control over the demo target, for the live demo.
 *
 * In the deployed container the demo target listens on localhost only, so the
 * public cannot break it and there is no second service to cold-start. This is
 * the one way to flip it: an admin presses a button, the API relays the mode
 * to the fixed DEMO_TARGET_URL. The URL comes from configuration, never from
 * the request, so this is not a way to make the server fetch arbitrary URLs.
 *
 * Mounted only when DEMO_TARGET_URL is set.
 */
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

export const demoRouter = Router();

const modeSchema = z.object({ mode: z.enum(['healthy', 'slow', 'failing']) });

async function relay(method: 'GET' | 'POST', body?: unknown) {
  if (!env.DEMO_TARGET_URL) {
    throw new HttpError(404, 'DEMO_DISABLED', 'Demo controls are not enabled on this install');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`${env.DEMO_TARGET_URL}/mode`, {
      method,
      signal: controller.signal,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`demo target answered ${res.status}`);
    return (await res.json()) as { mode: string };
  } catch {
    throw new HttpError(502, 'DEMO_UNREACHABLE', 'The demo target is not responding');
  } finally {
    clearTimeout(timer);
  }
}

demoRouter.get('/demo', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    res.json(await relay('GET'));
  } catch (err) {
    next(err);
  }
});

demoRouter.post(
  '/demo/mode',
  requireAuth,
  requireRole('admin'),
  validateBody(modeSchema),
  async (req, res, next) => {
    try {
      res.json(await relay('POST', { mode: req.body.mode }));
    } catch (err) {
      next(err);
    }
  },
);
