import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  AirwayBillDto,
  ClientDto,
  ProductSummaryDto,
  ReceivedKitDto,
  ReceivingOptionsDto,
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

describe('Receiving (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let options: ReceivingOptionsDto;
  let awb: AirwayBillDto;
  let alpha: ClientDto;
  let beta: ClientDto;
  let vessel: VesselDto;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
  });
  const R = '/api/v1/receiving';
  const kitType = (code: string) => options.kits.find((k) => k.code === code)!;
  const receive = (body: object, awbId = awb.id) =>
    as(admin).post(`${R}/airway-bills/${awbId}/kits`, body);
  const received = async (body: object): Promise<ReceivedKitDto> =>
    (await receive(body).expect(201)).body.data;
  const bwk = () => ({ productId: kitType('BWK').id, variantId: kitType('BWK').variants[0]!.id });
  const queue = async (query = ''): Promise<ReceivedKitDto[]> =>
    (await as(admin).get(`${R}/registration-queue${query}`).expect(200)).body.data;

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
      modules: ['receiving', 'lab-setup', 'clients', 'vessels'],
    });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
    await as(admin).post('/api/v1/lab/starter-catalogue').expect(201);
    alpha = (await as(admin).post('/api/v1/clients', { name: 'Alpha Owners' }).expect(201)).body
      .data;
    beta = (await as(admin).post('/api/v1/clients', { name: 'Beta Management' }).expect(201)).body
      .data;
    vessel = (
      await as(admin)
        .post('/api/v1/vessels', {
          name: 'Aegean Star',
          imoNumber: '9074729',
          relationship: { clientId: alpha.id, relationshipTypeId: owner.id, isPrimary: true },
        })
        .expect(201)
    ).body.data;
    options = (await as(admin).get(`${R}/options`).expect(200)).body.data;
    awb = (
      await as(admin)
        .post(`${R}/airway-bills`, { number: '176 1234 5675', courier: 'DHL', origin: 'Singapore' })
        .expect(201)
    ).body.data;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('airway bills', () => {
    it('normalises numbers, rejects duplicates and defaults the date to today', async () => {
      expect(awb).toMatchObject({
        number: '17612345675',
        status: 'OPEN',
        kitCount: 0,
        receivedOn: new Date().toISOString().slice(0, 10),
      });
      const dup = await as(admin).post(`${R}/airway-bills`, { number: '1761234 5675' }).expect(400);
      expect(dup.body.error.details).toEqual([
        { path: 'number', message: 'An airway bill with this number already exists' },
      ]);
    });

    it('closed AWBs take no kits until reopened', async () => {
      await as(admin).post(`${R}/airway-bills/${awb.id}/close`).expect(201);
      const res = await receive(bwk()).expect(400);
      expect(res.body.error.message).toMatch(/closed/);
      await as(admin).post(`${R}/airway-bills/${awb.id}/reopen`).expect(201);
      await receive(bwk()).expect(201);
      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: awb.id },
          orderBy: { occurredAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual([
        'receiving.awb_created',
        'receiving.awb_closed',
        'receiving.awb_reopened',
      ]);
    });

    it('lists AWBs with kit counts', async () => {
      await received(bwk());
      const k = await received(bwk());
      await as(admin).post(`${R}/kits/${k.id}/cancel`, { reason: 'Duplicate scan' }).expect(201);
      const list = (await as(admin).get(`${R}/airway-bills?status=OPEN`).expect(200)).body;
      expect(list.data[0]).toMatchObject({ number: '17612345675', kitCount: 1, pendingCount: 1 });
      expect(list.meta.total).toBe(1);
    });
  });

  describe('receiving kits', () => {
    it('generates kit IDs, fills the only service type and lists what is missing', async () => {
      const kit = await received({ ...bwk(), serialNumber: 'bw-001' });
      expect(kit).toMatchObject({
        code: 'RK-000001',
        serialNumber: 'BW-001',
        product: { code: 'BWK' },
        serviceType: { code: 'BW' },
        status: 'PENDING_REGISTRATION',
        condition: 'OK',
        missing: ['client', 'vessel'],
        receivedBy: expect.any(String),
      });
      const wqk = await received({ productId: kitType('WQK').id });
      expect(wqk.code).toBe('RK-000002');
      expect(wqk.missing).toEqual(['serviceType', 'client', 'vessel']);
    });

    it('requires the variant when the kit has variants, and checks kit links', async () => {
      const noVariant = await receive({ productId: kitType('BWK').id }).expect(400);
      expect(noVariant.body.error.details[0]).toEqual({
        path: 'variantId',
        message: 'Choose the variant (Electrolysis, Ozone, UV)',
      });
      await receive({
        productId: kitType('LOK').id,
        variantId: kitType('BWK').variants[0]!.id,
      }).expect(400);
      const wrongService = await receive({
        productId: kitType('LOK').id,
        serviceTypeId: kitType('WQK').serviceTypes[0]!.id,
      }).expect(400);
      expect(wrongService.body.error.details[0].path).toBe('serviceTypeId');
    });

    it("links a vessel with its primary client, and rejects a client the vessel isn't linked to", async () => {
      const kit = await received({ ...bwk(), vesselId: vessel.id });
      expect(kit.client).toMatchObject({ id: alpha.id });
      expect(kit.missing).toEqual([]);
      const res = await receive({ ...bwk(), vesselId: vessel.id, clientId: beta.id }).expect(400);
      expect(res.body.error.details[0]).toEqual({
        path: 'clientId',
        message: 'This vessel is not linked to that client',
      });
      // A client alone (no vessel) is fine: e.g. machinery samples.
      expect((await received({ ...bwk(), clientId: beta.id })).missing).toEqual(['vessel']);
    });

    it('keeps serials unique among live kits; cancelling frees the serial', async () => {
      const first = await received({ ...bwk(), serialNumber: 'BW-001' });
      const dup = await receive({ ...bwk(), serialNumber: 'bw-001' }).expect(400);
      expect(dup.body.error.details[0]).toEqual({
        path: 'serialNumber',
        message: 'Serial BW-001 is already received as RK-000001',
      });
      await as(admin).post(`${R}/kits/${first.id}/cancel`, {}).expect(400);
      const cancelled = (
        await as(admin)
          .post(`${R}/kits/${first.id}/cancel`, { reason: 'Scanned twice' })
          .expect(201)
      ).body.data as ReceivedKitDto;
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Scanned twice',
        missing: [],
      });
      await receive({ ...bwk(), serialNumber: 'BW-001' }).expect(201);
      await as(admin).patch(`${R}/kits/${first.id}`, { conditionNotes: 'x' }).expect(400);
    });

    it('completes a kit later and audits the change with readable values', async () => {
      const kit = await received({
        productId: kitType('WQK').id,
        condition: 'DAMAGED',
        conditionNotes: 'Cap cracked',
      });
      const pw = kitType('WQK').serviceTypes.find((s) => s.code === 'PW')!;
      const updated = (
        await as(admin)
          .patch(`${R}/kits/${kit.id}`, { serviceTypeId: pw.id, vesselId: vessel.id })
          .expect(200)
      ).body.data as ReceivedKitDto;
      expect(updated).toMatchObject({
        serviceType: { code: 'PW' },
        client: { id: alpha.id },
        missing: [],
      });
      const audit = await prisma.auditLog.findFirst({ where: { action: 'receiving.kit_updated' } });
      expect(audit!.changes).toMatchObject({
        serviceType: { from: null, to: 'Potable Water' },
        vessel: { from: null, to: `${vessel.code} Aegean Star` },
        client: { from: null, to: `${alpha.code} Alpha Owners` },
      });
      expect(audit!.relatedIds).toEqual(expect.arrayContaining([awb.id, vessel.id, alpha.id]));
    });
  });

  describe('registration queue', () => {
    it('shows linked and unlinked pending kits with filters', async () => {
      const linked = await received({ ...bwk(), vesselId: vessel.id, serialNumber: 'L-1' });
      const unlinked = await received({ productId: kitType('LOK').id, condition: 'LEAKING' });
      const gone = await received({ productId: kitType('FOK').id });
      await as(admin).post(`${R}/kits/${gone.id}/cancel`, { reason: 'Wrong lab' }).expect(201);

      expect((await queue()).map((k) => k.id)).toEqual([linked.id, unlinked.id]);
      expect((await queue('?link=linked')).map((k) => k.id)).toEqual([linked.id]);
      expect((await queue('?link=unlinked')).map((k) => k.id)).toEqual([unlinked.id]);
      expect((await queue('?flagged=true')).map((k) => k.id)).toEqual([unlinked.id]);
      expect((await queue('?q=l-1')).map((k) => k.id)).toEqual([linked.id]);
      expect((await queue(`?serviceTypeId=${linked.serviceType!.id}`)).map((k) => k.id)).toEqual([
        linked.id,
      ]);
      const paged = (await as(admin).get(`${R}/registration-queue?pageSize=1`).expect(200)).body;
      expect(paged.meta).toMatchObject({ total: 2, totalPages: 2 });
    });
  });

  describe('access and isolation', () => {
    it('receiving staff need no client, vessel or lab-setup permissions', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Receiver',
        modules: ['receiving'],
        permissions: ['receiving.receive'],
      });
      await createUser(prisma, { email: 'rx@acme.test', tenantId, roleIds: [role.id] });
      const rx = await loginCookie(app, 'rx@acme.test');
      const opts = (await as(rx).get(`${R}/options`).expect(200)).body.data as ReceivingOptionsDto;
      expect(opts.kits.map((k) => k.code)).toEqual(['BWK', 'FOK', 'LOK', 'WQK']);
      expect(opts.vessels[0]).toMatchObject({ name: 'Aegean Star', primaryClientId: alpha.id });
      await as(rx)
        .post(`${R}/airway-bills/${awb.id}/kits`, { ...bwk(), vesselId: vessel.id })
        .expect(201);
    });

    it('viewers cannot receive; the module must be enabled', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['receiving'],
        permissions: ['receiving.view'],
      });
      await createUser(prisma, { email: 'view@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'view@acme.test');
      await as(viewer).get(`${R}/registration-queue`).expect(200);
      await as(viewer).post(`${R}/airway-bills/${awb.id}/kits`, bwk()).expect(403);
      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'receiving' } });
      await as(admin).get(`${R}/registration-queue`).expect(403);
    });

    it('other organisations cannot see AWBs or use our kits', async () => {
      const other = await createTenant(prisma, {
        slug: 'other',
        modules: ['receiving', 'lab-setup'],
      });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const outsider = await loginCookie(app, 'admin@other.test');
      await as(outsider).get(`${R}/airway-bills/${awb.id}`).expect(404);
      await as(outsider).post(`${R}/airway-bills/${awb.id}/kits`, bwk()).expect(404);
      const theirs = (await as(outsider).post(`${R}/airway-bills`, { number: '999' }).expect(201))
        .body.data;
      const res = await as(outsider).post(`${R}/airway-bills/${theirs.id}/kits`, bwk()).expect(400);
      expect(res.body.error.details[0].path).toBe('productId');
    });

    it('the database refuses a variant of another kit', async () => {
      const kit = await received(bwk());
      const lok = (await prisma.product.findFirst({ where: { code: 'LOK' } }))!;
      await expect(
        prisma.receivedKit.update({ where: { id: kit.id }, data: { productId: lok.id } }),
      ).rejects.toThrow();
      const products: ProductSummaryDto[] = (
        await as(admin).get('/api/v1/lab/products').expect(200)
      ).body.data;
      expect(products.length).toBe(4);
    });
  });
});
