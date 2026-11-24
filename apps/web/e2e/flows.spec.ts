import { expect, test } from '@playwright/test';
import { STATE } from './fixtures';

test.use({ storageState: STATE.owner });

test('create a client, then edit a contact in the dialog', async ({ page }, info) => {
  const name = `Flow Client ${info.project.name} ${Date.now()}`;
  await page.goto('/admin/clients/new');
  await page.getByLabel('Company name').fill(name);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page).toHaveURL(/\/admin\/clients\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: 'Contacts', exact: true })
    .click();
  await page.getByLabel('Name', { exact: true }).fill('Sam Superintendent');
  await page.getByRole('button', { name: 'Add contact' }).click();
  const row = page.locator('main tbody tr').filter({ hasText: 'Sam Superintendent' });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit Sam Superintendent' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Job title').fill('Chief Engineer');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Saved.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(row).toContainText('Chief Engineer');
});

test('a duplicate IMO points to the existing vessel', async ({ page }) => {
  await page.goto('/admin/vessels/new');
  await page.getByLabel('Vessel name').fill('Copy of Aegean Star');
  await page.getByLabel('IMO number').fill('9074729');
  await page.getByRole('button', { name: 'Create vessel' }).click();
  await expect(page.getByText('This ship is already registered as')).toBeVisible();
  await page
    .getByRole('link', { name: /Aegean Star$/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Aegean Star' })).toBeVisible();
});

test('signing out returns to the sign-in page', async ({ browser }) => {
  // A fresh session, so signing out does not invalidate the shared one.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.getByLabel('Email').fill('ana@oceanic.test');
  await page.getByLabel('Password').fill('demo-pass-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  await context.close();
});

test('edit dialogs fit the screen (a bottom sheet on phones)', async ({ page }) => {
  await page.goto('/admin/custom-fields');
  await page.locator('main tbody').getByRole('button', { name: 'Edit' }).first().click();
  const dialog = page.locator('dialog[open]');
  await expect(dialog).toBeVisible();
  const box = (await dialog.boundingBox())!;
  const { width, height } = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(width);
  if (width < 640) expect(Math.round(box.y + box.height)).toBe(height);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('vessel overrides: billing party and a notification, then back to the client default', async ({
  page,
}) => {
  await page.goto('/admin/vessels');
  await page.getByRole('link', { name: 'Aegean Star' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Aegean Star' })).toBeVisible();
  const vesselUrl = page.url().split('?')[0]!;

  await page.goto(`${vesselUrl}?tab=billing`);
  await expect(page.getByText('Settings for')).toBeVisible();
  const select = page.getByLabel('Invoice this vessel’s work to');
  expect((await select.locator('option').allTextContents())[0]).toMatch(/^Client default/);
  // Pin a party explicitly, then return to "Client default".
  await select.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('main').getByText('Vessel override')).toBeVisible();
  await select.selectOption({ index: 0 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('main').getByText('Client default', { exact: true })).toBeVisible();

  await page.goto(`${vesselUrl}?tab=notifications`);
  const row = page.locator('main tbody tr').filter({ hasText: 'Sample delayed' });
  await row.getByRole('button', { name: 'Override' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sample delayed for this vessel' });
  await dialog.getByLabel('On for this vessel').check();
  await dialog.getByLabel('Choose recipients for this vessel').check();
  await dialog.getByLabel('Other email addresses').fill('master@aegean-star.test');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Saved.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(row).toContainText('Override');
  await expect(row).toContainText('master@aegean-star.test');

  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(row).toContainText('As client');
  await expect(row.getByRole('button', { name: 'Override' })).toBeVisible();
});
