import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  ClientDto,
  ReceivedKitDto,
  ReceivingOptionsDto,
  RegistrationDraftDto,
  SampleDto,
  SampleSummaryDto,
  VesselDto,
} from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import {
  createE2eApp,
  createReferenceItem,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

const YY = String(new Date().getUTCFullYear() % 100).padStart(2, '0');

describe('Batch registration (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let options: ReceivingOptionsDto;
  let awbId: string;
  let alpha: ClientDto;
  let beta: ClientDto;
  let star: VesselDto;
  let wind: VesselDto;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
  });
  const kitType = (code: string) => options.kits.find((k) => k.code === code)!;
  const serviceTypeId = (code: string) =>
    options.kits.flatMap((k) => k.serviceTypes).find((s) => s.code === code)!.id;
  const receive = async (body: object): Promise<ReceivedKitDto> =>
    (await as(admin).post(`/api/v1/receiving/airway-bills/${awbId}/kits`, body).expect(201)).body
      .data;
  const ballastKit = (extra: object = {}) =>
    receive({ productId: kitType('BWK').id, variantId: kitType('BWK').variants[0]!.id, ...extra });
  const waterKit = (extra: object = {}) => receive({ productId: kitType('WQK').id, ...extra });
  const bwSample = { sampling_point: 'intake', date_sampled: '2026-11-20' };
  const register = (body: object) => as(admin).post('/api/v1/samples/batches', body);

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const owner = await createReferenceItem(prisma, {
      list: 'vessel-relationship-type',
      code: 'OWNER',
      name: 'Ship Owner',
    });
    const tenant = await createTenant(prisma, {
      slug: 'acme',
      modules: ['receiving', 'samples', 'lab-setup', 'clients', 'vessels'],
    });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
    await as(admin).post('/api/v1/lab/starter-catalogue').expect(201);
    alpha = (await as(admin).post('/api/v1/clients', { name: 'Alpha Owners' }).expect(201)).body
      .data;
    beta = (await as(admin).post('/api/v1/clients', { name: 'Beta Management' }).expect(201)).body
      .data;
    const link = (clientId: string) => ({
      clientId,
      relationshipTypeId: owner.id,
      isPrimary: true,
    });
    star = (
      await as(admin)
        .post('/api/v1/vessels', { name: 'Aegean Star', relationship: link(alpha.id) })
        .expect(201)
    ).body.data;
    wind = (
      await as(admin)
        .post('/api/v1/vessels', { name: 'Baltic Wind', relationship: link(beta.id) })
        .expect(201)
    ).body.data;
    options = (await as(admin).get('/api/v1/receiving/options').expect(200)).body.data;
    awbId = (
      await as(admin).post('/api/v1/receiving/airway-bills', { number: 'AWB-1' }).expect(201)
    ).body.data.id;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('draft', () => {
    it('offers only the service types every chosen kit can be registered for', async () => {
      const [b1, b2, w] = [await ballastKit(), await ballastKit(), await waterKit()];
      const draft = async (ids: string[]): Promise<RegistrationDraftDto> =>
        (
          await as(admin)
            .get(`/api/v1/samples/registration-draft?kitIds=${ids.join(',')}`)
            .expect(200)
        ).body.data;
      const bw = await draft([b1.id, b2.id]);
      expect(bw.serviceTypes.map((s) => [s.code, s.vesselRequired])).toEqual([['BW', true]]);
      expect(bw.serviceTypes[0]!.fields.map((f) => f.key)).toContain('sampling_point');
      expect((await draft([w.id])).serviceTypes.map((s) => s.code)).toEqual(['GW', 'PW']);
      expect((await draft([b1.id, w.id])).serviceTypes).toEqual([]);
    });
  });

  describe('registering', () => {
    it('creates a batch with one sample per kit, year-based codes, and registers the kits', async () => {
      const k1 = await ballastKit({ vesselId: star.id, serialNumber: 'BW-1' });
      const k2 = await ballastKit({ vesselId: wind.id });
      const res = await register({
        serviceTypeId: serviceTypeId('BW'),
        values: { port_of_sampling: 'Rotterdam' },
        samples: [
          { kitId: k1.id, values: bwSample },
          {
            kitId: k2.id,
            values: { ...bwSample, sampling_point: 'discharge', treatment_running: true },
          },
        ],
      }).expect(201);
      const batch = res.body.data as BatchDto;
      expect(batch).toMatchObject({
        code: `B${YY}-00001`,
        serviceType: { code: 'BW' },
        sampleCount: 2,
        values: { port_of_sampling: 'Rotterdam' },
      });
      // Mixed vessels and clients in one batch; each sample keeps its own.
      expect(
        batch.samples.map((s) => [s.code, s.vessel?.name, s.client.name, s.status, s.colour]),
      ).toEqual([
        [`S${YY}-000001`, 'Aegean Star', 'Alpha Owners', 'REGISTERED', 'red'],
        [`S${YY}-000002`, 'Baltic Wind', 'Beta Management', 'REGISTERED', 'red'],
      ]);
      expect(batch.samples[1]!.values).toEqual({
        sampling_point: 'discharge',
        date_sampled: '2026-11-20',
        treatment_running: true,
      });

      const kit = await prisma.receivedKit.findUniqueOrThrow({ where: { id: k1.id } });
      expect(kit.status).toBe('REGISTERED');
      const queue = (await as(admin).get('/api/v1/receiving/registration-queue').expect(200)).body
        .data;
      expect(queue).toEqual([]);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'sample.batch_registered' },
      });
      expect(audit.entityId).toBe(batch.id);
      expect(audit.relatedIds).toEqual(expect.arrayContaining([k1.id, k2.id, star.id, alpha.id]));

      // The next batch continues the year's numbering.
      const k3 = await ballastKit({ vesselId: star.id });
      const next = (
        await register({
          serviceTypeId: serviceTypeId('BW'),
          samples: [{ kitId: k3.id, values: bwSample }],
        }).expect(201)
      ).body.data as BatchDto;
      expect([next.code, next.samples[0]!.code]).toEqual([`B${YY}-00002`, `S${YY}-000003`]);
    });

    it('completes links at registration and reports every problem at once', async () => {
      const noVessel = await ballastKit();
      const res = await register({
        serviceTypeId: serviceTypeId('BW'),
        samples: [{ kitId: noVessel.id, values: { sampling_point: 'nowhere' } }],
      }).expect(400);
      expect(res.body.error.details).toEqual(
        expect.arrayContaining([
          { path: 'samples.0.vesselId', message: 'Ballast Water samples need a vessel' },
          { path: 'samples.0.clientId', message: 'Choose the client' },
          { path: 'samples.0.sampling_point', message: 'Choose one of the listed options' },
          { path: 'samples.0.date_sampled', message: 'Date sampled is required' },
        ]),
      );
      expect(await prisma.registrationBatch.count()).toBe(0);
      expect(
        (await prisma.receivedKit.findUniqueOrThrow({ where: { id: noVessel.id } })).status,
      ).toBe('PENDING_REGISTRATION');

      // Choosing the vessel at registration also brings its primary client.
      const ok = (
        await register({
          serviceTypeId: serviceTypeId('BW'),
          samples: [{ kitId: noVessel.id, vesselId: star.id, values: bwSample }],
        }).expect(201)
      ).body.data as BatchDto;
      expect(ok.samples[0]).toMatchObject({ vessel: { id: star.id }, client: { id: alpha.id } });
    });

    it('allows samples without a vessel where the service type does not need one, but never without a client', async () => {
      const w = await waterKit();
      const pw = { sampling_point: 'Galley tap', date_sampled: '2026-11-20' };
      const noClient = await register({
        serviceTypeId: serviceTypeId('PW'),
        samples: [{ kitId: w.id, values: pw }],
      }).expect(400);
      expect(noClient.body.error.details).toEqual([
        { path: 'samples.0.clientId', message: 'Choose the client' },
      ]);
      const batch = (
        await register({
          serviceTypeId: serviceTypeId('PW'),
          samples: [{ kitId: w.id, clientId: beta.id, values: pw }],
        }).expect(201)
      ).body.data as BatchDto;
      expect(batch.samples[0]).toMatchObject({ vessel: null, client: { id: beta.id } });
    });

    it('rejects kits received for another service type or of another kit type', async () => {
      const gw = await waterKit({ serviceTypeId: serviceTypeId('GW') });
      const open = await waterKit();
      const res = await register({
        serviceTypeId: serviceTypeId('BW'),
        samples: [
          { kitId: gw.id, vesselId: star.id, values: bwSample },
          { kitId: open.id, vesselId: star.id, values: bwSample },
        ],
      }).expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'samples.0.kitId', message: `${gw.code} was received for Grey Water` },
        { path: 'samples.1.kitId', message: 'Water Quality Kit is not used for Ballast Water' },
      ]);
    });

    it('a kit is registered once only, even when two users register it at the same time', async () => {
      const kit = await ballastKit({ vesselId: star.id });
      const body = {
        serviceTypeId: serviceTypeId('BW'),
        samples: [{ kitId: kit.id, values: bwSample }],
      };
      const results = await Promise.all([register(body), register(body)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.sample.count()).toBe(1);
      expect(await prisma.registrationBatch.count()).toBe(1);
      await register(body).expect(409);

      const cancelled = await ballastKit({ vesselId: star.id });
      await as(admin)
        .post(`/api/v1/receiving/kits/${cancelled.id}/cancel`, { reason: 'Broken' })
        .expect(201);
      await register({ ...body, samples: [{ kitId: cancelled.id, values: bwSample }] }).expect(409);
    });

    it('the database refuses a sample whose kit is not registered', async () => {
      const done = await ballastKit({ vesselId: star.id });
      const batch = (
        await register({
          serviceTypeId: serviceTypeId('BW'),
          samples: [{ kitId: done.id, values: bwSample }],
        }).expect(201)
      ).body.data as BatchDto;
      const pending = await ballastKit({ vesselId: star.id });
      await expect(
        prisma.sample.create({
          data: {
            tenantId,
            code: `S${YY}-999999`,
            batchId: batch.id,
            serviceTypeId: serviceTypeId('BW'),
            receivedKitId: pending.id,
            clientId: alpha.id,
          },
        }),
      ).rejects.toThrow(/not registered/);
    });
  });

  describe('reading', () => {
    it('lists and shows samples and batches', async () => {
      const k1 = await ballastKit({ vesselId: star.id, serialNumber: 'FIND-ME' });
      const k2 = await ballastKit({ vesselId: wind.id });
      const batch = (
        await register({
          serviceTypeId: serviceTypeId('BW'),
          values: { port_of_sampling: 'Rotterdam' },
          samples: [
            { kitId: k1.id, values: bwSample },
            { kitId: k2.id, values: bwSample },
          ],
        }).expect(201)
      ).body.data as BatchDto;

      const byVessel = (await as(admin).get(`/api/v1/samples?vesselId=${wind.id}`).expect(200))
        .body;
      expect(byVessel.data.map((s: SampleSummaryDto) => s.kit.id)).toEqual([k2.id]);
      const bySerial = (await as(admin).get('/api/v1/samples?q=find-me').expect(200)).body.data;
      expect(bySerial.map((s: SampleSummaryDto) => s.kit.serialNumber)).toEqual(['FIND-ME']);

      const sample = (await as(admin).get(`/api/v1/samples/${batch.samples[0]!.id}`).expect(200))
        .body.data as SampleDto;
      expect(sample).toMatchObject({
        code: `S${YY}-000001`,
        batch: { id: batch.id, code: batch.code },
        values: bwSample,
        batchValues: { port_of_sampling: 'Rotterdam' },
        airwayBill: { id: awbId, number: 'AWB-1' },
        kit: { serialNumber: 'FIND-ME', product: { code: 'BWK' } },
      });
      expect(sample.fields.map((f) => f.key)).toContain('sampling_point');

      const batches = (await as(admin).get('/api/v1/samples/batches').expect(200)).body;
      expect(batches.data).toEqual([expect.objectContaining({ code: batch.code, sampleCount: 2 })]);
      expect(batches.meta.total).toBe(1);
    });
  });

  describe('access', () => {
    it('viewers cannot register; the Samples module must be enabled', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['samples', 'receiving'],
        permissions: ['sample.view', 'receiving.view'],
      });
      await createUser(prisma, { email: 'view@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'view@acme.test');
      const kit = await ballastKit({ vesselId: star.id });
      await as(viewer).get('/api/v1/samples').expect(200);
      await as(viewer)
        .post('/api/v1/samples/batches', {
          serviceTypeId: serviceTypeId('BW'),
          samples: [{ kitId: kit.id, values: bwSample }],
        })
        .expect(403);
      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'samples' } });
      await as(admin).get('/api/v1/samples').expect(403);
    });

    it('other organisations cannot register or see our kits and samples', async () => {
      const kit = await ballastKit({ vesselId: star.id });
      const other = await createTenant(prisma, {
        slug: 'other',
        modules: ['samples', 'receiving', 'lab-setup'],
      });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const outsider = await loginCookie(app, 'admin@other.test');
      const res = await as(outsider)
        .post('/api/v1/samples/batches', {
          serviceTypeId: serviceTypeId('BW'),
          samples: [{ kitId: kit.id, values: bwSample }],
        })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('serviceTypeId');
      expect((await as(outsider).get('/api/v1/samples').expect(200)).body.data).toEqual([]);
    });
  });
});
