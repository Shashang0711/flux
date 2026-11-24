import { expect, test, type Page } from '@playwright/test';
import { STATE, expectContentAboveFold, expectNoHorizontalOverflow } from './fixtures';

/** First link to a record in the page's table (never the "New …" button). */
async function firstRecordHref(page: Page, path: string): Promise<string> {
  await page.goto(path);
  const href = await page.locator('main tbody a').first().getAttribute('href');
  expect(href, `no record link on ${path}`).toBeTruthy();
  return href!;
}

async function checkPage(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('main h1')).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectContentAboveFold(page);
}

test.describe('tenant admin pages fit every screen', () => {
  test.use({ storageState: STATE.owner });

  for (const path of [
    '/',
    '/admin/clients',
    '/admin/clients/new',
    '/admin/vessels',
    '/admin/vessels/new',
    '/admin/users',
    '/admin/roles',
    '/admin/reference-data',
    '/admin/custom-fields',
    '/admin/audit',
    '/account',
  ]) {
    test(`list/form page ${path}`, async ({ page }) => {
      await checkPage(page, path);
    });
  }

  test('client detail tabs', async ({ page }) => {
    const client = await firstRecordHref(page, '/admin/clients');
    for (const tab of [
      'overview',
      'addresses',
      'contacts',
      'billing',
      'notifications',
      'vessels',
      'fleets',
      'audit',
    ]) {
      await checkPage(page, `${client}?tab=${tab}`);
    }
  });

  test('vessel detail tabs', async ({ page }) => {
    const vessel = await firstRecordHref(page, '/admin/vessels');
    for (const tab of ['overview', 'clients', 'billing', 'contacts', 'notifications', 'audit'])
      await checkPage(page, `${vessel}?tab=${tab}`);
  });

  test('user and role detail', async ({ page }) => {
    await checkPage(page, await firstRecordHref(page, '/admin/users'));
    const role = await firstRecordHref(page, '/admin/roles');
    for (const tab of ['general', 'portals', 'modules', 'permissions', 'users', 'audit']) {
      await checkPage(page, `${role}?tab=${tab}`);
    }
  });
});

test.describe('platform pages fit every screen', () => {
  test.use({ storageState: STATE.operator });

  test('tenants, tenant detail, reference data, audit', async ({ page }) => {
    for (const path of [
      '/platform/tenants',
      '/platform/tenants/new',
      '/platform/reference-data',
      '/platform/audit',
    ]) {
      await checkPage(page, path);
    }
    await checkPage(page, await firstRecordHref(page, '/platform/tenants'));
  });
});

test('sign-in page fits every screen', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test.describe('tables never hide columns on phones', () => {
  test.use({ storageState: STATE.owner });

  test('rows become labelled cards below 640px', async ({ page }) => {
    await page.goto('/admin/clients');
    const firstCell = page.locator('main tbody tr').first().locator('td[data-label="Email"]');
    const box = await firstCell.boundingBox();
    expect(box).not.toBeNull();
    const width = page.viewportSize()!.width;
    // Every cell, including the last column, lies within the screen.
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    if (width < 640) {
      const label = await firstCell.evaluate((td) => getComputedStyle(td, '::before').content);
      expect(label).toContain('Email');
    }
  });
});
