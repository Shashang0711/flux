import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { VesselDto } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import {
  createE2eApp,
  createReferenceItem,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Vessels (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let bulkId: string;
  let tankerId: string;
  let lrId: string;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => api().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
  });
  const createVessel = async (body: object, cookie = admin): Promise<VesselDto> =>
    (await as(cookie).post('/api/v1/vessels', body).expect(201)).body.data;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    bulkId = (
      await createReferenceItem(prisma, { list: 'vessel-type', code: 'BULK', name: 'Bulk Carrier' })
    ).id;
    tankerId = (
      await createReferenceItem(prisma, { list: 'vessel-type', code: 'TANKER', name: 'Oil Tanker' })
    ).id;
    lrId = (
      await createReferenceItem(prisma, {
        list: 'classification-society',
        code: 'LR',
        name: "Lloyd's Register",
      })
    ).id;
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['vessels'] });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('creating vessels', () => {
    it('generates VS-00001…, normalises the IMO number and resolves references', async () => {
      const v = await createVessel({
        name: 'Aegean Star',
        imoNumber: 'IMO 9074729',
        vesselTypeId: bulkId,
        classificationSocietyId: lrId,
        yearBuilt: '2012',
        grossTonnage: 43000,
        deadweight: '',
      });
      expect(v).toMatchObject({
        code: 'VS-00001',
        imoNumber: '9074729',
        yearBuilt: 2012,
        grossTonnage: 43000,
        deadweight: null,
        vesselType: { id: bulkId, name: 'Bulk Carrier' },
        classificationSociety: { name: "Lloyd's Register" },
        status: 'ACTIVE',
      });
      expect((await createVessel({ name: 'Second' })).code).toBe('VS-00002');
    });

    it('rejects an IMO number with a wrong check digit, and implausible numbers', async () => {
      const res = await as(admin)
        .post('/api/v1/vessels', {
          name: 'X',
          imoNumber: '9074728',
          yearBuilt: 1700,
          grossTonnage: -5,
        })
        .expect(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'grossTonnage',
        'imoNumber',
        'yearBuilt',
      ]);
    });

    it('allows many vessels without an IMO number', async () => {
      await createVessel({ name: 'Tug One' });
      await createVessel({ name: 'Tug Two', imoNumber: '' });
    });
  });

  describe('duplicate IMO numbers', () => {
    it('blocks a duplicate and points at the existing vessel', async () => {
      const existing = await createVessel({ name: 'Aegean Star', imoNumber: '9074729' });
      const res = await as(admin)
        .post('/api/v1/vessels', { name: 'Copy', imoNumber: 'IMO 9074729' })
        .expect(409);
      expect(res.body.error).toMatchObject({
        code: 'CONFLICT',
        details: { existingVessel: { id: existing.id, code: 'VS-00001', name: 'Aegean Star' } },
      });
      expect(res.body.error.details.fields[0]).toMatchObject({ path: 'imoNumber' });
      // The failed create took no number.
      expect((await createVessel({ name: 'Next' })).code).toBe('VS-00002');
    });

    it('also blocks changing another vessel to that IMO', async () => {
      await createVessel({ name: 'A', imoNumber: '9074729' });
      const b = await createVessel({ name: 'B', imoNumber: '9176187' });
      await as(admin).patch(`/api/v1/vessels/${b.id}`, { imoNumber: '9074729' }).expect(409);
      await as(admin)
        .patch(`/api/v1/vessels/${b.id}`, { imoNumber: '9176187', name: 'B2' })
        .expect(200);
    });

    it('is per tenant: another organisation can register the same ship', async () => {
      await createVessel({ name: 'Aegean Star', imoNumber: '9074729' });
      const other = await createTenant(prisma, { slug: 'other', modules: ['vessels'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      expect(
        (await createVessel({ name: 'Aegean Star', imoNumber: '9074729' }, otherAdmin)).code,
      ).toBe('VS-00001');
    });
  });

  describe('reference data', () => {
    it('only accepts items of the right list', async () => {
      const res = await as(admin)
        .post('/api/v1/vessels', { name: 'X', vesselTypeId: lrId })
        .expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'vesselTypeId', message: 'Choose an available vessel type' },
      ]);
    });

    it('rejects hidden or inactive items for new choices, but keeps an existing value', async () => {
      const v = await createVessel({ name: 'Keeper', vesselTypeId: tankerId });
      await api()
        .put(`/api/v1/reference-data/vessel-type/${tankerId}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: true })
        .expect(200);
      await as(admin).post('/api/v1/vessels', { name: 'New', vesselTypeId: tankerId }).expect(400);
      await as(admin)
        .patch(`/api/v1/vessels/${v.id}`, { vesselTypeId: tankerId, name: 'Keeper 2' })
        .expect(200);
    });

    it('accepts the tenant’s own items, but never another tenant’s', async () => {
      const own = await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'RESEARCH',
        name: 'Research',
        tenantId,
      });
      expect(
        (await createVessel({ name: 'Explorer', vesselTypeId: own.id })).vesselType?.name,
      ).toBe('Research');

      const other = await createTenant(prisma, { slug: 'other', modules: ['vessels'] });
      const foreign = await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'SECRET',
        name: 'Secret',
        tenantId: other.id,
      });
      await as(admin)
        .post('/api/v1/vessels', { name: 'Spy', vesselTypeId: foreign.id })
        .expect(400);

      // Even bypassing the API, the database refuses it.
      await expect(
        app.get(TenantDb).run(tenantId, (tx) =>
          tx.vessel.create({
            data: { tenantId, code: 'VS-99999', name: 'Spy', vesselTypeId: foreign.id },
          }),
        ),
      ).rejects.toThrow(/another organisation/);
    });

    it('the database refuses a classification society as a vessel type', async () => {
      await expect(
        app.get(TenantDb).run(tenantId, (tx) =>
          tx.vessel.create({
            data: { tenantId, code: 'VS-99998', name: 'Wrong', vesselTypeId: lrId },
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });

  describe('custom fields, search and status', () => {
    it('supports vessel custom fields', async () => {
      await as(admin)
        .post('/api/v1/custom-fields', {
          entity: 'vessel',
          label: 'P&I Club',
          type: 'TEXT',
          required: true,
        })
        .expect(201);
      await as(admin).post('/api/v1/vessels', { name: 'No club' }).expect(400);
      const v = await createVessel({ name: 'Clubbed', customFields: { p_i_club: 'Gard' } });
      expect(v.customFields).toEqual({ p_i_club: 'Gard' });
    });

    it('searches by name, previous name, IMO and code; filters by status and type', async () => {
      const a = await createVessel({
        name: 'Aegean Star',
        previousName: 'Nordic Light',
        imoNumber: '9074729',
        vesselTypeId: bulkId,
      });
      await createVessel({ name: 'Baltic Wind', imoNumber: '9176187', vesselTypeId: tankerId });
      await as(admin).patch(`/api/v1/vessels/${a.id}`, { status: 'INACTIVE' }).expect(200);

      const names = async (q: string) =>
        (await as(admin).get(`/api/v1/vessels?${q}`)).body.data.map((v: VesselDto) => v.name);
      expect(await names('q=nordic')).toEqual(['Aegean Star']);
      expect(await names('q=IMO 9176187')).toEqual(['Baltic Wind']);
      expect(await names('q=VS-00002')).toEqual(['Baltic Wind']);
      expect(await names('status=INACTIVE')).toEqual(['Aegean Star']);
      expect(await names(`vesselTypeId=${tankerId}`)).toEqual(['Baltic Wind']);
    });
  });

  describe('access and isolation', () => {
    it('requires the Vessels module and vessel permissions', async () => {
      const nomod = await createTenant(prisma, { slug: 'nomod' });
      await createUser(prisma, {
        email: 'a@nomod.test',
        tenantId: nomod.id,
        roleIds: [nomod.adminRoleId],
      });
      await as(await loginCookie(app, 'a@nomod.test'))
        .get('/api/v1/vessels')
        .expect(403);

      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['vessels'],
        permissions: ['vessel.view'],
      });
      await createUser(prisma, { email: 'v@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'v@acme.test');
      await as(viewer).get('/api/v1/vessels').expect(200);
      await as(viewer).post('/api/v1/vessels', { name: 'Nope' }).expect(403);
    });

    it('another tenant cannot see or change the vessels', async () => {
      const v = await createVessel({ name: 'Private' });
      const other = await createTenant(prisma, { slug: 'other', modules: ['vessels'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      expect((await as(otherAdmin).get('/api/v1/vessels')).body.data).toEqual([]);
      await as(otherAdmin).get(`/api/v1/vessels/${v.id}`).expect(404);
      await as(otherAdmin).patch(`/api/v1/vessels/${v.id}`, { name: 'Hijacked' }).expect(404);
    });
  });

  it('audits changes with reference names', async () => {
    const v = await createVessel({ name: 'Aegean Star', vesselTypeId: bulkId });
    await as(admin)
      .patch(`/api/v1/vessels/${v.id}`, { vesselTypeId: tankerId, yearBuilt: 2010 })
      .expect(200);
    await as(admin).patch(`/api/v1/vessels/${v.id}`, { status: 'INACTIVE' }).expect(200);
    const log = await as(admin).get(`/api/v1/audit-logs?entityId=${v.id}`).expect(200);
    expect(log.body.data.map((e: { action: string }) => e.action)).toEqual([
      'vessel.deactivated',
      'vessel.updated',
      'vessel.created',
    ]);
    expect(log.body.data[1].changes).toEqual({
      yearBuilt: { from: null, to: 2010 },
      vesselType: { from: 'Bulk Carrier', to: 'Oil Tanker' },
    });
    expect(log.body.data[2].entity).toMatchObject({
      type: 'vessel',
      label: 'VS-00001 Aegean Star',
    });
  });
});
