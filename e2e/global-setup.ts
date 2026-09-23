/**
 * Puts the test database into a known state before the browser tests: schema
 * migrated, every table empty, and two accounts to log in with.
 *
 * Refuses to run unless the database name ends in `_test`, the same guard the
 * API tests use -- this truncates everything.
 */
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pulsewatch:pulsewatch@localhost:5432/pulsewatch_test';

export const E2E_PASSWORD = 'e2e-password-123';

export default async function globalSetup() {
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset "${dbName}" for E2E: the name must end in "_test".`);
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });

  const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
  try {
    await prisma.$executeRawUnsafe(
      `TRUNCATE incident_runbooks, incident_commits, incident_events, incidents, fingerprints,
                runbooks, uptime_daily, check_results, monitors, api_keys, services, users
       RESTART IDENTITY CASCADE`,
    );

    const passwordHash = await bcrypt.hash(E2E_PASSWORD, 10);
    await prisma.user.createMany({
      data: [
        { name: 'E2E Admin', email: 'admin@e2e.test', passwordHash, role: 'admin' },
        { name: 'E2E Engineer', email: 'engineer@e2e.test', passwordHash, role: 'engineer' },
      ],
    });
  } finally {
    await prisma.$disconnect();
  }
}
