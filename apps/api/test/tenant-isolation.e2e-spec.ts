import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import { createE2eApp, createTenant, createUser, loginCookie, resetDatabase } from './e2e-app';

/**
 * The core SaaS guarantee: one tenant can never read or change another tenant's data.
 * Checked through the API and directly against Postgres row-level security.
 */
describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantDb: TenantDb;
  let tenantA: string;
  let tenantB: string;
  let bobId: string;
  let adminACookie: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
    tenantDb = app.get(TenantDb);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    tenantA = (await createTenant(prisma, { slug: 'tenant-a' })).id;
    tenantB = (await createTenant(prisma, { slug: 'tenant-b' })).id;
    await createUser(prisma, { email: 'admin@a.test', tenantId: tenantA, isTenantAdmin: true });
    await createUser(prisma, { email: 'alice@a.test', tenantId: tenantA });
    await createUser(prisma, { email: 'admin@b.test', tenantId: tenantB, isTenantAdmin: true });
    bobId = (await createUser(prisma, { email: 'bob@b.test', tenantId: tenantB })).id;
    adminACookie = await loginCookie(app, 'admin@a.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('through the API', () => {
    it('lists only users of the caller’s tenant', async () => {
      const res = await api().get('/api/v1/users').set('Cookie', adminACookie).expect(200);
      expect(res.body.data.map((u: { email: string }) => u.email).sort()).toEqual([
        'admin@a.test',
        'alice@a.test',
      ]);
      expect(res.body.meta.total).toBe(2);
    });

    it('cannot search its way into another tenant', async () => {
      const res = await api().get('/api/v1/users?q=b.test').set('Cookie', adminACookie).expect(200);
      expect(res.body.data).toEqual([]);
    });

    it('treats another tenant’s user as not found for read, update and password reset', async () => {
      await api().get(`/api/v1/users/${bobId}`).set('Cookie', adminACookie).expect(404);
      await api()
        .patch(`/api/v1/users/${bobId}`)
        .set('Cookie', adminACookie)
        .send({ status: 'DISABLED' })
        .expect(404);
      await api()
        .post(`/api/v1/users/${bobId}/reset-password`)
        .set('Cookie', adminACookie)
        .send({ password: 'hijacked-pass-1' })
        .expect(404);

      const bob = await prisma.user.findUniqueOrThrow({ where: { id: bobId } });
      expect(bob.status).toBe('ACTIVE');
      await loginCookie(app, 'bob@b.test');
    });
  });

  describe('in Postgres (row-level security)', () => {
    it('hides other tenants’ rows even with no where clause', async () => {
      const emails = await tenantDb.run(tenantA, async (tx) =>
        (await tx.user.findMany()).map((u) => u.email).sort(),
      );
      expect(emails).toEqual(['admin@a.test', 'alice@a.test']);
    });

    it('hides other tenants’ rows even when asked for them by id', async () => {
      const bob = await tenantDb.run(tenantA, (tx) => tx.user.findUnique({ where: { id: bobId } }));
      expect(bob).toBeNull();
    });

    it('rejects writing a row into another tenant', async () => {
      await expect(
        tenantDb.run(tenantA, (tx) =>
          tx.user.create({
            data: {
              tenantId: tenantB,
              email: 'planted@b.test',
              name: 'Planted',
              passwordHash: 'x',
            },
          }),
        ),
      ).rejects.toThrow(/row-level security/i);
      expect(await prisma.user.count({ where: { email: 'planted@b.test' } })).toBe(0);
    });

    it('cannot move a row into another tenant', async () => {
      await expect(
        tenantDb.run(tenantA, (tx) =>
          tx.user.updateMany({ where: { email: 'alice@a.test' }, data: { tenantId: tenantB } }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('sees nothing at all when no tenant is set (deny by default)', async () => {
      const count = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE flux_app');
        return tx.user.count();
      });
      expect(count).toBe(0);
    });

    it('only sees its own tenant record and cannot change licensing', async () => {
      const tenants = await tenantDb.run(tenantA, (tx) => tx.tenant.findMany());
      expect(tenants.map((t) => t.id)).toEqual([tenantA]);

      await expect(
        tenantDb.run(tenantA, (tx) =>
          tx.tenantModule.create({ data: { tenantId: tenantA, moduleKey: 'finance' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(
        tenantDb.run(tenantA, (tx) =>
          tx.tenant.update({ where: { id: tenantA }, data: { status: 'ACTIVE' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('cannot delete users', async () => {
      await expect(
        tenantDb.run(tenantA, (tx) => tx.user.deleteMany({ where: { email: 'alice@a.test' } })),
      ).rejects.toThrow(/permission denied/i);
    });
  });
});
