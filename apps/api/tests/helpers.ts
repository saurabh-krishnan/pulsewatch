/**
 * Shared fixtures for the API tests. Imported by test files, never by setup.ts,
 * so the environment is already pointed at the test database when this loads.
 */
import type { UserRole } from '@pulsewatch/shared';
import request from 'supertest';
import { afterAll } from 'vitest';
import { createApp } from '../src/app.js';
import { prisma } from '../src/db.js';
import { hashPassword, signToken } from '../src/lib/auth.js';
import { assertTestDatabaseName } from './testDb.js';

export { prisma };

export const app = createApp();
export const api = () => request(app);

const TABLES = [
  'incident_runbooks',
  'incident_commits',
  'incident_events',
  'incidents',
  'fingerprints',
  'runbooks',
  'uptime_daily',
  'check_results',
  'monitors',
  'api_keys',
  'services',
  'users',
];

/** Empties every table. Refuses unless connected to a *_test database. */
export async function resetDb(): Promise<void> {
  const [{ current_database: name }] = await prisma.$queryRawUnsafe<
    { current_database: string }[]
  >('SELECT current_database()');
  assertTestDatabaseName(name);

  await prisma.$executeRawUnsafe(
    `TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

afterAll(async () => {
  await prisma.$disconnect();
});

let counter = 0;

/**
 * A user straight in the database, plus a token for them. Most tests use this
 * instead of the login endpoint: it is faster, and it keeps them clear of the
 * login rate limiter, which has its own test.
 */
export async function makeUser(role: UserRole, password = 'correct-horse-battery') {
  counter += 1;
  const user = await prisma.user.create({
    data: {
      name: `${role} ${counter}`,
      email: `${role}${counter}@pulsewatch.test`,
      passwordHash: await hashPassword(password),
      role,
    },
  });
  return {
    user,
    password,
    token: signToken({ sub: user.id, email: user.email, role }),
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function makeService(name = `svc-${++counter}`, ownerId?: number) {
  return prisma.service.create({ data: { name, ownerId: ownerId ?? null, tags: [] } });
}

export async function makeMonitor(serviceId: number, url = 'http://monitor.example.test/health') {
  return prisma.monitor.create({ data: { serviceId, url } });
}

export const VALID_MONITOR = {
  url: 'http://api.example.test/health',
  method: 'GET',
  intervalSeconds: 60,
  timeoutMs: 5000,
  expectedStatus: 200,
  failureThreshold: 3,
  recoveryThreshold: 2,
};
