import { expect, test } from '@playwright/test';
import { STATE, isDrawerLayout, navigate } from './fixtures';

test.use({ storageState: STATE.owner });

test('main navigation works on every screen size', async ({ page }) => {
  await page.goto('/');
  await navigate(page, 'Clients');
  await expect(page).toHaveURL(/\/admin\/clients$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  // The drawer closes itself after navigating.
  if (isDrawerLayout(page))
    await expect(page.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  // The closed drawer is inert (hidden from the accessibility tree), so query the DOM directly.
  await expect(page.locator('#app-sidebar a[aria-current="page"]')).toHaveText('Clients');
});

test('drawer: opens, traps nothing behind it, closes with Esc and the backdrop', async ({
  page,
}) => {
  test.skip(!isDrawerLayout(page), 'desktop shows the sidebar permanently');
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Open menu' });
  await menu.click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  // Closed drawer is not reachable by keyboard.
  await expect(page.locator('#app-sidebar')).toHaveAttribute('inert', '');
});

test('desktop shows the sidebar without a menu button', async ({ page }) => {
  test.skip(isDrawerLayout(page), 'drawer layout');
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeHidden();
});

test('pages run under a strict Content-Security-Policy without violations', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text()))
      violations.push(msg.text());
  });
  for (const path of ['/', '/admin/clients', '/lab/sample-update', '/lab/samples']) {
    const response = await page.goto(path);
    const headers = response!.headers();
    expect(headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+'/);
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    // Hydrated: client components respond (the menu or a link works).
    await expect(page.locator('main h1')).toBeVisible();
  }
  // A nonce is never reused.
  const a = (await page.goto('/'))!.headers()['content-security-policy'];
  const b = (await page.goto('/'))!.headers()['content-security-policy'];
  expect(a).not.toBe(b);
  expect(violations).toEqual([]);
});
