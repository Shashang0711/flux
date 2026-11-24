import { defineConfig } from '@playwright/test';

/**
 * Browser tests against a running FLUX stack (web + API + database).
 * Locally: start the apps, then `npm run test:browser -w @flux/web`.
 * Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled Chromium.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';
const executablePath = process.env.CHROME_PATH || undefined;

export default defineConfig({
  testDir: '.',
  outputDir: './.results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './.report' }]]
    : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    {
      name: 'phone',
      use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
    },
  ],
});
