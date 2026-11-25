import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  BatchResultsDto,
  BatchSummaryDto,
  ReceiveRegisterOptionsDto,
  SampleResultsDto,
  SampleSummaryDto,
  ServiceTypeDto,
  TestParameterDto,
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

describe('Testing and results (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let options: ReceiveRegisterOptionsDto;
  let bwType: ServiceTypeDto;
  let batch: BatchDto;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
  });
  const param = (key: string, list: TestParameterDto[] = bwType.parameters) =>
    list.find((p) => p.key === key)!;
  const save = (sampleId: string, values: Record<string, unknown>) =>
    as(admin).put(`/api/v1/samples/${sampleId}/results`, {
      results: Object.entries(values).map(([key, value]) => ({
        parameterId: param(key).id,
        value,
      })),
    });
  const allPassing = { org_50: 2, org_10_50: 1, e_coli: 10, enterococci: 5, v_cholerae: 'pass' };

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
    const client = (await as(admin).post('/api/v1/clients', { name: 'Alpha' }).expect(201)).body
      .data;
    const vessel = (
      await as(admin)
        .post('/api/v1/vessels', {
          name: 'Aegean Star',
          relationship: { clientId: client.id, relationshipTypeId: owner.id, isPrimary: true },
        })
        .expect(201)
    ).body.data;
    options = (await as(admin).get('/api/v1/samples/receive-register-options').expect(200)).body
      .data;
    const bwk = options.kits.find((k) => k.code === 'BWK')!;
    const bw = options.serviceTypes.find((s) => s.code === 'BW')!;
    const kit = (n: number) => ({
      productId: bwk.id,
      variantId: bwk.variants[0]!.id,
      vesselId: vessel.id,
      serialNumber: `BW-${n}`,
      values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
    });
    batch = (
      await as(admin)
        .post('/api/v1/samples/receive-and-register', {
          airwayBill: { number: 'AWB-T' },
          serviceTypeId: bw.id,
          samples: [kit(1), kit(2)],
        })
        .expect(201)
    ).body.data;
    bwType = (await as(admin).get(`/api/v1/lab/service-types/${bw.id}`).expect(200)).body.data;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('parameters', () => {
    it('comes with the starter catalogue and validates limits', async () => {
      expect(bwType.parameters.map((p) => p.key)).toEqual([
        'org_50',
        'org_10_50',
        'e_coli',
        'enterococci',
        'v_cholerae',
      ]);
      expect(param('org_50')).toMatchObject({
        unit: 'per m³',
        type: 'NUMBER',
        decimals: 0,
        criticalMax: 9,
        required: true,
      });

      const add = (body: object) =>
        as(admin).post(`/api/v1/lab/service-types/${bwType.id}/parameters`, body);
      const res = (
        await add({
          name: 'Salinity',
          type: 'NUMBER',
          unit: 'PSU',
          decimals: 1,
          cautionMax: 35,
        }).expect(201)
      ).body.data as ServiceTypeDto;
      expect(param('salinity', res.parameters)).toMatchObject({ name: 'Salinity', cautionMax: 35 });

      const bad = await add({
        name: 'Turbidity',
        type: 'NUMBER',
        cautionMax: 10,
        criticalMax: 5,
      }).expect(400);
      expect(bad.body.error.details).toEqual([
        { path: 'cautionMax', message: 'Caution max must not be above critical max' },
      ]);
      await add({ name: 'Colour', type: 'TEXT', criticalMax: 5 }).expect(400);
      await add({ name: 'Odour', type: 'CHOICE' }).expect(400);

      // Limits are checked against the stored values when only some are changed.
      const merged = await as(admin)
        .patch(`/api/v1/lab/parameters/${param('org_50').id}`, { cautionMax: 20 })
        .expect(400);
      expect(merged.body.error.details[0].path).toBe('cautionMax');
    });
  });

  describe('individual sample', () => {
    it('parses, flags and saves results; the sample goes under testing', async () => {
      const sample = batch.samples[0]!;
      let r = (await as(admin).get(`/api/v1/samples/${sample.id}/results`).expect(200)).body
        .data as SampleResultsDto;
      expect(r).toMatchObject({ status: 'REGISTERED', results: [], worstFlag: null });
      expect(r.missingRequired).toHaveLength(5);

      r = (
        await save(sample.id, {
          org_50: '12',
          e_coli: '100',
          enterococci: 60,
          v_cholerae: 'pass',
        }).expect(200)
      ).body.data;
      const flags = Object.fromEntries(
        r.results.map((x) => [
          r.parameters.find((p) => p.id === x.parameterId)!.key,
          [x.value, x.flag],
        ]),
      );
      expect(flags).toEqual({
        org_50: [12, 'CRITICAL'],
        e_coli: [100, 'NORMAL'],
        enterococci: [60, 'CAUTION'],
        v_cholerae: [true, 'NORMAL'],
      });
      expect(r).toMatchObject({
        status: 'UNDER_TESTING',
        worstFlag: 'CRITICAL',
        missingRequired: ['Viable organisms 10–50 µm'],
      });

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'sample.results_saved' },
      });
      expect(audit.changes).toMatchObject({ 'Viable organisms ≥ 50 µm': { from: null, to: '12' } });

      // A cleared value removes the result.
      r = (await save(sample.id, { org_50: '' }).expect(200)).body.data;
      expect(r.results.map((x) => x.parameterId)).not.toContain(param('org_50').id);
    });

    it('rejects values the parameter does not accept', async () => {
      const res = await save(batch.samples[0]!.id, {
        org_50: '1.5',
        v_cholerae: 'maybe',
        e_coli: 'many',
      }).expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'org_50', message: 'Viable organisms ≥ 50 µm: at most 0 decimal places' },
        { path: 'v_cholerae', message: 'Toxicogenic Vibrio cholerae must be pass or fail' },
        { path: 'e_coli', message: 'E. coli must be a number' },
      ]);
      expect(await prisma.sampleResult.count()).toBe(0);
      const lube = options.serviceTypes.find((s) => s.code === 'LO')!;
      const loType = (await as(admin).get(`/api/v1/lab/service-types/${lube.id}`).expect(200)).body
        .data;
      const other = await as(admin)
        .put(`/api/v1/samples/${batch.samples[0]!.id}/results`, {
          results: [{ parameterId: loType.parameters[0].id, value: 100 }],
        })
        .expect(400);
      expect(other.body.error.details[0].message).toBe('Unknown parameter for this service type');
    });

    it('completes only with every required result, locks, and reopens', async () => {
      const id = batch.samples[0]!.id;
      await save(id, { org_50: 1 }).expect(200);
      const early = await as(admin).post(`/api/v1/samples/${id}/complete-results`).expect(400);
      expect(early.body.error.message).toMatch(/^Required results are missing: /);
      await save(id, allPassing).expect(200);
      const done = (await as(admin).post(`/api/v1/samples/${id}/complete-results`).expect(201)).body
        .data;
      expect(done.status).toBe('RESULTS_ENTERED');
      const locked = await save(id, { org_50: 3 }).expect(400);
      expect(locked.body.error.details[0].message).toMatch(/completed; reopen them/);
      expect(
        (await as(admin).post(`/api/v1/samples/${id}/reopen-results`).expect(201)).body.data.status,
      ).toBe('UNDER_TESTING');
      await save(id, { org_50: 3 }).expect(200);
      const actions = (
        await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { occurredAt: 'asc' } })
      ).map((a) => a.action);
      expect(actions).toEqual([
        'sample.results_saved',
        'sample.results_saved',
        'sample.results_completed',
        'sample.results_reopened',
        'sample.results_saved',
      ]);
    });
  });

  describe('batch', () => {
    const rows = (values: Record<string, unknown>[]) => ({
      samples: batch.samples.map((s, i) => ({
        sampleId: s.id,
        results: Object.entries(values[i] ?? {}).map(([key, value]) => ({
          parameterId: param(key).id,
          value,
        })),
      })),
    });

    it('previews with a dry run, saves all or nothing, and reports per sample', async () => {
      const preview = (
        await as(admin)
          .put(
            `/api/v1/samples/batches/${batch.id}/results?dryRun=true`,
            rows([allPassing, { org_50: 40 }]),
          )
          .expect(200)
      ).body.data as BatchResultsDto;
      expect(preview.samples.map((s) => [s.worstFlag, s.status])).toEqual([
        ['NORMAL', 'UNDER_TESTING'],
        ['CRITICAL', 'UNDER_TESTING'],
      ]);
      expect(await prisma.sampleResult.count()).toBe(0);
      expect(await prisma.sample.count({ where: { status: 'REGISTERED' } })).toBe(2);
      expect(await prisma.auditLog.count({ where: { action: 'sample.results_saved' } })).toBe(0);

      const bad = await as(admin)
        .put(`/api/v1/samples/batches/${batch.id}/results`, rows([allPassing, { org_50: 'x' }]))
        .expect(400);
      expect(bad.body.error.details).toEqual([
        { path: 'samples.1.org_50', message: 'Viable organisms ≥ 50 µm must be a number' },
      ]);
      expect(await prisma.sampleResult.count()).toBe(0);

      await as(admin)
        .put(`/api/v1/samples/batches/${batch.id}/results`, rows([allPassing, allPassing]))
        .expect(200);
      expect(await prisma.sampleResult.count()).toBe(10);
    });

    it('starts testing and completes the batch only when every sample is complete', async () => {
      const started = (
        await as(admin).post(`/api/v1/samples/batches/${batch.id}/start-testing`).expect(201)
      ).body.data as BatchResultsDto;
      expect(started.samples.map((s) => s.status)).toEqual(['UNDER_TESTING', 'UNDER_TESTING']);

      await as(admin)
        .put(`/api/v1/samples/batches/${batch.id}/results`, rows([allPassing, { org_50: 1 }]))
        .expect(200);
      const incomplete = await as(admin)
        .post(`/api/v1/samples/batches/${batch.id}/complete-results`)
        .expect(400);
      expect(incomplete.body.error.details).toEqual([
        { path: 'samples.1', message: expect.stringMatching(/^S\d{2}-\d{6}: missing /) },
      ]);
      await as(admin)
        .put(`/api/v1/samples/batches/${batch.id}/results`, rows([{}, allPassing]))
        .expect(200);
      const done = (
        await as(admin).post(`/api/v1/samples/batches/${batch.id}/complete-results`).expect(201)
      ).body.data as BatchResultsDto;
      expect(done.samples.map((s) => s.status)).toEqual(['RESULTS_ENTERED', 'RESULTS_ENTERED']);
    });

    it('shows progress and flags in lists', async () => {
      await as(admin)
        .put(`/api/v1/samples/batches/${batch.id}/results`, rows([{ ...allPassing, org_50: 50 }]))
        .expect(200);
      const samples = (await as(admin).get('/api/v1/samples?open=true').expect(200)).body
        .data as SampleSummaryDto[];
      expect(samples.map((s) => [s.status, s.worstFlag]).sort()).toEqual([
        ['REGISTERED', null],
        ['UNDER_TESTING', 'CRITICAL'],
      ]);
      const batches = (await as(admin).get('/api/v1/samples/batches?open=true').expect(200)).body
        .data as BatchSummaryDto[];
      expect(batches[0]!.statusCounts).toEqual({
        REGISTERED: 1,
        UNDER_TESTING: 1,
        RESULTS_ENTERED: 0,
      });
    });
  });

  describe('access', () => {
    it('viewers read results; entering them needs sample.test', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['samples'],
        permissions: ['sample.view'],
      });
      await createUser(prisma, { email: 'view@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'view@acme.test');
      const id = batch.samples[0]!.id;
      await as(viewer).get(`/api/v1/samples/${id}/results`).expect(200);
      await as(viewer)
        .put(`/api/v1/samples/${id}/results`, {
          results: [{ parameterId: param('org_50').id, value: 1 }],
        })
        .expect(403);
      await as(viewer).post(`/api/v1/samples/batches/${batch.id}/start-testing`).expect(403);
    });

    it('the database refuses a result whose parameter belongs to another service type', async () => {
      const lo = await prisma.testParameter.findFirstOrThrow({ where: { key: 'viscosity_40' } });
      const sample = await prisma.sample.findFirstOrThrow();
      await expect(
        prisma.sampleResult.create({
          data: {
            tenantId,
            sampleId: sample.id,
            serviceTypeId: sample.serviceTypeId,
            parameterId: lo.id,
            valueNumber: 1,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
