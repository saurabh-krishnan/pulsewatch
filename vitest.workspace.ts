import { defineWorkspace } from 'vitest/config';

/**
 * Two kinds of test with different needs:
 *
 * - unit: pure functions and a local HTTP server. No database, so they run in
 *   parallel and take about a second.
 * - api: Supertest against a real Postgres test database. Every file truncates
 *   every table, so the files must run one at a time or they would wipe each
 *   other's fixtures mid-test.
 */
export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/**/*.test.ts', 'apps/worker/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'api',
      include: ['apps/api/tests/**/*.test.ts'],
      globalSetup: ['apps/api/tests/global-setup.ts'],
      setupFiles: ['apps/api/tests/setup.ts'],
      fileParallelism: false,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
      // bcrypt at cost 10 plus a real database: slower than a unit test.
      testTimeout: 20_000,
      hookTimeout: 60_000,
    },
  },
]);
