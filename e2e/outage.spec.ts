/**
 * The guide's end-to-end story, in a real browser against the real stack:
 * log in -> create a service and a monitor -> break the target -> see the
 * incident the worker opened -> acknowledge -> resolve.
 *
 * Nothing is mocked. The incident appears because the worker genuinely
 * checked the demo target, saw it fail, and ran the state machine.
 */
import { expect, test, type Page } from '@playwright/test';
import { E2E } from '../playwright.config';
import { E2E_PASSWORD } from './global-setup';

async function signIn(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

async function setDemoMode(mode: 'healthy' | 'failing', request: import('@playwright/test').APIRequestContext) {
  // The demo target starts alongside the API; allow it a moment to be ready.
  await expect(async () => {
    const res = await request.post(`${E2E.demo}/mode`, { data: { mode } });
    expect(res.ok()).toBe(true);
  }).toPass({ timeout: 20_000 });
}

test.afterEach(async ({ request }) => {
  await setDemoMode('healthy', request);
});

test('an outage becomes an incident that can be acknowledged and resolved', async ({
  page,
  request,
}) => {
  // Break the target first, so the monitor's very first check fails.
  await setDemoMode('failing', request);

  await signIn(page, 'admin@e2e.test');

  // Create a service.
  await page.getByRole('link', { name: 'Services' }).click();
  await page.getByRole('button', { name: 'New service' }).click();
  await page.getByLabel('Name').fill('checkout-api');
  await page.getByLabel('Description').fill('Cart and checkout');
  await page.getByRole('button', { name: 'Create service' }).click();
  await page.getByRole('link', { name: /checkout-api/ }).click();
  await expect(page.getByRole('heading', { name: 'checkout-api' })).toBeVisible();

  // Add a monitor that goes DOWN on the first failure, to keep the test quick.
  await page.getByRole('button', { name: 'Add monitor' }).click();
  await page.getByLabel('URL').fill(`${E2E.demo}/health`);
  await page.getByLabel('Interval (seconds)').fill('30');
  await page.getByLabel('Failure threshold').fill('1');
  await page.getByRole('button', { name: 'Add monitor' }).last().click();
  await expect(page.getByText(`${E2E.demo}/health`)).toBeVisible();

  // Wait for the worker to check it, fail, and open an incident.
  await page.getByRole('link', { name: 'Incidents' }).click();
  await expect(async () => {
    await page.reload();
    await expect(page.getByText('checkout-api health check failing')).toBeVisible({
      timeout: 2_000,
    });
  }).toPass({ timeout: 45_000 });

  // Open it: the timeline was written by the system, not by us.
  await page.getByText('checkout-api health check failing').click();
  await expect(page.getByText('HTTP 503 Service Unavailable').first()).toBeVisible();
  await expect(page.getByText('by system').first()).toBeVisible();

  // Acknowledge.
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText('acknowledged', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('by E2E Admin').first()).toBeVisible();

  // Resolve with a note.
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await page.getByLabel('What fixed it?').fill('Restarted the checkout service');
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  await expect(page.getByText('resolved', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Restarted the checkout service').first()).toBeVisible();

  // And the actions are gone, because a resolved incident cannot be re-acknowledged.
  await expect(page.getByRole('button', { name: 'Acknowledge' })).toHaveCount(0);
});
