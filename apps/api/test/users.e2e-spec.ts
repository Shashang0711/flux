import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PASSWORD_MIN_LENGTH } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import {
  TEST_PASSWORD,
  createE2eApp,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Users (e2e, tenant-scoped)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let adminCookie: string;
  let adminId: string;

  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    tenantId = (await createTenant(prisma, { slug: 'acme-labs' })).id;
    adminId = (
      await createUser(prisma, { email: 'admin@acme.test', tenantId, isTenantAdmin: true })
    ).id;
    adminCookie = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access control', () => {
    it('requires a session', async () => {
      await api().get('/api/v1/users').expect(401);
    });

    it('forbids users who are not tenant admins', async () => {
      await createUser(prisma, { email: 'lab@acme.test', tenantId });
      const cookie = await loginCookie(app, 'lab@acme.test');
      const res = await api().get('/api/v1/users').set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('forbids platform admins (they belong to no tenant)', async () => {
      await createUser(prisma, { email: 'operator@flux.test', isPlatformAdmin: true });
      const cookie = await loginCookie(app, 'operator@flux.test');
      await api().get('/api/v1/users').set('Cookie', cookie).expect(403);
    });
  });

  describe('POST /users', () => {
    it('creates a user in the admin’s tenant; the password is never returned', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'New.Analyst@Acme.test', name: 'New Analyst', password: 'analyst-pass-123' })
        .expect(201);
      expect(res.body.data).toMatchObject({
        email: 'new.analyst@acme.test',
        status: 'ACTIVE',
        isTenantAdmin: false,
        isPlatformAdmin: false,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored.tenantId).toBe(tenantId);
      await loginCookie(app, 'new.analyst@acme.test', 'analyst-pass-123');
    });

    it('ignores attempts to set tenant or platform-admin fields', async () => {
      const other = await createTenant(prisma, { slug: 'other-co' });
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({
          email: 'sneaky@acme.test',
          name: 'Sneaky',
          password: 'sneaky-pass-123',
          tenantId: other.id,
          isPlatformAdmin: true,
        })
        .expect(201);
      const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(stored).toMatchObject({ tenantId, isPlatformAdmin: false });
    });

    it('rejects a duplicate email (case-insensitive) with 409', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'ADMIN@acme.test', name: 'Dup', password: 'duplicate-pass-1' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('enforces the password policy', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'weak@acme.test', name: 'Weak', password: 'short' })
        .expect(400);
      expect(res.body.error.details).toEqual([
        {
          path: 'password',
          message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
        },
      ]);
    });
  });

  describe('GET /users', () => {
    beforeEach(async () => {
      await createUser(prisma, { email: 'alice@acme.test', name: 'Alice Analyst', tenantId });
      await createUser(prisma, {
        email: 'bob@acme.test',
        name: 'Bob Biologist',
        status: 'DISABLED',
        tenantId,
      });
    });

    it('paginates', async () => {
      const res = await api()
        .get('/api/v1/users?page=1&pageSize=2')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
    });

    it('searches name and email, and filters by status', async () => {
      const byName = await api().get('/api/v1/users?q=analyst').set('Cookie', adminCookie);
      expect(byName.body.data.map((u: { email: string }) => u.email)).toEqual(['alice@acme.test']);

      const disabled = await api().get('/api/v1/users?status=DISABLED').set('Cookie', adminCookie);
      expect(disabled.body.data.map((u: { email: string }) => u.email)).toEqual(['bob@acme.test']);
    });

    it('returns 404 for an unknown id and 400 for a malformed one', async () => {
      await api()
        .get('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('Cookie', adminCookie)
        .expect(404);
      await api().get('/api/v1/users/not-a-uuid').set('Cookie', adminCookie).expect(400);
    });
  });

  describe('PATCH /users/:id', () => {
    it('disabling a user signs them out immediately', async () => {
      const user = await createUser(prisma, { email: 'lab@acme.test', tenantId });
      const userCookie = await loginCookie(app, 'lab@acme.test');

      await api()
        .patch(`/api/v1/users/${user.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'DISABLED' })
        .expect(200);

      await api().get('/api/v1/auth/me').set('Cookie', userCookie).expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'lab@acme.test', password: TEST_PASSWORD })
        .expect(401);
    });

    it('prevents admins from disabling themselves or dropping their own admin access', async () => {
      for (const body of [{ status: 'DISABLED' }, { isTenantAdmin: false }]) {
        await api()
          .patch(`/api/v1/users/${adminId}`)
          .set('Cookie', adminCookie)
          .send(body)
          .expect(400);
      }
    });

    it('rejects an empty update', async () => {
      await api().patch(`/api/v1/users/${adminId}`).set('Cookie', adminCookie).send({}).expect(400);
    });

    it('rejects changing email to one already in use', async () => {
      const user = await createUser(prisma, { email: 'lab@acme.test', tenantId });
      await api()
        .patch(`/api/v1/users/${user.id}`)
        .set('Cookie', adminCookie)
        .send({ email: 'admin@acme.test' })
        .expect(409);
    });

    it('returns 404 for an unknown user', async () => {
      await api()
        .patch('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('Cookie', adminCookie)
        .send({ name: 'Ghost' })
        .expect(404);
    });
  });

  describe('POST /users/:id/reset-password', () => {
    it('sets a new password and signs the user out everywhere', async () => {
      const user = await createUser(prisma, { email: 'lab@acme.test', tenantId });
      const userCookie = await loginCookie(app, 'lab@acme.test');

      await api()
        .post(`/api/v1/users/${user.id}/reset-password`)
        .set('Cookie', adminCookie)
        .send({ password: 'temporary-pass-42' })
        .expect(204);

      await api().get('/api/v1/auth/me').set('Cookie', userCookie).expect(401);
      await loginCookie(app, 'lab@acme.test', 'temporary-pass-42');
    });

    it('cannot be used on your own account', async () => {
      await api()
        .post(`/api/v1/users/${adminId}/reset-password`)
        .set('Cookie', adminCookie)
        .send({ password: 'temporary-pass-42' })
        .expect(400);
    });
  });
});
