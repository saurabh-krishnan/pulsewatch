import { Router } from 'express';
import { prisma } from '../db.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  let database: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'up';
  } catch {
    database = 'down';
  }

  res.status(database === 'up' ? 200 : 503).json({
    status: database === 'up' ? 'ok' : 'degraded',
    uptimeSeconds: Math.round(process.uptime()),
    database,
    timestamp: new Date().toISOString(),
  });
});
