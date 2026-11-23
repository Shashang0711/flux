import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { TEST_PASSWORD, createE2eApp, createUser, resetDatabase } from './e2e-app';

function sessionCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.find((c) => c.startsWith('flux_session='));
  if (!cookie) throw new Error('No session cookie set');
  return cookie;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await createUser(prisma, { email: 'lab.user@flux.test', name: 'Lab User' });
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password = TEST_PASSWORD) =>
    request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password });

  describe('POST /auth/login', () => {
    it('sets an httpOnly, SameSite=Lax session cookie and returns the user', async () => {
      const res = await login('lab.user@flux.test').expect(200);
      const cookie = sessionCookie(res);
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(res.body.data).toMatchObject({ email: 'lab.user@flux.test', name: 'Lab User' });
      expect(res.body.data.lastLoginAt).toEqual(expect.any(String));
    });

    it('treats email case-insensitively', async () => {
      await login('  LAB.User@FLUX.test ').expect(200);
    });

    it('stores only a hash of the session token', async () => {
      const res = await login('lab.user@flux.test').expect(200);
      const token = sessionCookie(res).split(';')[0]!.split('=')[1]!;
      const sessions = await prisma.session.findMany();
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.tokenHash).not.toBe(token);
    });

    it.each([
      ['wrong password', 'lab.user@flux.test', 'not-the-password'],
      ['unknown email', 'nobody@flux.test', TEST_PASSWORD],
    ])('returns the same generic 401 for %s', async (_case, email, password) => {
      const res = await login(email, password).expect(401);
      expect(res.body.error).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid email or password',
      });
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('rejects disabled users with the same generic message', async () => {
      await createUser(prisma, { email: 'gone@flux.test', status: 'DISABLED' });
      const res = await login('gone@flux.test').expect(401);
      expect(res.body.error.message).toBe('Invalid email or password');
    });

    it('validates the body', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('session lifecycle', () => {
    it('GET /auth/me returns the signed-in user and never the password hash', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(res.body.data.email).toBe('lab.user@flux.test');
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|argon2/);
    });

    it('GET /auth/me without a session returns 401', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('rejects a forged session token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Cookie', 'flux_session=forged-token')
        .expect(401);
    });

    it('logout revokes the session and clears the cookie', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Cookie', cookie)
        .expect(204);
      expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('logout without a session still succeeds', async () => {
      await request(app.getHttpServer()).post('/api/v1/auth/logout').expect(204);
    });

    it('rejects expired sessions', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });

    it('rejects idle sessions', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      await prisma.session.updateMany({
        data: { lastSeenAt: new Date(Date.now() - 3 * 3_600_000) },
      });
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', cookie).expect(401);
    });
  });

  describe('POST /auth/change-password', () => {
    it('changes the password and signs out other sessions only', async () => {
      const current = sessionCookie(await login('lab.user@flux.test'));
      const other = sessionCookie(await login('lab.user@flux.test'));

      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', current)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'a-brand-new-passphrase' })
        .expect(204);

      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', current).expect(200);
      await request(app.getHttpServer()).get('/api/v1/auth/me').set('Cookie', other).expect(401);
      await login('lab.user@flux.test').expect(401);
      await login('lab.user@flux.test', 'a-brand-new-passphrase').expect(200);
    });

    it('requires the correct current password', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', cookie)
        .send({ currentPassword: 'wrong-password', newPassword: 'a-brand-new-passphrase' })
        .expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    });

    it('enforces the password policy', async () => {
      const cookie = sessionCookie(await login('lab.user@flux.test'));
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Cookie', cookie)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('newPassword');
    });
  });
});
