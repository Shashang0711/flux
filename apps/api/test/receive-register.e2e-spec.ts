import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { BatchDto, ClientDto, ReceiveRegisterOptionsDto, VesselDto } from '@flux/shared';
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

describe('Receive & Register (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let options: ReceiveRegisterOptionsDto;
  let alpha: ClientDto;
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
  const R = '/api/v1/samples/receive-and-register';
  const kitType = (code: string) => options.kits.find((k) => k.code === code)!;
  const bw = () => options.serviceTypes.find((s) => s.code === 'BW')!;
  const bwKit = (extra: object = {}) => ({
    productId: kitType('BWK').id,
    variantId: kitType('BWK').variants[0]!.id,
    vesselId: star.id,
    values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
    ...extra,
  });

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
    const beta = (await as(admin).post('/api/v1/clients', { name: 'Beta Management' }).expect(201))
      .body.data as ClientDto;
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
    options = (await as(admin).get('/api/v1/samples/receive-register-options').expect(200)).body
      .data;
  });

  afterAll(async () => {
    await app.close();
  });

  it('offers service types with their fields and the open airway bills', async () => {
    expect(bw()).toMatchObject({ vesselRequired: true });
    expect(bw().fields.map((f) => f.key)).toContain('port_of_sampling');
    expect(options.serviceTypes.map((s) => s.code)).toEqual(['BW', 'FO', 'GW', 'LO', 'PW']);
    await as(admin).post('/api/v1/receiving/airway-bills', { number: 'OPEN-1' }).expect(201);
    const again = (await as(admin).get('/api/v1/samples/receive-register-options').expect(200)).body
      .data as ReceiveRegisterOptionsDto;
    expect(again.openAirwayBills.map((a) => a.number)).toEqual(['OPEN-1']);
  });

  it('receives a package under a new AWB and registers its kits as one batch', async () => {
    const res = await as(admin)
      .post(R, {
        airwayBill: { number: '618 5555 0001', courier: 'DHL' },
        serviceTypeId: bw().id,
        values: { port_of_sampling: 'Piraeus' },
        samples: [
          bwKit({ serialNumber: 'rr-1' }),
          bwKit({ serialNumber: 'RR-2', vesselId: wind.id, condition: 'DAMAGED' }),
        ],
      })
      .expect(201);
    const batch = res.body.data as BatchDto;
    expect(
      batch.samples.map((s) => [s.vessel?.name, s.client.name, s.kit.serialNumber, s.status]),
    ).toEqual([
      ['Aegean Star', 'Alpha Owners', 'RR-1', 'REGISTERED'],
      ['Baltic Wind', 'Beta Management', 'RR-2', 'REGISTERED'],
    ]);
    expect(batch.values).toEqual({ port_of_sampling: 'Piraeus' });

    const awb = await prisma.airwayBill.findFirstOrThrow({ include: { kits: true } });
    expect(awb).toMatchObject({ number: '61855550001', courier: 'DHL', status: 'OPEN' });
    expect(awb.kits.map((k) => [k.status, k.condition])).toEqual(
      expect.arrayContaining([
        ['REGISTERED', 'OK'],
        ['REGISTERED', 'DAMAGED'],
      ]),
    );
    const queue = (await as(admin).get('/api/v1/receiving/registration-queue').expect(200)).body
      .data;
    expect(queue).toEqual([]);
    const actions = (await prisma.auditLog.findMany({ orderBy: { occurredAt: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions.filter((a) => a.startsWith('receiving.') || a.startsWith('sample.'))).toEqual([
      'receiving.awb_created',
      'receiving.kit_received',
      'receiving.kit_received',
      'sample.batch_registered',
    ]);
  });

  it('adds the package to an existing open AWB', async () => {
    const awb = (
      await as(admin).post('/api/v1/receiving/airway-bills', { number: 'OPEN-1' }).expect(201)
    ).body.data;
    await as(admin)
      .post(R, { airwayBillId: awb.id, serviceTypeId: bw().id, samples: [bwKit()] })
      .expect(201);
    expect(await prisma.receivedKit.count({ where: { airwayBillId: awb.id } })).toBe(1);
    expect(await prisma.airwayBill.count()).toBe(1);

    await as(admin).post(`/api/v1/receiving/airway-bills/${awb.id}/close`).expect(201);
    const closed = await as(admin)
      .post(R, { airwayBillId: awb.id, serviceTypeId: bw().id, samples: [bwKit()] })
      .expect(400);
    expect(closed.body.error.details).toEqual([
      { path: 'airwayBillId', message: 'This airway bill is closed' },
    ]);
  });

  it('reports every problem at once and saves nothing', async () => {
    const existing = (
      await as(admin).post('/api/v1/receiving/airway-bills', { number: 'TAKEN' }).expect(201)
    ).body.data;
    await as(admin)
      .post(`/api/v1/receiving/airway-bills/${existing.id}/kits`, {
        productId: kitType('LOK').id,
        serialNumber: 'USED-1',
      })
      .expect(201);
    const before = {
      awbs: await prisma.airwayBill.count(),
      kits: await prisma.receivedKit.count(),
    };

    const res = await as(admin)
      .post(R, {
        airwayBill: { number: 'taken' },
        serviceTypeId: bw().id,
        samples: [
          bwKit({ variantId: null, serialNumber: 'USED-1' }),
          bwKit({ vesselId: null, values: { sampling_point: 'intake' } }),
          bwKit({ productId: kitType('WQK').id, variantId: null }),
        ],
      })
      .expect(400);
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        { path: 'airwayBill.number', message: 'An airway bill with this number already exists' },
        { path: 'samples.0.variantId', message: 'Choose the variant (Electrolysis, Ozone, UV)' },
        {
          path: 'samples.0.serialNumber',
          message: 'Serial USED-1 is already received as RK-000001',
        },
        { path: 'samples.1.vesselId', message: 'Ballast Water samples need a vessel' },
        { path: 'samples.1.clientId', message: 'Choose the client' },
        { path: 'samples.1.date_sampled', message: 'Date sampled is required' },
        { path: 'samples.2.productId', message: 'This kit is not used for that service type' },
      ]),
    );
    expect({
      awbs: await prisma.airwayBill.count(),
      kits: await prisma.receivedKit.count(),
    }).toEqual(before);
    expect(await prisma.sample.count()).toBe(0);
  });

  it('rejects the same serial twice in one package', async () => {
    const res = await as(admin)
      .post(R, {
        airwayBill: { number: 'DUP' },
        serviceTypeId: bw().id,
        samples: [bwKit({ serialNumber: 'X-1' }), bwKit({ serialNumber: 'x-1' })],
      })
      .expect(400);
    expect(res.body.error.details).toEqual([
      { path: 'samples.1.serialNumber', message: 'Same serial as kit 1' },
    ]);
  });

  it('needs both receiving and registration permissions', async () => {
    const role = await createRole(prisma, {
      tenantId,
      name: 'Registrar',
      modules: ['samples', 'receiving'],
      permissions: ['sample.register', 'receiving.view'],
    });
    await createUser(prisma, { email: 'reg@acme.test', tenantId, roleIds: [role.id] });
    const registrar = await loginCookie(app, 'reg@acme.test');
    await as(registrar).get('/api/v1/samples/receive-register-options').expect(403);
    await as(registrar)
      .post(R, { airwayBill: { number: 'NOPE' }, serviceTypeId: bw().id, samples: [bwKit()] })
      .expect(403);
  });
});
