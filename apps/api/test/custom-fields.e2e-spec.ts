import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ClientDto, CustomFieldDefinitionDto } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import {
  createE2eApp,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Custom fields (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => api().post(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
  });
  const define = async (body: object, cookie = admin): Promise<CustomFieldDefinitionDto> =>
    (
      await as(cookie)
        .post('/api/v1/custom-fields', { entity: 'client', ...body })
        .expect(201)
    ).body.data;

  /** A typical set: region (required text), fleet size (number), tier (dropdown), vip (yes/no). */
  async function standardFields() {
    return {
      region: await define({ label: 'Region', type: 'TEXT', required: true, sortOrder: 1 }),
      fleet: await define({ label: 'Fleet size', type: 'NUMBER', sortOrder: 2 }),
      tier: await define({
        label: 'Service tier',
        type: 'SELECT',
        options: [
          { value: 'gold', label: 'Gold' },
          { value: 'silver', label: 'Silver' },
        ],
        sortOrder: 3,
      }),
      vip: await define({ label: 'VIP', type: 'BOOLEAN', sortOrder: 4 }),
    };
  }

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

  describe('definitions', () => {
    it('creates fields with keys derived from labels, listed in order', async () => {
      await standardFields();
      const res = await as(admin).get('/api/v1/custom-fields?entity=client').expect(200);
      expect(res.body.data.map((f: CustomFieldDefinitionDto) => [f.key, f.type])).toEqual([
        ['region', 'TEXT'],
        ['fleet_size', 'NUMBER'],
        ['service_tier', 'SELECT'],
        ['vip', 'BOOLEAN'],
      ]);
    });

    it('rejects a duplicate key and invalid dropdown definitions', async () => {
      await define({ label: 'Region', type: 'TEXT' });
      const dup = await as(admin)
        .post('/api/v1/custom-fields', { entity: 'client', label: 'region', type: 'TEXT' })
        .expect(409);
      expect(dup.body.error.details.fields[0].message).toMatch(/already used/);
      await as(admin)
        .post('/api/v1/custom-fields', { entity: 'client', label: 'Tier', type: 'SELECT' })
        .expect(400);
      await as(admin)
        .post('/api/v1/custom-fields', {
          entity: 'client',
          label: 'Note',
          type: 'TEXT',
          options: [{ value: 'a', label: 'A' }],
        })
        .expect(400);
    });

    it('never changes key or type; label, options and required can change', async () => {
      const { tier } = await standardFields();
      const res = await as(admin)
        .patch(`/api/v1/custom-fields/${tier.id}`, {
          label: 'Tier',
          type: 'TEXT',
          key: 'hacked',
          options: [...tier.options, { value: 'bronze', label: 'Bronze' }],
        })
        .expect(200);
      expect(res.body.data).toMatchObject({ key: 'service_tier', type: 'SELECT', label: 'Tier' });
      expect(res.body.data.options).toHaveLength(3);
    });

    it('needs custom-field.manage to change, but any tenant user can read', async () => {
      await standardFields();
      const role = await createRole(prisma, {
        tenantId,
        name: 'Clerk',
        modules: ['clients'],
        permissions: ['client.view'],
      });
      await createUser(prisma, { email: 'c@acme.test', tenantId, roleIds: [role.id] });
      const clerk = await loginCookie(app, 'c@acme.test');
      expect(
        (await as(clerk).get('/api/v1/custom-fields?entity=client').expect(200)).body.data,
      ).toHaveLength(4);
      await as(clerk)
        .post('/api/v1/custom-fields', { entity: 'client', label: 'X', type: 'TEXT' })
        .expect(403);
    });

    it('is unavailable when the record type’s module is not licensed', async () => {
      const other = await createTenant(prisma, { slug: 'nomod' });
      await createUser(prisma, {
        email: 'a@nomod.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const cookie = await loginCookie(app, 'a@nomod.test');
      expect((await as(cookie).get('/api/v1/custom-fields/entities')).body.data).toEqual([]);
      await as(cookie).get('/api/v1/custom-fields?entity=client').expect(403);
    });
  });

  describe('values on clients', () => {
    it('stores validated values and enforces required fields on create', async () => {
      await standardFields();
      const missing = await as(admin).post('/api/v1/clients', { name: 'Alpha' }).expect(400);
      expect(missing.body.error.details).toEqual([
        { path: 'customFields.region', message: 'Region is required' },
      ]);

      const res = await as(admin)
        .post('/api/v1/clients', {
          name: 'Alpha',
          customFields: { region: 'Europe', fleet_size: '14', service_tier: 'gold', vip: true },
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        code: 'CL-00001',
        customFields: { region: 'Europe', fleet_size: 14, service_tier: 'gold', vip: true },
      });
    });

    it('reports every invalid value with its field path and takes no client number', async () => {
      await standardFields();
      const res = await as(admin)
        .post('/api/v1/clients', {
          name: 'Alpha',
          customFields: {
            region: 'EU',
            fleet_size: 'lots',
            service_tier: 'platinum',
            vip: 'yes',
            other: 1,
          },
        })
        .expect(400);
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'customFields.fleet_size',
        'customFields.other',
        'customFields.service_tier',
        'customFields.vip',
      ]);
      const ok = await as(admin)
        .post('/api/v1/clients', { name: 'Beta', customFields: { region: 'EU' } })
        .expect(201);
      expect(ok.body.data.code).toBe('CL-00001');
    });

    it('merges updates, clears optional values, but never clears a required one', async () => {
      await standardFields();
      const created: ClientDto = (
        await as(admin).post('/api/v1/clients', {
          name: 'Alpha',
          customFields: { region: 'EU', fleet_size: 3 },
        })
      ).body.data;

      let res = await as(admin)
        .patch(`/api/v1/clients/${created.id}`, { customFields: { vip: true } })
        .expect(200);
      expect(res.body.data.customFields).toEqual({ region: 'EU', fleet_size: 3, vip: true });

      res = await as(admin)
        .patch(`/api/v1/clients/${created.id}`, { customFields: { fleet_size: '' } })
        .expect(200);
      expect(res.body.data.customFields).toEqual({ region: 'EU', vip: true });

      await as(admin)
        .patch(`/api/v1/clients/${created.id}`, { customFields: { region: '' } })
        .expect(400);
      // Updates that don't touch custom fields don't re-check required ones.
      await as(admin).patch(`/api/v1/clients/${created.id}`, { phone: '123' }).expect(200);
    });

    it('rejects values for deactivated fields but keeps the stored ones', async () => {
      const { fleet } = await standardFields();
      const created: ClientDto = (
        await as(admin).post('/api/v1/clients', {
          name: 'Alpha',
          customFields: { region: 'EU', fleet_size: 3 },
        })
      ).body.data;
      await as(admin).patch(`/api/v1/custom-fields/${fleet.id}`, { isActive: false }).expect(200);

      const active = await as(admin).get('/api/v1/custom-fields?entity=client');
      expect(active.body.data.map((f: CustomFieldDefinitionDto) => f.key)).not.toContain(
        'fleet_size',
      );
      const all = await as(admin).get('/api/v1/custom-fields?entity=client&view=all');
      expect(all.body.data.map((f: CustomFieldDefinitionDto) => f.key)).toContain('fleet_size');

      await as(admin)
        .patch(`/api/v1/clients/${created.id}`, { customFields: { fleet_size: 4 } })
        .expect(400);
      const read = await as(admin).get(`/api/v1/clients/${created.id}`);
      expect(read.body.data.customFields.fleet_size).toBe(3);
    });

    it('audits value changes with field labels and option labels', async () => {
      await standardFields();
      const created: ClientDto = (
        await as(admin).post('/api/v1/clients', {
          name: 'Alpha',
          customFields: { region: 'EU', service_tier: 'silver' },
        })
      ).body.data;
      await as(admin)
        .patch(`/api/v1/clients/${created.id}`, { customFields: { service_tier: 'gold' } })
        .expect(200);

      const log = await as(admin).get(`/api/v1/audit-logs?entityId=${created.id}`);
      expect(log.body.data[0]).toMatchObject({
        action: 'client.updated',
        changes: { 'Service tier': { from: 'Silver', to: 'Gold' } },
      });
      expect(log.body.data[1].changes).toMatchObject({ Region: { from: null, to: 'EU' } });
    });
  });

  describe('isolation', () => {
    it('one tenant’s fields are unknown to another tenant', async () => {
      await standardFields();
      const other = await createTenant(prisma, { slug: 'other', modules: ['clients'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      expect((await as(otherAdmin).get('/api/v1/custom-fields?entity=client')).body.data).toEqual(
        [],
      );
      const res = await as(otherAdmin)
        .post('/api/v1/clients', { name: 'X', customFields: { region: 'EU' } })
        .expect(400);
      expect(res.body.error.details[0].message).toBe('Unknown custom field');
    });
  });
});
