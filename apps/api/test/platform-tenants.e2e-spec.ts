import { Controller, Get, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { RequireModule } from '../src/modules/auth/decorators';
import { createE2eApp, createTenant, createUser, loginCookie, resetDatabase } from './e2e-app';

/** Stand-in for a future Finance endpoint, to exercise @RequireModule. */
@Controller('__test/finance')
@RequireModule('finance')
class FinanceProbeController {
  @Get()
  probe(): string {
    return 'finance-ok';
  }
}

const NEW_TENANT = {
  name: 'Oceanic Testing Ltd',
  slug: 'Oceanic-Testing',
  modules: ['samples', 'reports', 'samples'],
  admin: { email: 'Owner@Oceanic.test', name: 'Olivia Owner', password: 'oceanic-admin-1' },
};

describe('Platform tenant management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let platformCookie: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp({ controllers: [FinanceProbeController] }));
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, { email: 'operator@flux.test', isPlatformAdmin: true });
    platformCookie = await loginCookie(app, 'operator@flux.test');
  });

  afterAll(async () => {
    await app.close();
  });

  const createTenantViaApi = () =>
    api().post('/api/v1/platform/tenants').set('Cookie', platformCookie).send(NEW_TENANT);

  describe('access control', () => {
    it('is limited to platform admins', async () => {
      const t = await createTenant(prisma, { slug: 'acme' });
      await createUser(prisma, {
        email: 'admin@acme.test',
        tenantId: t.id,
        roleIds: [t.adminRoleId],
      });
      const tenantAdmin = await loginCookie(app, 'admin@acme.test');

      await api().get('/api/v1/platform/tenants').expect(401);
      await api().get('/api/v1/platform/tenants').set('Cookie', tenantAdmin).expect(403);
      await api()
        .post('/api/v1/platform/tenants')
        .set('Cookie', tenantAdmin)
        .send(NEW_TENANT)
        .expect(403);
    });
  });

  describe('POST /platform/tenants', () => {
    it('creates the tenant, its modules and its first admin, who can then sign in', async () => {
      const res = await createTenantViaApi().expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Oceanic Testing Ltd',
        slug: 'oceanic-testing',
        status: 'ACTIVE',
        modules: ['samples', 'reports'],
      });

      const cookie = await loginCookie(app, 'owner@oceanic.test', 'oceanic-admin-1');
      const me = await api().get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.data).toMatchObject({
        user: { isPlatformAdmin: false, roles: [{ name: 'Administrator' }] },
        tenant: { slug: 'oceanic-testing' },
        modules: ['administration', 'samples', 'reports'],
        access: {
          defaultPortal: 'ADMIN',
          portals: ['ADMIN', 'LAB'],
          modules: ['administration', 'samples', 'reports'],
        },
      });
    });

    it('rejects a duplicate slug', async () => {
      await createTenantViaApi().expect(201);
      const res = await api()
        .post('/api/v1/platform/tenants')
        .set('Cookie', platformCookie)
        .send({ ...NEW_TENANT, admin: { ...NEW_TENANT.admin, email: 'other@oceanic.test' } })
        .expect(409);
      expect(res.body.error.details.fields[0].path).toBe('slug');
    });

    it('is atomic: a taken admin email creates nothing', async () => {
      const res = await api()
        .post('/api/v1/platform/tenants')
        .set('Cookie', platformCookie)
        .send({ ...NEW_TENANT, admin: { ...NEW_TENANT.admin, email: 'operator@flux.test' } })
        .expect(409);
      expect(res.body.error.details.fields[0].path).toBe('admin.email');
      expect(await prisma.tenant.count()).toBe(0);
    });

    it('validates slug format and module keys', async () => {
      const res = await api()
        .post('/api/v1/platform/tenants')
        .set('Cookie', platformCookie)
        .send({ ...NEW_TENANT, slug: 'Bad Slug!', modules: ['administration', 'not-a-module'] })
        .expect(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['slug', 'modules.0', 'modules.1']));
    });
  });

  describe('listing and reading', () => {
    it('lists, searches and reads tenants', async () => {
      await createTenant(prisma, { slug: 'acme', name: 'Acme Labs' });
      const created = (await createTenantViaApi()).body.data;

      const all = await api().get('/api/v1/platform/tenants').set('Cookie', platformCookie);
      expect(all.body.meta.total).toBe(2);

      const search = await api()
        .get('/api/v1/platform/tenants?q=ocean')
        .set('Cookie', platformCookie);
      expect(search.body.data.map((t: { slug: string }) => t.slug)).toEqual(['oceanic-testing']);

      const one = await api()
        .get(`/api/v1/platform/tenants/${created.id}`)
        .set('Cookie', platformCookie)
        .expect(200);
      expect(one.body.data.slug).toBe('oceanic-testing');
    });

    it('exposes the module catalogue', async () => {
      const res = await api()
        .get('/api/v1/platform/modules')
        .set('Cookie', platformCookie)
        .expect(200);
      expect(res.body.data).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'administration', core: true })]),
      );
    });
  });

  describe('suspension', () => {
    it('signs out the tenant’s users and blocks sign-in until reactivated', async () => {
      const tenant = (await createTenantViaApi()).body.data;
      const userCookie = await loginCookie(app, 'owner@oceanic.test', 'oceanic-admin-1');

      await api()
        .patch(`/api/v1/platform/tenants/${tenant.id}`)
        .set('Cookie', platformCookie)
        .send({ status: 'SUSPENDED' })
        .expect(200);
      await api().get('/api/v1/auth/me').set('Cookie', userCookie).expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'owner@oceanic.test', password: 'oceanic-admin-1' })
        .expect(403);

      await api()
        .patch(`/api/v1/platform/tenants/${tenant.id}`)
        .set('Cookie', platformCookie)
        .send({ status: 'ACTIVE' })
        .expect(200);
      await loginCookie(app, 'owner@oceanic.test', 'oceanic-admin-1');
    });
  });

  describe('module licensing (@RequireModule)', () => {
    it('blocks unlicensed modules and allows them as soon as they are licensed', async () => {
      const tenant = (await createTenantViaApi()).body.data;
      const userCookie = await loginCookie(app, 'owner@oceanic.test', 'oceanic-admin-1');

      const blocked = await api()
        .get('/api/v1/__test/finance')
        .set('Cookie', userCookie)
        .expect(403);
      expect(blocked.body.error).toMatchObject({
        code: 'MODULE_NOT_ENABLED',
        message: 'Your organisation does not have the Finance module',
      });

      const updated = await api()
        .put(`/api/v1/platform/tenants/${tenant.id}/modules`)
        .set('Cookie', platformCookie)
        .send({ modules: ['samples', 'finance'] })
        .expect(200);
      expect(updated.body.data.modules).toEqual(['samples', 'finance']);

      // Same session; licensing is checked on every request.
      await api().get('/api/v1/__test/finance').set('Cookie', userCookie).expect(200);
    });

    it('returns 404 when setting modules on an unknown tenant', async () => {
      await api()
        .put('/api/v1/platform/tenants/00000000-0000-4000-8000-000000000000/modules')
        .set('Cookie', platformCookie)
        .send({ modules: [] })
        .expect(404);
    });
  });
});
