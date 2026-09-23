/**
 * Regenerates the README screenshots from a running PulseWatch.
 *
 *   BASE_URL=http://localhost:4020 ADMIN_PASSWORD=... npx tsx scripts/screenshots.ts
 *
 * Point it at a freshly seeded instance. It opens one live incident through the
 * ingest API -- the same pool-exhaustion failure the seed history contains, so
 * incident memory has something to recognise -- then captures what a visitor
 * signed in as the read-only viewer sees.
 */
import { chromium, request as playwrightRequest } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://localhost:4020';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'pulsewatch123';
const VIEWER_PASSWORD = process.env.VIEWER_PASSWORD ?? 'pulsewatch123';
const OUT = 'docs/screenshots';

async function openLiveIncident(): Promise<number> {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const login = await api.post('/api/auth/login', {
    data: { email: 'admin@pulsewatch.local', password: ADMIN_PASSWORD },
  });
  const { token } = await login.json();
  const auth = { Authorization: `Bearer ${token}` };

  const services: { id: number; name: string }[] = await (
    await api.get('/api/services', { headers: auth })
  ).json();
  const payments = services.find((s) => s.name === 'payments-api');
  if (!payments) throw new Error('payments-api not found: is the instance seeded?');

  const key = await (
    await api.post(`/api/services/${payments.id}/api-keys`, { headers: auth })
  ).json();
  const report = await api.post('/api/ingest/errors', {
    headers: { 'X-Api-Key': key.key },
    data: {
      errorType: 'DB_TIMEOUT',
      title: 'payments-api database timeouts',
      message: 'connection pool exhausted: 50/50 connections in use, waited 6400ms',
      severity: 'SEV2',
    },
  });
  const { incidentId } = await report.json();
  await api.dispose();
  return incidentId;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const incidentId = await openLiveIncident();

  const browser = await chromium.launch({ channel: process.env.CI ? undefined : 'msedge' });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1.5,
  });

  // The public status page first: no login.
  await page.goto(`${BASE}/status`);
  await page.getByText('90 days ago').first().waitFor();
  await page.screenshot({ path: `${OUT}/status-page.png`, fullPage: true });

  await page.goto(`${BASE}/login`);
  await page.getByLabel('Email').fill('viewer@pulsewatch.local');
  await page.getByLabel('Password').fill(VIEWER_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByText('Repeat rate').waitFor();
  // Let the chart finish drawing.
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/dashboard.png`, fullPage: true });

  await page.goto(`${BASE}/incidents/${incidentId}`);
  await page.getByText(/Seen \d+ times? before/).waitFor();
  await page.screenshot({ path: `${OUT}/incident-seen-before.png`, fullPage: true });

  await page.goto(`${BASE}/search?q=connection+pool`);
  await page.getByText(/result/).first().waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/search.png` });

  await browser.close();
  console.log(`Saved 4 screenshots to ${OUT}/ (live incident: INC-${incidentId})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
