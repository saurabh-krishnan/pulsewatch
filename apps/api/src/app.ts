import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { monitorsRouter } from './routes/monitors.js';
import { runbooksRouter } from './routes/runbooks.js';
import { servicesRouter } from './routes/services.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan('dev'));

  // Routes are mounted under /api. More land here each phase:
  // incidents, runbooks, search, stats, ingest, public.
  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', servicesRouter);
  app.use('/api', monitorsRouter);
  app.use('/api', incidentsRouter);
  app.use('/api', runbooksRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
