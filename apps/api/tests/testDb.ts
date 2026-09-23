/**
 * Where the API tests point, and the guard that stops them pointing anywhere
 * else. Every test file truncates every table, so running them against the
 * dev database by mistake would wipe it. This refuses unless the database name
 * ends in `_test` -- checked on the URL before migrating, and again against
 * current_database() before every reset.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pulsewatch:pulsewatch@localhost:5432/pulsewatch_test';

export function assertTestDatabaseName(name: string): void {
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run destructive API tests against database "${name}". ` +
        'The test database name must end in "_test".',
    );
  }
}

export function databaseNameFromUrl(url: string): string {
  return new URL(url).pathname.replace(/^\//, '');
}
