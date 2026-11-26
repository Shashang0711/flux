import { expect, type Page } from '@playwright/test';

export const OWNER = { email: 'owner@oceanic.test', password: 'owner-pass-1' };
export const OPERATOR = {
  email: process.env.E2E_OPERATOR_EMAIL ?? 'operator@flux.test',
  password: process.env.E2E_OPERATOR_PASSWORD ?? 'operator-pass-1',
};

/** Client portal user of Aegean Bulk Carriers SA (seeded). */
export const CLIENT_USER = { email: 'carla@aegeanbulk.test', password: 'demo-pass-123' };

export const STATE = {
  owner: './e2e/.auth/owner.json',
  operator: './e2e/.auth/operator.json',
  client: './e2e/.auth/client.json',
};

/** True when the layout uses the top bar + drawer (below 1024px). */
export function isDrawerLayout(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1280) < 1024;
}

/** Navigates through the main menu, opening the drawer first on smaller screens. */
export async function navigate(page: Page, label: string): Promise<void> {
  if (isDrawerLayout(page)) {
    await page.getByRole('button', { name: 'Open menu' }).click();
  }
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: label, exact: true })
    .click();
}

/** The page must never scroll sideways. */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);
}

/** On phones and tablets the page content must start right under the top bar. */
export async function expectContentAboveFold(page: Page): Promise<void> {
  const top = await page.locator('main').evaluate((el) => el.getBoundingClientRect().top);
  expect(top, 'content is pushed below the fold').toBeLessThan(isDrawerLayout(page) ? 80 : 20);
}
