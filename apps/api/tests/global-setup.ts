/**
 * Runs once before the API test files: brings the test database's schema up to
 * date, so the suite works on a fresh clone with nothing but Postgres running.
 */
import { execSync } from 'node:child_process';
import { assertTestDatabaseName, databaseNameFromUrl, TEST_DATABASE_URL } from './testDb.js';

export default function setup() {
  assertTestDatabaseName(databaseNameFromUrl(TEST_DATABASE_URL));

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
