import { createApp } from './app.js';
import { prisma } from './db.js';
import { env } from './env.js';

const app = createApp();
const server = app.listen(env.API_PORT, () => {
  console.log(`[api] listening on http://localhost:${env.API_PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`[api] ${signal} received, shutting down`);
  server.close(() => void 0);
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
