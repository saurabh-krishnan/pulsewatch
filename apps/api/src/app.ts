import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { env } from './env.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { demoRouter } from './routes/demo.js';
import { healthRouter } from './routes/health.js';
import { incidentsRouter } from './routes/incidents.js';
import { ingestRouter } from './routes/ingest.js';
import { monitorsRouter } from './routes/monitors.js';
import { publicRouter } from './routes/publicStatus.js';
import { runbooksRouter } from './routes/runbooks.js';
import { searchRouter } from './routes/search.js';
import { servicesRouter } from './routes/services.js';
import { statsRouter } from './routes/stats.js';

export function createApp() {
  const app = express();

  // Behind a hosting platform's load balancer every request arrives from the
  // proxy's address. Without this, the rate limiters would count every visitor
  // as one client. A hop count rather than `true`, so a client cannot spoof
  // its way past the limiter with its own X-Forwarded-For header.
  if (env.TRUST_PROXY > 0) app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  if (env.NODE_ENV !== 'test') app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));

  app.use('/api', healthRouter);
  app.use('/api', authRouter);
  app.use('/api', servicesRouter);
  app.use('/api', monitorsRouter);
  app.use('/api', incidentsRouter);
  app.use('/api', runbooksRouter);
  app.use('/api', searchRouter);
  app.use('/api', statsRouter);
  app.use('/api', demoRouter);
  // Authenticated by API key, not JWT.
  app.use('/api', ingestRouter);
  // No authentication at all: this is what customers see.
  app.use('/api', publicRouter);

  serveWebApp(app);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

/**
 * In production the API serves the React build itself (guide section 12,
 * option A): one origin, one deployable, no CORS between them. In development
 * Vite serves the frontend and proxies /api here, so this stays off.
 */
function serveWebApp(app: express.Express) {
  const dir = env.WEB_DIST_DIR;
  if (!dir) return;

  const indexHtml = path.resolve(dir, 'index.html');
  if (!existsSync(indexHtml)) {
    console.warn(`[api] WEB_DIST_DIR is set but ${indexHtml} does not exist; not serving the UI`);
    return;
  }

  app.use(
    express.static(dir, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints everything under /assets, so it can be cached
        // forever; index.html must always be re-checked to pick up a deploy.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  // Client-side routes (/incidents/42, /status) all load the same page.
  // Anything under /api/ is left alone so a typo there still gets a JSON 404.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
