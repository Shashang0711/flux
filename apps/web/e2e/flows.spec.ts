import { expect, test, type Page } from '@playwright/test';
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

/** A fresh Ballast Water batch on Aegean Star, created through the API. */
async function ballastBatch(page: Page, tag: string, kits = 2) {
  const api = page.request;
  const options = (await (await api.get('/api/v1/samples/receive-register-options')).json()).data;
  const bwk = options.kits.find((k: { code: string }) => k.code === 'BWK');
  const bw = options.serviceTypes.find((s: { code: string }) => s.code === 'BW');
  const vessel = options.vessels.find((v: { name: string }) => v.name === 'Aegean Star');
  const res = await api.post('/api/v1/samples/receive-and-register', {
    data: {
      airwayBill: { number: tag },
      serviceTypeId: bw.id,
      samples: Array.from({ length: kits }, (_, i) => ({
        productId: bwk.id,
        variantId: bwk.variants[0].id,
        vesselId: vessel.id,
        serialNumber: `${tag}-${i + 1}`,
        values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
      })),
    },
  });
  expect(res.ok()).toBe(true);
  return (await res.json()).data as {
    id: string;
    code: string;
    samples: { id: string; code: string }[];
  };
}

test('enter results for one sample, see the flags, complete and lock', async ({ page }, info) => {
  const batch = await ballastBatch(
    page,
    `T${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
    1,
  );
  await page.goto(`/lab/samples/${batch.samples[0]!.id}`);
  const results = page.locator('#results');
  await results.getByLabel('Viable organisms ≥ 50 µm *').fill('12');
  await results.getByLabel('Viable organisms 10–50 µm *').fill('1');
  await results.getByLabel('E. coli *').fill('100');
  await results.getByLabel('Intestinal Enterococci *').fill('60');
  await results.getByLabel('Toxicogenic Vibrio cholerae *').selectOption('pass');
  await results.getByRole('button', { name: 'Save results' }).click();
  await expect(results.getByText('Results saved.')).toBeVisible();
  await expect(results.getByText('Critical').first()).toBeVisible();
  await expect(results.getByText('Caution')).toBeVisible();
  await expect(page.locator('main').getByText('Under testing').first()).toBeVisible();

  await results.getByRole('button', { name: 'Complete results' }).click();
  await expect(results.getByRole('button', { name: 'Reopen to correct' })).toBeVisible();
  await expect(results.getByLabel('E. coli *')).toBeDisabled();
});

test('upload batch results from a CSV, preview the flags, then save', async ({ page }, info) => {
  const batch = await ballastBatch(
    page,
    `C${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  );
  const [a, b] = batch.samples;
  const csv = [
    'sample,org_50,org_10_50,e_coli,enterococci,v_cholerae,colour',
    `${a!.code},2,1,10,5,pass,blue`,
    `${b!.code},40,1,10,5,fail,green`,
  ].join('\n');
  await page.goto(`/lab/batches/${batch.id}/results`);
  await page.getByLabel('CSV file with results').setInputFiles({
    name: 'results.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  const preview = page.getByRole('region', { name: 'Import preview' });
  await expect(preview).toBeVisible();
  await expect(preview.getByText('Critical').first()).toBeVisible();
  await expect(page.getByText('Ignored columns: colour')).toBeVisible();
  await preview.getByRole('button', { name: 'Save imported results' }).click();
  await expect(preview).toBeHidden();

  const grid = page.getByRole('table', { name: 'Results' });
  await expect(grid.getByLabel(`Viable organisms ≥ 50 µm for ${b!.code}`)).toHaveValue('40');
  await expect(grid.locator('tbody tr').nth(1)).toContainText('Critical');
});

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** Completes all results of a sample through the API (every Ballast Water parameter passing). */
async function completeResults(page: Page, sampleId: string) {
  const res = await (await page.request.get(`/api/v1/samples/${sampleId}/results`)).json();
  const values: Record<string, unknown> = {
    org_50: 2,
    org_10_50: 1,
    e_coli: 10,
    enterococci: 5,
    v_cholerae: 'pass',
  };
  const put = await page.request.put(`/api/v1/samples/${sampleId}/results`, {
    data: {
      results: res.data.parameters.map((p: { id: string; key: string }) => ({
        parameterId: p.id,
        value: values[p.key],
      })),
    },
  });
  expect(put.ok()).toBe(true);
  expect((await page.request.post(`/api/v1/samples/${sampleId}/complete-results`)).ok()).toBe(true);
}

test('upload a lab report for a batch; its samples turn yellow; download it', async ({
  page,
}, info) => {
  const batch = await ballastBatch(
    page,
    `L${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
  );
  for (const s of batch.samples) await completeResults(page, s.id);

  await page.goto(`/lab/batches/${batch.id}`);
  await page
    .getByLabel('Report (PDF)')
    .setInputFiles({ name: 'ballast-report.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByLabel('Note for the reviewer').fill('Both samples');
  await page.getByRole('button', { name: 'Submit report for 2 samples' }).click();
  const reports = page.getByRole('table', { name: 'Lab reports' });
  await expect(reports.locator('tbody tr')).toHaveCount(1);
  await expect(reports).toContainText('Awaiting review');
  await expect(
    page.getByRole('table', { name: 'Samples' }).getByText('Lab report uploaded'),
  ).toHaveCount(2);

  const download = page.waitForEvent('download');
  await reports.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('ballast-report.pdf');
});

test('attach a photo to a sample, download it and remove it', async ({ page }, info) => {
  const batch = await ballastBatch(
    page,
    `A${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
    1,
  );
  await page.goto(`/lab/samples/${batch.samples[0]!.id}`);
  const attachments = page.getByRole('table', { name: 'Attachments' });
  await page
    .getByLabel('Add a file')
    .setInputFiles({ name: 'microscope.png', mimeType: 'image/png', buffer: PNG });
  await page.getByLabel('Note', { exact: true }).fill('Slide 3');
  await page.getByRole('button', { name: 'Add attachment' }).click();
  await expect(attachments).toContainText('microscope.png');

  const download = page.waitForEvent('download');
  await attachments.getByRole('button', { name: 'Download' }).click();
  expect((await download).suggestedFilename()).toBe('microscope.png');

  page.once('dialog', (d) => d.accept());
  await attachments.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No attachments.')).toBeVisible();
});

test('review loop: reject with a comment, lab resubmits, reviewer marks ready to publish', async ({
  page,
  browser,
}, info) => {
  const batch = await ballastBatch(
    page,
    `V${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
    1,
  );
  const sampleId = batch.samples[0]!.id;
  await completeResults(page, sampleId);
  // The lab (owner) uploads the report through the API.
  const intent = (
    await (
      await page.request.post('/api/v1/files', {
        data: { purpose: 'LAB_REPORT', name: 'v1.pdf', size: PDF.length },
      })
    ).json()
  ).data;
  const file = (
    await (
      await page.request.put(`/api/v1${intent.uploadPath}`, {
        data: PDF,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    ).json()
  ).data;
  const report = (
    await (
      await page.request.post('/api/v1/lab-reports', {
        data: { batchId: batch.id, sampleIds: [sampleId], fileId: file.id },
      })
    ).json()
  ).data;

  // The owner uploaded it, so they cannot review it.
  await page.goto(`/lab/reports/${report.id}`);
  await expect(
    page.getByText('You uploaded this version, so another reviewer must review it.'),
  ).toBeVisible();

  // A reviewer rejects it.
  const reviewerContext = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
  const reviewer = await reviewerContext.newPage();
  await reviewer.goto('/login');
  await reviewer.getByLabel('Email').fill('rita@oceanic.test');
  await reviewer.getByLabel('Password').fill('demo-pass-123');
  await reviewer.getByRole('button', { name: 'Sign in' }).click();
  await expect(reviewer).toHaveURL(/\/$/);
  await reviewer.goto(`/lab/review?q=${report.code}`);
  await reviewer.getByRole('link', { name: report.code }).click();
  await reviewer.getByRole('button', { name: 'Reject' }).click();
  const reject = reviewer.getByRole('dialog', { name: `Reject ${report.code}` });
  await reject
    .getByLabel('What should the lab correct?')
    .fill('Add the sampling time to the report');
  await reject.getByRole('button', { name: 'Reject and return to the lab' }).click();
  await expect(reviewer.locator('main').getByText('Rejected').first()).toBeVisible();

  // The lab sees why, and the sample is back with the lab.
  await page.goto(`/lab/samples/${sampleId}`);
  await expect(page.locator('main').getByText('Report rejected')).toBeVisible();
  await page.goto(`/lab/reports/${report.id}`);
  // The rejection banner shows the reviewer's comment.
  await expect(page.getByRole('status').filter({ hasText: 'Rejected by' })).toContainText(
    'Add the sampling time to the report',
  );
  await page.getByRole('button', { name: 'Replace file' }).click();
  const replace = page.getByRole('dialog', { name: `Replace ${report.code}` });
  await replace
    .getByLabel('New report (PDF)')
    .setInputFiles({ name: 'v2.pdf', mimeType: 'application/pdf', buffer: PDF });
  await replace.getByLabel('What changed').fill('Sampling time added');
  await replace.getByRole('button', { name: 'Upload version 2' }).click();
  await expect(replace.getByText('New version uploaded.')).toBeVisible();

  // The reviewer approves the corrected version.
  await reviewer.reload();
  await reviewer.getByRole('button', { name: 'Mark ready to publish' }).click();
  const ready = reviewer.getByRole('dialog', { name: `Mark ${report.code} ready to publish` });
  await ready.getByRole('button', { name: 'Mark ready to publish' }).click();
  await expect(reviewer.locator('main').getByText('Ready to publish').first()).toBeVisible();
  await expect(
    reviewer.getByRole('table', { name: 'Review history' }).locator('tbody tr'),
  ).toHaveCount(2);
  await reviewerContext.close();
});

test('publish a ready report: final PDF, samples green, notifications listed', async ({
  page,
  playwright,
  baseURL,
}, info) => {
  const batch = await ballastBatch(
    page,
    `U${info.project.name.slice(0, 1).toUpperCase()}${Date.now().toString(36).toUpperCase()}`,
    1,
  );
  const sampleId = batch.samples[0]!.id;
  await completeResults(page, sampleId);
  const intent = (
    await (
      await page.request.post('/api/v1/files', {
        data: { purpose: 'LAB_REPORT', name: 'lab.pdf', size: PDF.length },
      })
    ).json()
  ).data;
  const file = (
    await (
      await page.request.put(`/api/v1${intent.uploadPath}`, {
        data: PDF,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    ).json()
  ).data;
  const report = (
    await (
      await page.request.post('/api/v1/lab-reports', {
        data: { batchId: batch.id, sampleIds: [sampleId], fileId: file.id },
      })
    ).json()
  ).data;

  // A reviewer (not the uploader) marks it ready to publish.
  const rita = await playwright.request.newContext({ baseURL });
  expect(
    (
      await rita.post('/api/v1/auth/login', {
        data: { email: 'rita@oceanic.test', password: 'demo-pass-123' },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await rita.post(`/api/v1/lab-reports/${report.id}/ready-to-publish`, { data: {} })).ok(),
  ).toBe(true);
  await rita.dispose();

  await page.goto(`/lab/publish?q=${report.code}`);
  await page.getByRole('link', { name: report.code }).click();
  const publish = page.getByRole('region', { name: 'Publish' });
  await publish
    .getByLabel('Final report (PDF)')
    .setInputFiles({ name: 'final-signed.pdf', mimeType: 'application/pdf', buffer: PDF });
  await publish.getByRole('button', { name: 'Publish' }).click();

  const published = page.getByRole('region', { name: 'Published' });
  await expect(published).toContainText('final-signed.pdf');
  await expect(
    page
      .getByRole('region', { name: 'Notifications' })
      .getByRole('table', { name: 'Notifications' }),
  ).toContainText('Report published');
  const download = page.waitForEvent('download');
  await published.getByRole('button', { name: 'Download final report' }).click();
  expect((await download).suggestedFilename()).toBe('final-signed.pdf');

  await page.goto(`/lab/samples/${sampleId}`);
  await expect(page.locator('main').getByText('Report published')).toBeVisible();
});

test('sample update: monthly grid by vessel and service, drill into a day, filter by colour', async ({
  page,
}) => {
  await page.goto('/lab/sample-update');
  const grid = page.getByRole('table', { name: 'Sample update' });
  await expect(grid).toBeVisible();
  const row = grid
    .locator('tbody tr')
    .filter({ hasText: 'Aegean Star' })
    .filter({ hasText: 'Ballast Water' });
  await expect(row).toHaveCount(1);

  // Today's cell opens the list for that vessel, service type and day.
  await row.getByRole('link').first().click();
  await expect(page).toHaveURL(/view=list.*day=\d{4}-\d{2}-\d{2}/);
  const samples = page.getByRole('table', { name: 'Samples' }).locator('tbody tr');
  await expect(samples.first()).toContainText('Aegean Star');
  await expect(page.getByText(/^Registered on/)).toBeVisible();

  // Colours: earlier flows published reports today, so green samples exist.
  await page
    .getByRole('navigation', { name: 'Colour' })
    .getByRole('link', { name: 'Final report published' })
    .click();
  await expect(samples.first()).toContainText('Report published');
  await page
    .getByRole('navigation', { name: 'View' })
    .getByRole('link', { name: 'Weekly' })
    .click();
  await expect(page.getByRole('table', { name: 'Sample update' }).locator('thead th')).toHaveCount(
    9,
  ); // name + 7 days + total
});
