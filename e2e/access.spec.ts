/**
 * Access in the browser: the public page needs no login, private pages do,
 * and the UI hides what a role cannot do. (The server enforces all of this
 * independently -- see apps/api/tests/roles.test.ts -- this checks the UI
 * agrees with it.)
 */
import { expect, test } from '@playwright/test';
import { E2E_PASSWORD } from './global-setup';

test('the public status page works without signing in', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByRole('heading', { name: 'PulseWatch Status' })).toBeVisible();
  await expect(page.getByText(/Uptime for the last 90 days/)).toBeVisible();
  // It is not inside the app shell, so none of the private navigation shows.
  await expect(page.getByRole('link', { name: 'Incidents' })).toHaveCount(0);
});

test('private pages send a signed-out visitor to the login page', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: 'Sign in to PulseWatch' })).toBeVisible();
});

test('an engineer does not get admin-only controls', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('engineer@e2e.test');
  await page.getByLabel('Password').fill(E2E_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Services' }).click();
  await expect(page.getByRole('heading', { name: 'Services' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New service' })).toHaveCount(0);

  // Engineers do handle incidents, so that control is there.
  await page.getByRole('link', { name: 'Incidents' }).click();
  await expect(page.getByRole('button', { name: 'New incident' })).toBeVisible();
});

test('a wrong password shows an error and stays on the login page', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@e2e.test');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Email or password is incorrect')).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
