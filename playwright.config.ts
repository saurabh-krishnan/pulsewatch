import { defineConfig } from '@playwright/test';

/**
 * End-to-end tests (guide Phase 7 step 4).
 *
 * Playwright starts its own copy of the whole stack -- API, worker, demo target
 * and web -- on ports shifted by 10, against the *test* database. So it never
 * collides with a dev stack already running on 4000/5173, and never touches
 * dev data.
 *
 * Locally it drives the Edge that ships with Windows (no browser download).
 * In CI, set CI=1 and run `npx playwright install chromium` first.
 */
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://pulsewatch:pulsewatch@localhost:5432/pulsewatch_test';

export const E2E = {
  api: 'http://localhost:4010',
  web: 'http://localhost:5183',
  demo: 'http://localhost:4110',
};

const stackEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'e2e-only-secret-long-enough-for-hs256-signing',
  JWT_EXPIRES_IN: '1h',
  CORS_ORIGIN: E2E.web,
  API_PORT: '4010',
  DEMO_TARGET_PORT: '4110',
  VITE_API_URL: E2E.api,
  // The monitors under test point at the local demo target.
  ALLOW_PRIVATE_MONITOR_TARGETS: 'true',
  // Faster than the default so an outage is noticed within seconds.
  WORKER_POLL_SECONDS: '2',
  DISCORD_WEBHOOK_URL: '',
};

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  reporter: [['list']],
  use: {
    baseURL: E2E.web,
    channel: process.env.CI ? undefined : 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npx run-p e2e:api e2e:worker e2e:demo',
      url: `${E2E.api}/api/health`,
      env: stackEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'npx vite --port 5183 --strictPort',
      cwd: 'apps/web',
      url: E2E.web,
      env: stackEnv,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
