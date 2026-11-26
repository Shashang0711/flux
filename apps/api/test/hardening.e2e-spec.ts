import { randomUUID } from 'node:crypto';
import { INestApplication, RequestMethod } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  CLIENT_USERS_KEY,
  IS_PUBLIC_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRES_PLATFORM_ADMIN_KEY,
} from '../src/modules/auth/decorators';
import { FILE_STORAGE, type FileStorage } from '../src/modules/files/storage';
import { MaintenanceService } from '../src/modules/maintenance/maintenance.service';
import {
  TEST_PASSWORD,
  createE2eApp,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

/**
 * Signed-in routes that need no permission on purpose: own account, and read-only lists
 * every user of a tenant needs for forms. Anything else must be @Public, platform-only or
 * require a permission. Adding a route here is a security decision.
 */
const SELF_SERVICE = new Set([
  'GET /auth/me',
  'POST /auth/change-password',
  'GET /reference-data',
  'GET /reference-data/:list',
  'GET /custom-fields/entities',
  'GET /custom-fields',
  'POST /files',
  'PUT /files/:id/content',
]);

describe('Hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  it('every route is public, platform-only, permission-checked or a known self-service route', () => {
    const reflector = app.get(Reflector);
    const unguarded: string[] = [];
    const clientRoutes: string[] = [];
    for (const module of app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as (new (...args: never[]) => object) | null;
        if (!controller) continue;
        const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
        for (const name of Object.getOwnPropertyNames(controller.prototype)) {
          const handler = (controller.prototype as Record<string, unknown>)[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod;
          if (method === undefined) continue;
          const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '');
          const route = `${RequestMethod[method]} /${[base, path].filter((p) => p && p !== '/').join('/')}`;
          const meta = (key: string) => reflector.getAllAndOverride(key, [handler, controller]);
          if (meta(CLIENT_USERS_KEY)) clientRoutes.push(route);
          if (
            meta(IS_PUBLIC_KEY) ||
            meta(REQUIRES_PLATFORM_ADMIN_KEY) ||
            meta(REQUIRED_PERMISSIONS_KEY) ||
            SELF_SERVICE.has(route)
          ) {
            continue;
          }
          unguarded.push(route);
        }
      }
    }
    expect(unguarded).toEqual([]);
    // Client portal users reach only these.
    expect([...new Set(clientRoutes.map((r) => r.split(' ')[1]!.split('/')[1]))].sort()).toEqual([
      'auth',
      'portal',
    ]);
  });

  it('health: liveness, and readiness with database, storage and worker state', async () => {
    expect((await api().get('/api/v1/health/live').expect(200)).body.data).toEqual({
      status: 'ok',
    });
    const ready = (await api().get('/api/v1/health').expect(200)).body.data;
    expect(ready).toMatchObject({
      status: 'ok',
      checks: { database: 'up', storage: 'up', notifications: 'off' },
    });

    const storage = app.get<FileStorage>(FILE_STORAGE);
    const check = jest.spyOn(storage, 'check').mockRejectedValueOnce(new Error('no bucket'));
    const down = await api().get('/api/v1/health').expect(503);
    expect(down.body.error).toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
      message: 'File storage is unreachable',
    });
    check.mockRestore();
  });

  it('metrics: Prometheus text behind the bearer token', async () => {
    await api().get('/api/v1/metrics').expect(401);
    await api().get('/api/v1/metrics').set('Authorization', 'Bearer wrong').expect(401);
    await api().get('/api/v1/health').expect(200);
    const res = await api()
      .get('/api/v1/metrics')
      .set('Authorization', 'Bearer test-metrics-token-0000')
      .expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.text).toContain('process_cpu_user_seconds_total');
    // Route patterns, not raw URLs.
    expect(res.text).toMatch(
      /http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/health",status_code="200"\} \d+/,
    );
    expect(res.text).toContain('flux_notification_deliveries{status="PENDING"} 0');
  });

  it('rejects oversized and malformed JSON with the error envelope', async () => {
    const big = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(1_100_000) }))
      .expect(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const bad = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
  });

  it('audits sign-ins and failed sign-ins of known accounts, never the password', async () => {
    const tenant = await createTenant(prisma, { slug: 'acme' });
    const user = await createUser(prisma, {
      email: 'ann@acme.test',
      tenantId: tenant.id,
      roleIds: [tenant.adminRoleId],
    });
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ann@acme.test', password: 'wrong-password' })
      .expect(401);
    await api()
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@acme.test', password: 'wrong-password' })
      .expect(401);
    await loginCookie(app, 'ann@acme.test');

    const entries = await prisma.auditLog.findMany({
      where: { entityId: user.id },
      orderBy: { occurredAt: 'asc' },
    });
    expect(entries.map((e) => [e.action, e.actorType, e.tenantId])).toEqual([
      ['auth.sign_in_failed', 'SYSTEM', tenant.id],
      ['auth.signed_in', 'USER', tenant.id],
    ]);
    expect(entries[0]!.changes).toEqual({ reason: { from: null, to: 'Wrong password' } });
    expect(entries[0]!.ipAddress).toBeTruthy();
    expect(entries[0]!.requestId).toBeTruthy();
    expect(JSON.stringify(entries)).not.toContain(TEST_PASSWORD);
    expect(JSON.stringify(entries)).not.toContain('wrong-password');
    // Unknown accounts leave no audit entry.
    expect(await prisma.auditLog.count()).toBe(2);
  });

  it('maintenance removes old sessions and abandoned uploads, keeping files in use', async () => {
    const tenant = await createTenant(prisma, {
      slug: 'acme',
      modules: ['receiving', 'samples', 'lab-setup', 'clients', 'reports'],
    });
    const user = await createUser(prisma, {
      email: 'ann@acme.test',
      tenantId: tenant.id,
      roleIds: [tenant.adminRoleId],
    });
    // A lab report to attach a file to (through a notification).
    const admin = await loginCookie(app, 'ann@acme.test');
    const post = (url: string, body: object) =>
      api().post(`/api/v1${url}`).set('Cookie', admin).send(body);
    await post('/lab/starter-catalogue', {}).expect(201);
    const client = (await post('/clients', { name: 'Alpha' }).expect(201)).body.data;
    const options = (
      await api().get('/api/v1/samples/receive-register-options').set('Cookie', admin).expect(200)
    ).body.data;
    const pw = options.serviceTypes.find((s: { code: string }) => s.code === 'PW');
    const wqk = options.kits.find((k: { code: string }) => k.code === 'WQK');
    const batch = (
      await post('/samples/receive-and-register', {
        airwayBill: { number: 'AWB-M1' },
        serviceTypeId: pw.id,
        samples: [
          {
            productId: wqk.id,
            clientId: client.id,
            values: { sampling_point: 'Galley', date_sampled: '2026-11-20' },
          },
        ],
      }).expect(201)
    ).body.data;
    const report = await prisma.labReport.create({
      data: { tenantId: tenant.id, code: 'LR26-00001', batchId: batch.id, serviceTypeId: pw.id },
    });
    await prisma.session.deleteMany();
    const storage = app.get<FileStorage>(FILE_STORAGE);
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const session = (data: object) =>
      prisma.session.create({
        data: {
          tokenHash: randomUUID(),
          userId: user.id,
          expiresAt: new Date(Date.now() + 3_600_000),
          ...data,
        },
      });
    const old = await session({ expiresAt: days(40), lastSeenAt: days(40), createdAt: days(41) });
    const revoked = await session({ revokedAt: days(31) });
    const current = await session({});

    const file = async (status: 'PENDING' | 'READY', age: number) => {
      const id = randomUUID();
      const storageKey = `${tenant.id}/${id}`;
      if (status === 'READY') await storage.put(storageKey, Buffer.from('%PDF-1.7'), 'x');
      return prisma.storedFile.create({
        data: {
          id,
          tenantId: tenant.id,
          purpose: 'LAB_REPORT',
          status,
          name: 'r.pdf',
          size: 8,
          storageKey,
          createdAt: days(age),
          uploadedAt: status === 'READY' ? days(age) : null,
          contentType: status === 'READY' ? 'application/pdf' : null,
          sha256: status === 'READY' ? '0'.repeat(64) : null,
        },
      });
    };
    const stalePending = await file('PENDING', 2);
    const staleReady = await file('READY', 2);
    const freshReady = await file('READY', 0);
    const inUse = await file('READY', 2);
    await prisma.notification.create({
      data: {
        tenantId: tenant.id,
        event: 'report.published',
        reportId: report.id,
        clientName: 'Alpha',
        sampleCodes: [],
        subject: 's',
        bodyText: 't',
        bodyHtml: 'h',
        attachmentFileId: inUse.id,
      },
    });

    const result = await app.get(MaintenanceService).runOnce();
    expect(result).toEqual({ sessions: 2, files: 2 });
    const sessions = await prisma.session.findMany({ select: { id: true } });
    expect(sessions.map((s) => s.id)).toEqual([current.id]);
    expect(old.id).not.toBe(revoked.id);
    const files = await prisma.storedFile.findMany({ select: { id: true } });
    expect(files.map((f) => f.id).sort()).toEqual([freshReady.id, inUse.id].sort());
    await expect(storage.get(staleReady.storageKey)).rejects.toThrow();
    await expect(storage.get(freshReady.storageKey)).resolves.toBeDefined();
    expect(stalePending.id).toBeDefined();
  });
});
