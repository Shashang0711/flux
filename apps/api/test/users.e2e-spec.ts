import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { TEST_PASSWORD, createE2eApp, createUser, resetDatabase } from './e2e-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie: string;
  let adminId: string;

  const api = () => request(app.getHttpServer());

  async function loginCookie(email: string, password = TEST_PASSWORD): Promise<string> {
    const res = await api().post('/api/v1/auth/login').send({ email, password }).expect(200);
    return ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    adminId = (await createUser(prisma, { email: 'admin@flux.test', isSystemAdmin: true })).id;
    adminCookie = await loginCookie('admin@flux.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('access control', () => {
    it('requires a session', async () => {
      await api().get('/api/v1/users').expect(401);
    });

    it('forbids users who are not system admins', async () => {
      await createUser(prisma, { email: 'lab@flux.test' });
      const cookie = await loginCookie('lab@flux.test');
      const res = await api().get('/api/v1/users').set('Cookie', cookie).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /users', () => {
    it('creates a user who can then sign in; the password is never returned', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'New.Analyst@Flux.test', name: 'New Analyst', password: 'analyst-pass-123' })
        .expect(201);
      expect(res.body.data).toMatchObject({
        email: 'new.analyst@flux.test',
        status: 'ACTIVE',
        isSystemAdmin: false,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);
      await loginCookie('new.analyst@flux.test', 'analyst-pass-123');
    });

    it('rejects a duplicate email (case-insensitive) with 409', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'ADMIN@flux.test', name: 'Dup', password: 'duplicate-pass-1' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('enforces the password policy', async () => {
      const res = await api()
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'weak@flux.test', name: 'Weak', password: 'short' })
        .expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'password', message: 'Password must be at least 12 characters' },
      ]);
    });
  });

  describe('GET /users', () => {
    beforeEach(async () => {
      await createUser(prisma, { email: 'alice@flux.test', name: 'Alice Analyst' });
      await createUser(prisma, {
        email: 'bob@flux.test',
        name: 'Bob Biologist',
        status: 'DISABLED',
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
      expect(byName.body.data.map((u: { email: string }) => u.email)).toEqual(['alice@flux.test']);

      const disabled = await api().get('/api/v1/users?status=DISABLED').set('Cookie', adminCookie);
      expect(disabled.body.data.map((u: { email: string }) => u.email)).toEqual(['bob@flux.test']);
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
      const user = await createUser(prisma, { email: 'lab@flux.test' });
      const userCookie = await loginCookie('lab@flux.test');

      await api()
        .patch(`/api/v1/users/${user.id}`)
        .set('Cookie', adminCookie)
        .send({ status: 'DISABLED' })
        .expect(200);

      await api().get('/api/v1/auth/me').set('Cookie', userCookie).expect(401);
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'lab@flux.test', password: TEST_PASSWORD })
        .expect(401);
    });

    it('prevents admins from disabling themselves or dropping their own admin access', async () => {
      for (const body of [{ status: 'DISABLED' }, { isSystemAdmin: false }]) {
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
      const user = await createUser(prisma, { email: 'lab@flux.test' });
      await api()
        .patch(`/api/v1/users/${user.id}`)
        .set('Cookie', adminCookie)
        .send({ email: 'admin@flux.test' })
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
      const user = await createUser(prisma, { email: 'lab@flux.test' });
      const userCookie = await loginCookie('lab@flux.test');

      await api()
        .post(`/api/v1/users/${user.id}/reset-password`)
        .set('Cookie', adminCookie)
        .send({ password: 'temporary-pass-42' })
        .expect(204);

      await api().get('/api/v1/auth/me').set('Cookie', userCookie).expect(401);
      await loginCookie('lab@flux.test', 'temporary-pass-42');
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
