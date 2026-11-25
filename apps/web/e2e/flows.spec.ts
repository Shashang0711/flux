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

test('service type preview validates registration values on the server', async ({ page }) => {
  await page.goto('/admin/lab/service-types?q=Ballast');
  await page.getByRole('link', { name: 'Ballast Water', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: 'Preview' })
    .click();
  await expect(page.getByRole('group', { name: 'Batch details' })).toBeVisible();

  // Nothing filled: required sample fields are reported per sample.
  await page.getByRole('button', { name: 'Check values' }).click();
  await expect(page.getByText('Sampling point is required').first()).toBeVisible();

  for (const i of [0, 1]) {
    const sample = page.getByRole('group', { name: `Sample ${i + 1}` });
    await sample
      .getByLabel('Sampling point *')
      .selectOption({ label: i === 0 ? 'Intake' : 'Discharge' });
    await sample.getByLabel('Date sampled *').fill('2026-11-20');
  }
  await page.getByRole('button', { name: 'Check values' }).click();
  await expect(page.getByText('All values are valid.')).toBeVisible();
  await expect(page.getByText(/Sample 2: Sampling point Discharge/)).toBeVisible();
});

test('create a kit with bottles and a variant', async ({ page }, info) => {
  const code = `T${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  await page.goto('/admin/lab/kits/new');
  await page.getByLabel('Name').fill(`Test kit ${code}`);
  await page.getByLabel('Code').fill(code);
  await page.getByRole('checkbox', { name: 'Potable Water' }).check();
  await page.getByRole('button', { name: 'Create kit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `Test kit ${code}` })).toBeVisible();

  // Lands on the Bottles tab.
  await page.getByRole('button', { name: 'Add bottle' }).click();
  await page.getByLabel('Quantity').fill('2');
  await page.getByRole('button', { name: 'Save bottles' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page
    .getByRole('navigation', { name: 'Lists' })
    .getByRole('link', { name: 'Variants' })
    .click();
  await page.getByLabel('Name').fill('Standard');
  await page.getByLabel('Code').fill('STD');
  await page.getByRole('button', { name: 'Add variant' }).click();
  const row = page.locator('main tbody tr').filter({ hasText: 'Standard' });
  await expect(row).toContainText('Same as the kit');
  await expect(row).toContainText('2 ×');
});

test('receive kits scanner-style, then find them in the registration queue', async ({
  page,
}, info) => {
  const tag = `${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  await page.goto('/lab/receiving/new');
  await page.getByLabel('AWB number').fill(`E2E-${tag}`);
  await page.getByLabel('Courier').fill('FedEx');
  await page.getByRole('button', { name: 'Start receiving' }).click();
  await expect(page.getByRole('heading', { level: 1, name: `AWB E2E-${tag}` })).toBeVisible();

  await page.getByLabel('Kit', { exact: true }).selectOption({ label: 'Ballast Water Kit' });
  await page.getByLabel('Variant').selectOption({ label: 'UV' });
  await page.getByLabel('Vessel').selectOption({ label: 'Aegean Star · IMO 9074729' });
  await expect(page.getByLabel('Client')).not.toHaveValue('');

  // A scanner types the serial and presses Enter; the selections stay for the next kit.
  const serial = page.getByLabel('Serial number');
  await serial.fill(`${tag}-1`);
  await serial.press('Enter');
  await expect(page.getByText(/Received RK-\d{6} \(.*-1\)/)).toBeVisible();
  await expect(serial).toBeFocused();
  await serial.fill(`${tag}-2`);
  await serial.press('Enter');
  await expect(page.getByText(/Received RK-\d{6} \(.*-2\)/)).toBeVisible();
  await serial.fill(`${tag}-2`);
  await serial.press('Enter');
  await expect(page.getByText(/already received as RK-/).first()).toBeVisible();

  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(2);
  const second = rows.filter({ hasText: `${tag}-2` });
  await second.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog', { name: /^Cancel RK-/ });
  await dialog.getByLabel('Reason').fill('Scanned twice');
  await dialog.getByRole('button', { name: 'Cancel kit' }).click();
  await expect(second).toContainText('Cancelled');

  await page.goto(`/lab/registration-queue?q=${tag}`);
  await expect(page.locator('main tbody tr')).toHaveCount(1);
  await expect(page.locator('main tbody tr')).toContainText(`${tag}-1`);
  await expect(page.locator('main tbody tr')).toContainText('Aegean Star');
});

test('register a batch from the registration queue', async ({ page }, info) => {
  const tag = `R${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  // Two received ballast water kits on Aegean Star (set up through the API).
  const api = page.request;
  const options = (await (await api.get('/api/v1/receiving/options')).json()).data;
  const bwk = options.kits.find((k: { code: string }) => k.code === 'BWK');
  const vessel = options.vessels.find((v: { name: string }) => v.name === 'Aegean Star');
  const awb = (
    await (await api.post('/api/v1/receiving/airway-bills', { data: { number: tag } })).json()
  ).data;
  for (const n of [1, 2]) {
    const res = await api.post(`/api/v1/receiving/airway-bills/${awb.id}/kits`, {
      data: {
        productId: bwk.id,
        variantId: bwk.variants[0].id,
        serialNumber: `${tag}-${n}`,
        vesselId: vessel.id,
      },
    });
    expect(res.ok()).toBe(true);
  }

  await page.goto(`/lab/registration-queue?q=${tag}`);
  const rows = page.locator('main tbody tr');
  await expect(rows).toHaveCount(2);
  for (const n of [1, 2])
    await rows
      .nth(n - 1)
      .getByRole('checkbox')
      .check();
  await expect(page.getByText('2 kits selected')).toBeVisible();
  await page.getByRole('link', { name: 'Register batch' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Register batch' })).toBeVisible();
  await page.getByLabel('Port of sampling').fill('Singapore');
  for (const i of [0, 1]) {
    const card = page.getByRole('region', { name: new RegExp(`^Sample ${i + 1}:`) });
    await expect(card.getByLabel('Vessel *')).toHaveValue(vessel.id);
    await card.getByLabel('Sampling point *').selectOption({ label: 'Intake' });
  }
  // Missing dates are reported on the right sample before anything is saved.
  await page.getByRole('button', { name: 'Register 2 samples' }).click();
  await expect(page.getByText('Date sampled is required').first()).toBeVisible();
  for (const i of [0, 1]) {
    await page
      .getByRole('region', { name: new RegExp(`^Sample ${i + 1}:`) })
      .getByLabel('Date sampled *')
      .fill('2026-11-21');
  }
  await page.getByRole('button', { name: 'Register 2 samples' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /^Batch B\d{2}-\d{5}$/ })).toBeVisible();
  const samples = page.getByRole('table', { name: 'Samples' }).locator('tbody tr');
  await expect(samples).toHaveCount(2);
  await expect(samples.first()).toContainText('Registered');
  await expect(page.getByText('Singapore')).toBeVisible();

  await page.goto(`/lab/registration-queue?q=${tag}`);
  await expect(page.getByText('No kits are waiting for registration.')).toBeVisible();
});

test('receive & register a package in one step', async ({ page }, info) => {
  const tag = `P${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`;
  await page.goto('/lab/receive-register');
  await page.getByLabel('AWB number').fill(tag);
  await page.getByLabel('Service type').selectOption({ label: 'Ballast Water' });
  await page.getByLabel('Port of sampling').fill('Piraeus');

  const kit = (n: number) => page.getByRole('region', { name: `Kit ${n}` });
  await kit(1).getByLabel('Serial number').fill(`${tag}-1`);
  await kit(1).getByLabel('Variant').selectOption({ label: 'UV' });
  await kit(1).getByLabel('Vessel *').selectOption({ label: 'Aegean Star · IMO 9074729' });
  await expect(kit(1).getByLabel('Client *')).not.toHaveValue('');
  await kit(1).getByLabel('Sampling point *').selectOption({ label: 'Intake' });
  await kit(1).getByLabel('Date sampled *').fill('2026-11-22');

  // The second kit starts as a copy of the first (kit type, variant, vessel, client).
  await page.getByRole('button', { name: 'Add another kit' }).click();
  await expect(kit(2).getByLabel('Variant')).toHaveValue(
    await kit(1).getByLabel('Variant').inputValue(),
  );
  await kit(2).getByLabel('Serial number').fill(`${tag}-2`);
  await kit(2).getByLabel('Condition on arrival').selectOption({ label: 'Damaged' });
  await page.getByRole('button', { name: 'Receive & register 2 kits' }).click();
  // Nothing is saved while kit 2 lacks its sample details.
  await expect(kit(2).getByText('Sampling point is required')).toBeVisible();
  await kit(2).getByLabel('Sampling point *').selectOption({ label: 'Discharge' });
  await kit(2).getByLabel('Date sampled *').fill('2026-11-22');
  await page.getByRole('button', { name: 'Receive & register 2 kits' }).click();

  await expect(page.getByRole('heading', { level: 1, name: /^Batch B\d{2}-\d{5}$/ })).toBeVisible();
  const samples = page.getByRole('table', { name: 'Samples' }).locator('tbody tr');
  await expect(samples).toHaveCount(2);
  await expect(samples.nth(1)).toContainText(`${tag}-2`);
  await expect(page.getByText('Piraeus')).toBeVisible();

  await page.goto(`/lab/receiving?q=${tag}`);
  await expect(page.locator('main tbody tr')).toHaveCount(1);
  await expect(page.locator('main tbody tr')).toContainText('2');
});
