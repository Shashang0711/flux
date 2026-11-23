import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Each test boots its own app (fresh in-memory throttle state) with specific limits.
 * ConfigModule validates the environment when the app module is first imported, so the
 * limits are set first and the module is imported afterwards, in an isolated registry.
 */
async function bootWithLimits(limits: { ip: number; account: number }): Promise<INestApplication> {
  process.env.LOGIN_RATE_LIMIT = String(limits.ip);
  process.env.LOGIN_ACCOUNT_RATE_LIMIT = String(limits.account);
  let app!: INestApplication;
  await jest.isolateModulesAsync(async () => {
    const { createE2eApp } = await import('./e2e-app');
    ({ app } = await createE2eApp());
  });
  return app;
}

describe('Login rate limits (e2e)', () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const attempt = (email: string, forwardedFor?: string) => {
    const req = request(app!.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: 'whatever-password' });
    return forwardedFor ? req.set('X-Forwarded-For', forwardedFor) : req;
  };

  it('limits attempts per client IP across different accounts', async () => {
    app = await bootWithLimits({ ip: 3, account: 1000 });
    for (let i = 0; i < 3; i++) await attempt(`user${i}@flux.test`).expect(401);
    const res = await attempt('user9@flux.test').expect(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
  });

  it('limits attempts per account even when the client rotates its IP', async () => {
    app = await bootWithLimits({ ip: 1000, account: 3 });
    for (let i = 0; i < 3; i++) await attempt('victim@flux.test', `203.0.113.${i}`).expect(401);
    await attempt('VICTIM@flux.test', '203.0.113.99').expect(429);
    // Other accounts are unaffected.
    await attempt('someone.else@flux.test', '203.0.113.99').expect(401);
  });
});
