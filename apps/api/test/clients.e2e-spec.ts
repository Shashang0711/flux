import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ClientDto } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import { nextSequence } from '../src/database/sequences';
import { TenantDb } from '../src/database/tenant-db.service';
import {
  createE2eApp,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

const ADDRESS = {
  type: 'REGISTERED',
  line1: '1 Harbour Road',
  city: 'Rotterdam',
  country: 'Netherlands',
};

describe('Clients (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => api().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
    delete: (url: string) => api().delete(url).set('Cookie', cookie),
  });
  const createClient = async (name: string, cookie = admin): Promise<ClientDto> =>
    (await as(cookie).post('/api/v1/clients', { name }).expect(201)).body.data;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['clients'] });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('Client ID generation', () => {
    it('generates CL-00001, CL-00002, … per tenant', async () => {
      const a = await createClient('Alpha Shipping');
      const b = await createClient('Beta Maritime');
      expect([a.code, b.code]).toEqual(['CL-00001', 'CL-00002']);

      const other = await createTenant(prisma, { slug: 'other', modules: ['clients'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      expect((await createClient('Gamma Lines', otherAdmin)).code).toBe('CL-00001');
    });

    it('gives concurrent creates distinct, consecutive codes', async () => {
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          as(admin).post('/api/v1/clients', { name: `Client ${i}` }),
        ),
      );
      expect(results.every((r) => r.status === 201)).toBe(true);
      const codes = results.map((r) => r.body.data.code).sort();
      expect(codes).toEqual(Array.from({ length: 8 }, (_, i) => `CL-0000${i + 1}`));
    });

    it('returns the number when the transaction that took it rolls back (no gaps)', async () => {
      await expect(
        app.get(TenantDb).run(tenantId, async (tx) => {
          expect(await nextSequence(tx, tenantId, 'client')).toBe(1);
          throw new Error('simulated failure after taking a number');
        }),
      ).rejects.toThrow('simulated failure');
      expect((await createClient('First')).code).toBe('CL-00001');
    });
  });

  describe('access', () => {
    it('requires the Clients module', async () => {
      const other = await createTenant(prisma, { slug: 'nomod' });
      await createUser(prisma, {
        email: 'a@nomod.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const cookie = await loginCookie(app, 'a@nomod.test');
      const res = await as(cookie).get('/api/v1/clients').expect(403);
      expect(res.body.error.code).toBe('MODULE_NOT_ENABLED');
    });

    it('client.view can read but not change', async () => {
      await createClient('Alpha');
      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['clients'],
        permissions: ['client.view'],
      });
      await createUser(prisma, { email: 'v@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'v@acme.test');
      expect((await as(viewer).get('/api/v1/clients').expect(200)).body.data).toHaveLength(1);
      await as(viewer).post('/api/v1/clients', { name: 'Nope' }).expect(403);
    });
  });

  describe('client record', () => {
    it('creates with optional fields, normalising empty strings to null', async () => {
      const res = await as(admin)
        .post('/api/v1/clients', {
          name: '  Alpha Shipping BV ',
          tradingName: '',
          email: 'Ops@Alpha.example',
          website: 'https://alpha.example',
          taxNumber: 'NL123',
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Alpha Shipping BV',
        tradingName: null,
        email: 'ops@alpha.example',
        status: 'ACTIVE',
        addresses: [],
        contacts: [],
        billingParties: [],
      });
    });

    it('validates email and website', async () => {
      const res = await as(admin)
        .post('/api/v1/clients', { name: 'X', email: 'nope', website: 'alpha.example' })
        .expect(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'email',
        'website',
      ]);
    });

    it('lists with search (name, code, email) and status filter', async () => {
      const alpha = await createClient('Alpha Shipping');
      await createClient('Beta Maritime');
      await as(admin).patch(`/api/v1/clients/${alpha.id}`, { status: 'INACTIVE' }).expect(200);

      const byName = await as(admin).get('/api/v1/clients?q=beta');
      expect(byName.body.data.map((c: ClientDto) => c.name)).toEqual(['Beta Maritime']);
      const byCode = await as(admin).get('/api/v1/clients?q=CL-00001');
      expect(byCode.body.data.map((c: ClientDto) => c.name)).toEqual(['Alpha Shipping']);
      const inactive = await as(admin).get('/api/v1/clients?status=INACTIVE');
      expect(inactive.body.meta.total).toBe(1);
    });
  });

  describe('addresses and contacts', () => {
    it('adds, updates and removes addresses', async () => {
      const c = await createClient('Alpha');
      let res = await as(admin).post(`/api/v1/clients/${c.id}/addresses`, ADDRESS).expect(201);
      const addressId = res.body.data.addresses[0].id;
      res = await as(admin)
        .patch(`/api/v1/clients/${c.id}/addresses/${addressId}`, { city: 'Antwerp' })
        .expect(200);
      expect(res.body.data.addresses[0]).toMatchObject({ city: 'Antwerp', type: 'REGISTERED' });
      res = await as(admin).delete(`/api/v1/clients/${c.id}/addresses/${addressId}`).expect(200);
      expect(res.body.data.addresses).toEqual([]);
    });

    it('keeps exactly one primary contact', async () => {
      const c = await createClient('Alpha');
      await as(admin)
        .post(`/api/v1/clients/${c.id}/contacts`, { name: 'Ann', isPrimary: true })
        .expect(201);
      const res = await as(admin)
        .post(`/api/v1/clients/${c.id}/contacts`, { name: 'Ben', isPrimary: true })
        .expect(201);
      const primaries = (res.body.data as ClientDto).contacts
        .filter((x) => x.isPrimary)
        .map((x) => x.name);
      expect(primaries).toEqual(['Ben']);

      const list = await as(admin).get('/api/v1/clients');
      expect(list.body.data[0].primaryContact).toMatchObject({ name: 'Ben' });
    });

    it('refuses a sub-record of another client', async () => {
      const a = await createClient('Alpha');
      const b = await createClient('Beta');
      const res = await as(admin).post(`/api/v1/clients/${a.id}/addresses`, ADDRESS);
      const addressId = res.body.data.addresses[0].id;
      await as(admin).delete(`/api/v1/clients/${b.id}/addresses/${addressId}`).expect(404);
    });
  });

  describe('billing parties', () => {
    it('adds parties (grid), keeps one default, and never makes an inactive party default', async () => {
      const c = await createClient('Alpha');
      await as(admin)
        .post(`/api/v1/clients/${c.id}/billing-parties`, { name: 'Alpha Finance', isDefault: true })
        .expect(201);
      const res = await as(admin)
        .post(`/api/v1/clients/${c.id}/billing-parties`, {
          name: 'Alpha Owner Co',
          isDefault: true,
          country: 'Greece',
        })
        .expect(201);
      expect(
        res.body.data.billingParties.map((p: { name: string; isDefault: boolean }) => [
          p.name,
          p.isDefault,
        ]),
      ).toEqual([
        ['Alpha Owner Co', true],
        ['Alpha Finance', false],
      ]);

      const grid = await as(admin).get(`/api/v1/clients/${c.id}/billing-parties`).expect(200);
      expect(grid.body.data).toHaveLength(2);
      const ownerId = grid.body.data[0].id;

      const deactivated = await as(admin)
        .patch(`/api/v1/clients/${c.id}/billing-parties/${ownerId}`, { isActive: false })
        .expect(200);
      expect(
        deactivated.body.data.billingParties.find((p: { id: string }) => p.id === ownerId),
      ).toMatchObject({
        isActive: false,
        isDefault: false,
      });
      await as(admin)
        .patch(`/api/v1/clients/${c.id}/billing-parties/${ownerId}`, { isDefault: true })
        .expect(400);
    });
  });

  describe('isolation', () => {
    it('another tenant cannot see or change the clients', async () => {
      const c = await createClient('Alpha Secret');
      const other = await createTenant(prisma, { slug: 'other', modules: ['clients'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');

      expect((await as(otherAdmin).get('/api/v1/clients')).body.data).toEqual([]);
      await as(otherAdmin).get(`/api/v1/clients/${c.id}`).expect(404);
      await as(otherAdmin).patch(`/api/v1/clients/${c.id}`, { name: 'Hijacked' }).expect(404);
      await as(otherAdmin).post(`/api/v1/clients/${c.id}/contacts`, { name: 'Spy' }).expect(404);
    });

    it('the database rejects attaching a record to another tenant’s client', async () => {
      const c = await createClient('Alpha');
      const other = await createTenant(prisma, { slug: 'other', modules: ['clients'] });
      await expect(
        app
          .get(TenantDb)
          .run(other.id, (tx) =>
            tx.clientContact.create({ data: { tenantId: other.id, clientId: c.id, name: 'Spy' } }),
          ),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });

  describe('audit', () => {
    it('records the client and its sub-records on the client’s history', async () => {
      const c = await createClient('Alpha');
      await as(admin).patch(`/api/v1/clients/${c.id}`, { phone: '+31 10 000' }).expect(200);
      await as(admin).post(`/api/v1/clients/${c.id}/contacts`, { name: 'Ann' }).expect(201);
      await as(admin)
        .post(`/api/v1/clients/${c.id}/billing-parties`, { name: 'Alpha Finance' })
        .expect(201);
      await as(admin).patch(`/api/v1/clients/${c.id}`, { status: 'INACTIVE' }).expect(200);

      const log = await as(admin).get(`/api/v1/audit-logs?entityId=${c.id}`).expect(200);
      expect(log.body.data.map((e: { action: string }) => e.action).reverse()).toEqual([
        'client.created',
        'client.updated',
        'client.contact_added',
        'client.billing_party_added',
        'client.deactivated',
      ]);
      expect(log.body.data.at(-1)).toMatchObject({
        entity: { type: 'client', label: 'CL-00001 Alpha' },
        changes: { code: { from: null, to: 'CL-00001' }, name: { from: null, to: 'Alpha' } },
      });
    });
  });
});
