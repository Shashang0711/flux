import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  ClientDto,
  DownloadLinkDto,
  FileDto,
  LabReportDto,
  NotificationDto,
  ReceiveRegisterOptionsDto,
  SampleDto,
  ServiceTypeDto,
  UploadIntentDto,
  VesselDto,
  VesselLinkSettingsDto,
} from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import { Mailer, type OutgoingEmail } from '../src/modules/notifications/mailer';
import { NotificationsWorker } from '../src/modules/notifications/notifications.worker';
import {
  createE2eApp,
  createReferenceItem,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

const PDF = Buffer.from('%PDF-1.7\n%%EOF\n');
const FINAL = Buffer.from('%PDF-1.7\nFINAL SIGNED\n%%EOF\n');
const PASSING = { org_50: 2, org_10_50: 1, e_coli: 10, enterococci: 5, v_cholerae: 'pass' };

describe('Publishing and notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let lab: string;
  let reviewer: string;
  let batch: BatchDto;
  let report: LabReportDto;
  let alpha: ClientDto;
  let star: VesselDto;
  let sent: OutgoingEmail[];
  let mailer: Mailer;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
  });
  const upload = async (
    purpose: 'LAB_REPORT' | 'FINAL_REPORT',
    body = PDF,
    name = 'r.pdf',
  ): Promise<FileDto> => {
    const intent = (
      await as(lab).post('/api/v1/files', { purpose, name, size: body.length }).expect(201)
    ).body.data as UploadIntentDto;
    return (
      await api()
        .put(`/api/v1${intent.uploadPath}`)
        .set('Cookie', lab)
        .set('Content-Type', 'application/octet-stream')
        .send(body)
        .expect(200)
    ).body.data;
  };
  const R = (path = '') => `/api/v1/lab-reports/${report.id}${path}`;
  const publish = async () =>
    (
      await as(lab)
        .post(R('/publish'), { fileId: (await upload('FINAL_REPORT', FINAL, 'LR final.pdf')).id })
        .expect(201)
    ).body.data as LabReportDto;
  const notifications = async (): Promise<NotificationDto[]> =>
    (await as(lab).get(R('/notifications')).expect(200)).body.data;
  const worker = () => app.get(NotificationsWorker);

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    mailer = app.get(Mailer);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    sent = [];
    jest.restoreAllMocks();
    jest.spyOn(mailer, 'send').mockImplementation(async (email) => {
      sent.push(email);
    });

    const owner = await createReferenceItem(prisma, {
      list: 'vessel-relationship-type',
      code: 'OWNER',
      name: 'Ship Owner',
    });
    const tenant = await createTenant(prisma, {
      slug: 'acme',
      name: 'Acme Marine Lab',
      modules: ['receiving', 'samples', 'lab-setup', 'clients', 'vessels', 'reports'],
    });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'lab@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    lab = await loginCookie(app, 'lab@acme.test');
    const role = await createRole(prisma, {
      tenantId,
      name: 'Reviewer',
      modules: ['reports'],
      permissions: ['report.review'],
    });
    await createUser(prisma, { email: 'reviewer@acme.test', tenantId, roleIds: [role.id] });
    reviewer = await loginCookie(app, 'reviewer@acme.test');

    await as(lab).post('/api/v1/lab/starter-catalogue').expect(201);
    alpha = (await as(lab).post('/api/v1/clients', { name: 'Alpha Owners' }).expect(201)).body.data;
    const beta = (await as(lab).post('/api/v1/clients', { name: 'Beta Management' }).expect(201))
      .body.data as ClientDto;
    const link = (clientId: string) => ({
      clientId,
      relationshipTypeId: owner.id,
      isPrimary: true,
    });
    star = (
      await as(lab)
        .post('/api/v1/vessels', { name: 'Aegean Star', relationship: link(alpha.id) })
        .expect(201)
    ).body.data;
    const wind = (
      await as(lab)
        .post('/api/v1/vessels', { name: 'Baltic Wind', relationship: link(beta.id) })
        .expect(201)
    ).body.data as VesselDto;

    // Alpha's rules: published → Maria + the lab inbox; critical → on, recipients overridden for
    // Aegean Star to the ship's master only. Beta has no rules (everything off).
    const maria = (
      await as(lab)
        .post(`/api/v1/clients/${alpha.id}/contacts`, {
          name: 'Maria',
          email: 'maria@alpha.test',
          isPrimary: true,
        })
        .expect(201)
    ).body.data.contacts[0];
    await as(lab)
      .put(`/api/v1/clients/${alpha.id}/notification-rules/report.published`, {
        enabled: true,
        contactIds: [maria.id],
        emails: ['reports@alpha.test'],
      })
      .expect(200);
    await as(lab)
      .put(`/api/v1/clients/${alpha.id}/notification-rules/report.critical`, {
        enabled: true,
        contactIds: [maria.id],
        emails: [],
      })
      .expect(200);
    const rel = (await as(lab).get(`/api/v1/vessels/${star.id}/relationships`).expect(200)).body
      .data[0];
    const settings = (
      await as(lab)
        .post(`/api/v1/relationships/${rel.id}/contacts`, {
          name: 'Capt. Andersen',
          email: 'master@star.test',
        })
        .expect(201)
    ).body.data as VesselLinkSettingsDto;
    await as(lab)
      .put(`/api/v1/relationships/${rel.id}/notifications/report.critical`, {
        enabled: null,
        recipients: { contactIds: [settings.contacts.vessel[0]!.id], emails: [] },
      })
      .expect(200);

    const options = (await as(lab).get('/api/v1/samples/receive-register-options').expect(200)).body
      .data as ReceiveRegisterOptionsDto;
    const bwk = options.kits.find((k) => k.code === 'BWK')!;
    const bw = options.serviceTypes.find((s) => s.code === 'BW')!;
    batch = (
      await as(lab)
        .post('/api/v1/samples/receive-and-register', {
          airwayBill: { number: 'AWB-P' },
          serviceTypeId: bw.id,
          samples: [star, wind].map((v, i) => ({
            productId: bwk.id,
            variantId: bwk.variants[0]!.id,
            vesselId: v.id,
            serialNumber: `P-${i + 1}`,
            values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
          })),
        })
        .expect(201)
    ).body.data;
    const st = (await as(lab).get(`/api/v1/lab/service-types/${bw.id}`).expect(200)).body
      .data as ServiceTypeDto;
    for (const [i, s] of batch.samples.entries()) {
      const values = i === 0 ? { ...PASSING, org_50: 12 } : PASSING; // Aegean Star: critical
      await as(lab)
        .put(`/api/v1/samples/${s.id}/results`, {
          results: st.parameters.map((p) => ({
            parameterId: p.id,
            value: values[p.key as keyof typeof values],
          })),
        })
        .expect(200);
      await as(lab).post(`/api/v1/samples/${s.id}/complete-results`).expect(201);
    }
    report = (
      await as(lab)
        .post('/api/v1/lab-reports', {
          batchId: batch.id,
          sampleIds: batch.samples.map((s) => s.id),
          fileId: (await upload('LAB_REPORT')).id,
        })
        .expect(201)
    ).body.data;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('publishing', () => {
    it('publishes only ready reports, with a final-report PDF; samples turn green', async () => {
      const early = await as(lab)
        .post(R('/publish'), { fileId: (await upload('FINAL_REPORT')).id })
        .expect(409);
      expect(early.body.error.message).toMatch(/only reports marked ready to publish/);
      await as(reviewer).post(R('/ready-to-publish'), {}).expect(201);
      const wrong = await as(lab)
        .post(R('/publish'), { fileId: (await upload('LAB_REPORT')).id })
        .expect(400);
      expect(wrong.body.error.details[0].message).toBe('This file was uploaded for something else');

      const published = await publish();
      expect(published).toMatchObject({
        status: 'PUBLISHED',
        published: {
          by: expect.any(String),
          file: { name: 'LR final.pdf', purpose: 'FINAL_REPORT' },
        },
      });
      const sample = (await as(lab).get(`/api/v1/samples/${batch.samples[0]!.id}`).expect(200)).body
        .data as SampleDto;
      expect(sample).toMatchObject({ colour: 'green', labReport: { status: 'PUBLISHED' } });

      const link = (await as(lab).get(R('/final-download-link')).expect(200)).body
        .data as DownloadLinkDto;
      const res = await api()
        .get(`/api/v1${link.path}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(Buffer.compare(res.body as Buffer, FINAL)).toBe(0);

      // Frozen once published.
      await as(lab)
        .post(R('/publish'), { fileId: (await upload('FINAL_REPORT')).id })
        .expect(409);
      await as(reviewer).post(R('/reopen-review'), { reason: 'x' }).expect(409);
      await as(lab)
        .post(R('/versions'), { fileId: (await upload('LAB_REPORT')).id })
        .expect(400);
      await as(lab).post(`/api/v1/samples/${batch.samples[0]!.id}/reopen-results`).expect(400);
      expect(await prisma.auditLog.count({ where: { action: 'report.published' } })).toBe(1);
    });

    it('needs report.publish', async () => {
      await as(reviewer).post(R('/ready-to-publish'), {}).expect(201);
      const file = await upload('FINAL_REPORT');
      await as(reviewer).post(R('/publish'), { fileId: file.id }).expect(403);
    });
  });

  describe('notifications', () => {
    beforeEach(async () => {
      await as(reviewer).post(R('/ready-to-publish'), {}).expect(201);
      await publish();
    });

    it('queues one email per event and vessel/client, to each vessel’s effective recipients', async () => {
      const list = await notifications();
      const view = list.map((n) => ({
        event: n.event,
        vessel: n.vessel,
        samples: n.samples.length,
        skipped: n.skippedReason,
        to: n.deliveries.map((d) => [d.email, d.status]),
      }));
      expect(view).toEqual(
        expect.arrayContaining([
          {
            event: 'report.published',
            vessel: 'Aegean Star',
            samples: 1,
            skipped: null,
            to: [
              ['maria@alpha.test', 'PENDING'],
              ['reports@alpha.test', 'PENDING'],
            ],
          },
          {
            event: 'report.critical',
            vessel: 'Aegean Star',
            samples: 1,
            skipped: null,
            to: [['master@star.test', 'PENDING']],
          },
          {
            event: 'report.published',
            vessel: 'Baltic Wind',
            samples: 1,
            skipped: expect.stringMatching(/switched off/),
            to: [],
          },
        ]),
      );
      expect(list).toHaveLength(3);
    });

    it('the worker sends them with the final PDF attached, once each, even with two workers', async () => {
      const [a, b] = await Promise.all([worker().runOnce(), worker().runOnce()]);
      expect(a.sent + b.sent).toBe(3);
      expect(sent).toHaveLength(3);
      const published = sent.find((m) => m.to.email === 'maria@alpha.test')!;
      expect(published.subject).toMatch(
        /^Report LR\d{2}-\d{5} published – Aegean Star – Ballast Water$/,
      );
      expect(published.text).toContain('Acme Marine Lab has published report');
      expect(published.attachments).toEqual([
        { filename: 'LR final.pdf', content: FINAL, contentType: 'application/pdf' },
      ]);
      const critical = sent.find((m) => m.to.email === 'master@star.test')!;
      expect(critical.subject).toMatch(/^Critical result – Aegean Star/);
      expect(critical.text).toContain('Viable organisms ≥ 50 µm 12 per m³');
      expect(critical.attachments).toEqual([]);
      expect((await notifications()).flatMap((n) => n.deliveries.map((d) => d.status))).toEqual([
        'SENT',
        'SENT',
        'SENT',
      ]);
      expect(await worker().runOnce()).toEqual({ sent: 0, retrying: 0, failed: 0 });
    });

    it('retries failures with back-off, gives up after five attempts, and can be retried by hand', async () => {
      jest.spyOn(mailer, 'send').mockRejectedValue(new Error('421 try again later'));
      expect(await worker().runOnce()).toEqual({ sent: 0, retrying: 3, failed: 0 });
      const d = await prisma.notificationDelivery.findFirstOrThrow({
        where: { email: 'maria@alpha.test' },
      });
      expect(d).toMatchObject({ status: 'PENDING', attempts: 1, lastError: '421 try again later' });
      expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
      expect(await worker().runOnce()).toEqual({ sent: 0, retrying: 0, failed: 0 }); // not due yet

      // Fast-forward to the last attempt.
      await prisma.notificationDelivery.updateMany({
        data: { attempts: 4, nextAttemptAt: new Date(Date.now() - 1000) },
      });
      expect(await worker().runOnce()).toEqual({ sent: 0, retrying: 0, failed: 3 });
      expect((await notifications()).flatMap((n) => n.deliveries.map((x) => x.status))).toEqual([
        'FAILED',
        'FAILED',
        'FAILED',
      ]);

      jest.spyOn(mailer, 'send').mockImplementation(async (email) => {
        sent.push(email);
      });
      await as(reviewer).post(R('/notifications/retry')).expect(403);
      const retried = (await as(lab).post(R('/notifications/retry')).expect(201)).body
        .data as NotificationDto[];
      expect(retried.flatMap((n) => n.deliveries.map((x) => [x.status, x.attempts]))).toEqual([
        ['PENDING', 0],
        ['PENDING', 0],
        ['PENDING', 0],
      ]);
      expect((await worker().runOnce()).sent).toBe(3);
    });

    it('uses the same recipients as the vessel’s Notifications tab', async () => {
      const rel = (await as(lab).get(`/api/v1/vessels/${star.id}/relationships`).expect(200)).body
        .data[0];
      const tab = (await as(lab).get(`/api/v1/relationships/${rel.id}/settings`).expect(200)).body
        .data as VesselLinkSettingsDto;
      const list = await notifications();
      for (const event of ['report.published', 'report.critical']) {
        const n = tab.notifications.find((x) => x.event === event)!;
        const expected = [
          ...n.effective.contacts.map((c) => c.email!),
          ...n.effective.emails,
        ].sort();
        const queued = list
          .find((x) => x.event === event && x.vessel === 'Aegean Star')!
          .deliveries.map((d) => d.email)
          .sort();
        expect(queued).toEqual(expected);
      }
    });
  });
});
