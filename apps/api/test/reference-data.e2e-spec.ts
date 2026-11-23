import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ReferenceItemDto } from '@flux/shared';
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

const LIST = '/api/v1/reference-data/vessel-type';

describe('Reference data (e2e, hybrid)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let bulkId: string;
  let tankerId: string;

  const api = () => request(app.getHttpServer());
  const names = (items: ReferenceItemDto[]) => items.map((i) => i.name);

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // Sort orders like the real seed (10, 20, 30, …).
    bulkId = (
      await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'BULK',
        name: 'Bulk Carrier',
        sortOrder: 10,
      })
    ).id;
    tankerId = (
      await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'TANKER',
        name: 'Oil Tanker',
        sortOrder: 20,
      })
    ).id;
    await createReferenceItem(prisma, {
      list: 'vessel-type',
      code: 'OLD',
      name: 'Retired Type',
      isActive: false,
      sortOrder: 30,
    });
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['vessels'] });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('reading', () => {
    it('lists only the lists of licensed modules', async () => {
      const res = await api().get('/api/v1/reference-data').set('Cookie', admin).expect(200);
      expect(res.body.data.map((l: { key: string }) => l.key)).toEqual([
        'vessel-type',
        'classification-society',
        'vessel-relationship-type',
      ]);

      const other = await createTenant(prisma, { slug: 'no-vessels' });
      await createUser(prisma, {
        email: 'a@nv.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const cookie = await loginCookie(app, 'a@nv.test');
      expect((await api().get('/api/v1/reference-data').set('Cookie', cookie)).body.data).toEqual(
        [],
      );
      const blocked = await api().get(LIST).set('Cookie', cookie).expect(403);
      expect(blocked.body.error.code).toBe('MODULE_NOT_ENABLED');
    });

    it('any tenant user can read; dropdown view excludes inactive and hidden items', async () => {
      await createUser(prisma, { email: 'plain@acme.test', tenantId });
      const plain = await loginCookie(app, 'plain@acme.test');
      const usable = await api().get(LIST).set('Cookie', plain).expect(200);
      expect(names(usable.body.data)).toEqual(['Bulk Carrier', 'Oil Tanker']);
      expect(usable.body.data[0]).toMatchObject({ source: 'PLATFORM', hidden: false });

      const all = await api().get(`${LIST}?view=all`).set('Cookie', plain).expect(200);
      expect(names(all.body.data)).toEqual(['Bulk Carrier', 'Oil Tanker', 'Retired Type']);
    });

    it('rejects unknown lists', async () => {
      await api().get('/api/v1/reference-data/not-a-list').set('Cookie', admin).expect(400);
    });
  });

  describe('tenant items', () => {
    it('adds own items next to the FLUX defaults', async () => {
      const res = await api()
        .post(LIST)
        .set('Cookie', admin)
        .send({ code: 'research', name: 'Research Vessel', sortOrder: 5 })
        .expect(201);
      expect(res.body.data).toMatchObject({ code: 'RESEARCH', source: 'TENANT', hidden: false });

      const list = await api().get(LIST).set('Cookie', admin);
      expect(names(list.body.data)).toEqual(['Research Vessel', 'Bulk Carrier', 'Oil Tanker']);
    });

    it('cannot reuse a FLUX default’s code or its own codes (case-insensitive)', async () => {
      const clash = await api()
        .post(LIST)
        .set('Cookie', admin)
        .send({ code: 'bulk', name: 'Mine' })
        .expect(409);
      expect(clash.body.error.message).toMatch(/FLUX default already uses this code/);
      await api().post(LIST).set('Cookie', admin).send({ code: 'MINE', name: 'Mine' }).expect(201);
      await api()
        .post(LIST)
        .set('Cookie', admin)
        .send({ code: 'mine', name: 'Mine again' })
        .expect(409);
    });

    it('edits and deactivates own items', async () => {
      const item = (
        await api().post(LIST).set('Cookie', admin).send({ code: 'R', name: 'Research' })
      ).body.data;
      await api()
        .patch(`${LIST}/${item.id}`)
        .set('Cookie', admin)
        .send({ name: 'Research Vessel' })
        .expect(200);
      await api()
        .patch(`${LIST}/${item.id}`)
        .set('Cookie', admin)
        .send({ isActive: false })
        .expect(200);
      expect(names((await api().get(LIST).set('Cookie', admin)).body.data)).not.toContain(
        'Research Vessel',
      );
    });

    it('requires reference-data.manage to change anything', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['administration'],
        permissions: ['user.view'],
      });
      await createUser(prisma, { email: 'v@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'v@acme.test');
      await api().post(LIST).set('Cookie', viewer).send({ code: 'X', name: 'X' }).expect(403);
      await api()
        .put(`${LIST}/${bulkId}/visibility`)
        .set('Cookie', viewer)
        .send({ hidden: true })
        .expect(403);
    });
  });

  describe('FLUX defaults seen by a tenant', () => {
    it('cannot be edited by a tenant, but can be hidden and shown again', async () => {
      const edit = await api()
        .patch(`${LIST}/${bulkId}`)
        .set('Cookie', admin)
        .send({ name: 'Mine now' })
        .expect(403);
      expect(edit.body.error.message).toMatch(/cannot be changed/);

      await api()
        .put(`${LIST}/${bulkId}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: true })
        .expect(200);
      expect(names((await api().get(LIST).set('Cookie', admin)).body.data)).toEqual(['Oil Tanker']);
      const all = (await api().get(`${LIST}?view=all`).set('Cookie', admin)).body
        .data as ReferenceItemDto[];
      expect(all.find((i) => i.id === bulkId)).toMatchObject({ hidden: true });

      await api()
        .put(`${LIST}/${bulkId}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: false })
        .expect(200);
      expect(names((await api().get(LIST).set('Cookie', admin)).body.data)).toEqual([
        'Bulk Carrier',
        'Oil Tanker',
      ]);
    });

    it('hiding is per tenant', async () => {
      await api()
        .put(`${LIST}/${tankerId}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: true })
        .expect(200);
      const other = await createTenant(prisma, { slug: 'other', modules: ['vessels'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      expect(names((await api().get(LIST).set('Cookie', otherAdmin)).body.data)).toEqual([
        'Bulk Carrier',
        'Oil Tanker',
      ]);
    });

    it('own items cannot be hidden (they are deactivated instead)', async () => {
      const item = (
        await api().post(LIST).set('Cookie', admin).send({ code: 'R', name: 'Research' })
      ).body.data;
      await api()
        .put(`${LIST}/${item.id}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: true })
        .expect(400);
    });
  });

  describe('isolation, enforced by Postgres', () => {
    it('tenants never see each other’s items', async () => {
      await api()
        .post(LIST)
        .set('Cookie', admin)
        .send({ code: 'SECRET', name: 'Acme Secret Type' })
        .expect(201);
      const other = await createTenant(prisma, { slug: 'other', modules: ['vessels'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      const res = await api().get(`${LIST}?view=all`).set('Cookie', otherAdmin);
      expect(names(res.body.data)).not.toContain('Acme Secret Type');
    });

    it('a tenant can read FLUX defaults but cannot write them, even directly', async () => {
      const tenantDb = app.get(TenantDb);
      const defaults = await tenantDb.run(tenantId, (tx) =>
        tx.referenceItem.findMany({ where: { tenantId: null } }),
      );
      expect(defaults.length).toBe(3);

      const updated = await tenantDb.run(tenantId, (tx) =>
        tx.referenceItem.updateMany({ where: { id: bulkId }, data: { name: 'Hijacked' } }),
      );
      expect(updated.count).toBe(0);
      await expect(
        tenantDb.run(tenantId, (tx) =>
          tx.referenceItem.create({
            data: { tenantId: null, listKey: 'vessel-type', code: 'FAKE', name: 'Fake default' },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      expect((await prisma.referenceItem.findUniqueOrThrow({ where: { id: bulkId } })).name).toBe(
        'Bulk Carrier',
      );
    });

    it('the database refuses to hide a tenant item', async () => {
      const item = await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'OWN',
        name: 'Own',
        tenantId,
      });
      await expect(
        app
          .get(TenantDb)
          .run(tenantId, (tx) =>
            tx.referenceItemHidden.create({ data: { tenantId, itemId: item.id } }),
          ),
      ).rejects.toThrow(/Only FLUX default reference items can be hidden/);
    });
  });

  describe('platform management of FLUX defaults', () => {
    let operator: string;

    beforeEach(async () => {
      await createUser(prisma, {
        email: 'operator@flux.test',
        name: 'Olivia Operator',
        isPlatformAdmin: true,
      });
      operator = await loginCookie(app, 'operator@flux.test');
    });

    it('adds and edits defaults, which every tenant then sees', async () => {
      const created = await api()
        .post('/api/v1/platform/reference-data/vessel-type')
        .set('Cookie', operator)
        .send({ code: 'LNG', name: 'LNG Carrier', sortOrder: 1 })
        .expect(201);
      expect(created.body.data.source).toBe('PLATFORM');
      await api()
        .patch(`/api/v1/platform/reference-data/vessel-type/${bulkId}`)
        .set('Cookie', operator)
        .send({ name: 'Bulk Carrier (Dry)' })
        .expect(200);

      expect(names((await api().get(LIST).set('Cookie', admin)).body.data)).toEqual([
        'LNG Carrier',
        'Bulk Carrier (Dry)',
        'Oil Tanker',
      ]);
    });

    it('lists only defaults, never tenant items', async () => {
      await createReferenceItem(prisma, {
        list: 'vessel-type',
        code: 'OWN',
        name: 'Acme Own',
        tenantId,
      });
      const res = await api()
        .get('/api/v1/platform/reference-data/vessel-type')
        .set('Cookie', operator)
        .expect(200);
      expect(names(res.body.data)).not.toContain('Acme Own');
    });

    it('is platform-admin only', async () => {
      await api()
        .post('/api/v1/platform/reference-data/vessel-type')
        .set('Cookie', admin)
        .send({ code: 'X', name: 'X' })
        .expect(403);
      await api().get('/api/v1/platform/audit-logs').set('Cookie', admin).expect(403);
    });
  });

  describe('audit', () => {
    it('records tenant changes in the tenant log and platform changes in the platform log', async () => {
      await api().post(LIST).set('Cookie', admin).send({ code: 'R', name: 'Research' }).expect(201);
      await api()
        .put(`${LIST}/${bulkId}/visibility`)
        .set('Cookie', admin)
        .send({ hidden: true })
        .expect(200);

      await createUser(prisma, {
        email: 'operator@flux.test',
        name: 'Olivia Operator',
        isPlatformAdmin: true,
      });
      const operator = await loginCookie(app, 'operator@flux.test');
      await api()
        .patch(`/api/v1/platform/reference-data/vessel-type/${tankerId}`)
        .set('Cookie', operator)
        .send({ isActive: false })
        .expect(200);

      const tenantLog = await api().get('/api/v1/audit-logs').set('Cookie', admin).expect(200);
      expect(tenantLog.body.data.map((e: { action: string }) => e.action)).toEqual([
        'reference.hidden',
        'reference.created',
      ]);

      const platformLog = await api()
        .get('/api/v1/platform/audit-logs')
        .set('Cookie', operator)
        .expect(200);
      expect(platformLog.body.data).toHaveLength(1);
      expect(platformLog.body.data[0]).toMatchObject({
        action: 'reference.deactivated',
        actor: { name: 'Olivia Operator' },
        changes: { isActive: { from: true, to: false } },
      });
    });
  });
});
