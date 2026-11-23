import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AuditLogDto } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import {
  createE2eApp,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Audit log (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let adminRoleId: string;
  let adminId: string;
  let admin: string;

  const api = () => request(app.getHttpServer());
  const get = (cookie: string, url: string) => api().get(url).set('Cookie', cookie);
  const send = (
    cookie: string,
    method: 'post' | 'put' | 'patch' | 'delete',
    url: string,
    body?: object,
  ) => api()[method](url).set('Cookie', cookie).send(body);

  async function entries(cookie = admin, query = ''): Promise<AuditLogDto[]> {
    const res = await get(cookie, `/api/v1/audit-logs?pageSize=100${query}`).expect(200);
    return res.body.data;
  }

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['samples'] });
    tenantId = tenant.id;
    adminRoleId = tenant.adminRoleId;
    adminId = (
      await createUser(prisma, {
        email: 'admin@acme.test',
        name: 'Ada Admin',
        tenantId,
        roleIds: [adminRoleId],
      })
    ).id;
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('what is recorded', () => {
    it('records the user lifecycle with actor, request id and field changes', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Analyst',
        modules: ['samples'],
        permissions: ['sample.view'],
      });

      const created = await send(admin, 'post', '/api/v1/users', {
        name: 'Bob',
        email: 'bob@acme.test',
        password: 'bob-secret-pass',
        roleIds: [role.id],
      }).expect(201);
      const bobId = created.body.data.id;
      const requestId = created.headers['x-request-id'];

      await send(admin, 'patch', `/api/v1/users/${bobId}`, { name: 'Robert' }).expect(200);
      await send(admin, 'patch', `/api/v1/users/${bobId}`, { status: 'DISABLED' }).expect(200);
      await send(admin, 'put', `/api/v1/users/${bobId}/roles`, { roleIds: [] }).expect(200);
      await send(admin, 'post', `/api/v1/users/${bobId}/reset-password`, {
        password: 'another-secret-1',
      }).expect(204);

      const log = (await entries(admin, `&entityId=${bobId}`)).reverse();
      expect(log.map((e) => e.action)).toEqual([
        'user.created',
        'user.updated',
        'user.disabled',
        'user.roles_changed',
        'user.password_reset',
      ]);
      expect(log[0]).toMatchObject({
        actor: { type: 'USER', id: adminId, name: 'Ada Admin', email: 'admin@acme.test' },
        entity: { type: 'user', id: bobId, label: 'Bob' },
        requestId,
        changes: {
          name: { from: null, to: 'Bob' },
          email: { from: null, to: 'bob@acme.test' },
          roles: { added: ['Analyst'], removed: [] },
        },
      });
      expect(log[1]!.changes).toEqual({ name: { from: 'Bob', to: 'Robert' } });
      expect(log[2]!.changes).toEqual({ status: { from: 'ACTIVE', to: 'DISABLED' } });
      expect(log[3]!.changes).toEqual({ roles: { added: [], removed: ['Analyst'] } });
      expect(log[4]!.changes).toBeNull();
    });

    it('never stores passwords or hashes', async () => {
      await send(admin, 'post', '/api/v1/users', {
        name: 'Carol',
        email: 'carol@acme.test',
        password: 'carol-secret-pass',
      }).expect(201);
      await send(admin, 'post', '/api/v1/auth/change-password', {
        currentPassword: 'correct-horse-battery',
        newPassword: 'ada-new-secret-1',
      }).expect(204);

      const raw = JSON.stringify(await prisma.auditLog.findMany());
      expect(raw).not.toMatch(
        /carol-secret-pass|ada-new-secret-1|correct-horse-battery|argon2|password_hash|passwordHash/,
      );
      expect((await entries()).map((e) => e.action)).toContain('user.password_changed');
    });

    it('skips no-op changes', async () => {
      await send(admin, 'patch', `/api/v1/users/${adminId}`, { name: 'Ada Admin' }).expect(200);
      expect(await entries()).toEqual([]);
    });

    it('records role changes, including permissions dropped with their module', async () => {
      const role = (
        await send(admin, 'post', '/api/v1/roles', {
          name: 'Registrar',
          defaultPortal: 'LAB',
          modules: ['samples'],
          permissions: ['sample.register'],
        }).expect(201)
      ).body.data;
      await send(admin, 'patch', `/api/v1/roles/${role.id}`, { isActive: false }).expect(200);
      await send(admin, 'put', `/api/v1/roles/${role.id}/modules`, { modules: [] }).expect(200);
      await send(admin, 'post', `/api/v1/roles/${role.id}/clone`, { name: 'Registrar 2' }).expect(
        201,
      );

      const log = (await entries(admin, `&entityId=${role.id}`)).reverse();
      expect(log.map((e) => e.action)).toEqual([
        'role.created',
        'role.deactivated',
        'role.modules_changed',
        'role.cloned',
      ]);
      expect(log[0]!.changes).toMatchObject({
        name: { from: null, to: 'Registrar' },
        portals: { added: ['LAB'], removed: [] },
        permissions: { added: ['sample.register'], removed: [] },
      });
      expect(log[2]!.changes).toEqual({
        modules: { added: [], removed: ['samples'] },
        permissions: { added: [], removed: ['sample.register'] },
      });
      expect(log[3]!.changes).toMatchObject({ clonedFrom: { from: null, to: 'Registrar' } });
    });

    it('shows role assignments in both the user’s and the role’s history', async () => {
      const role = await createRole(prisma, { tenantId, name: 'Viewer' });
      const dan = await createUser(prisma, { email: 'dan@acme.test', name: 'Dan', tenantId });

      await send(admin, 'put', `/api/v1/users/${dan.id}/roles`, { roleIds: [role.id] }).expect(200);
      await send(admin, 'delete', `/api/v1/roles/${role.id}/users/${dan.id}`).expect(204);

      const roleHistory = (await entries(admin, `&entityId=${role.id}`)).map((e) => e.action);
      const userHistory = (await entries(admin, `&entityId=${dan.id}`)).map((e) => e.action);
      expect(roleHistory).toEqual(['role.user_unassigned', 'user.roles_changed']);
      expect(userHistory).toEqual(['role.user_unassigned', 'user.roles_changed']);
    });
  });

  describe('atomicity', () => {
    it('writes nothing when the change is rejected', async () => {
      await send(admin, 'delete', `/api/v1/roles/${adminRoleId}/users/${adminId}`).expect(409);
      const hr = await createRole(prisma, {
        tenantId,
        name: 'HR',
        modules: ['administration'],
        permissions: ['user.manage'],
      });
      const hrUser = await createUser(prisma, {
        email: 'hr@acme.test',
        tenantId,
        roleIds: [hr.id],
      });
      const hrCookie = await loginCookie(app, 'hr@acme.test');
      await send(hrCookie, 'put', `/api/v1/users/${hrUser.id}/roles`, {
        roleIds: [hr.id, adminRoleId],
      }).expect(403);

      expect(await prisma.auditLog.count()).toBe(0);
    });
  });

  describe('access', () => {
    it('requires audit.view', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'HR',
        modules: ['administration'],
        permissions: ['user.manage'],
      });
      await createUser(prisma, { email: 'hr@acme.test', tenantId, roleIds: [role.id] });
      const hr = await loginCookie(app, 'hr@acme.test');
      await get(hr, '/api/v1/audit-logs').expect(403);
    });

    it('filters by action and paginates, newest first', async () => {
      for (const name of ['One', 'Two', 'Three']) {
        await send(admin, 'post', '/api/v1/roles', { name, defaultPortal: 'ADMIN' }).expect(201);
      }
      await send(admin, 'post', '/api/v1/users', {
        name: 'Eve',
        email: 'eve@acme.test',
        password: 'eve-password-1',
      });

      const res = await get(admin, '/api/v1/audit-logs?action=role.created&pageSize=2').expect(200);
      expect(res.body.meta).toMatchObject({ total: 3, totalPages: 2 });
      expect(res.body.data.map((e: AuditLogDto) => e.entity.label)).toEqual(['Three', 'Two']);
    });
  });

  describe('isolation and immutability', () => {
    it('one tenant never sees another tenant’s entries', async () => {
      await send(admin, 'post', '/api/v1/roles', {
        name: 'Acme only',
        defaultPortal: 'ADMIN',
      }).expect(201);
      const other = await createTenant(prisma, { slug: 'other' });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'admin@other.test');
      expect(await entries(otherAdmin)).toEqual([]);

      const viaDb = await app.get(TenantDb).run(other.id, (tx) => tx.auditLog.count());
      expect(viaDb).toBe(0);
    });

    it('cannot be changed or deleted by the app role or even the table owner', async () => {
      await send(admin, 'post', '/api/v1/roles', {
        name: 'Evidence',
        defaultPortal: 'ADMIN',
      }).expect(201);
      const entry = await prisma.auditLog.findFirstOrThrow();
      const tenantDb = app.get(TenantDb);

      await expect(
        tenantDb.run(tenantId, (tx) =>
          tx.auditLog.update({ where: { id: entry.id }, data: { action: 'x' } }),
        ),
      ).rejects.toThrow(/permission denied/i);
      await expect(tenantDb.run(tenantId, (tx) => tx.auditLog.deleteMany({}))).rejects.toThrow(
        /permission denied/i,
      );

      await expect(
        prisma.auditLog.update({ where: { id: entry.id }, data: { action: 'x' } }),
      ).rejects.toThrow(/append-only/);
      await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
      expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: entry.id } })).action).toBe(
        'role.created',
      );
    });
  });

  describe('platform actions', () => {
    it('are visible to the tenant as "FLUX platform", with real details on the platform side', async () => {
      await createUser(prisma, {
        email: 'operator@flux.test',
        name: 'Olivia Operator',
        isPlatformAdmin: true,
      });
      const operator = await loginCookie(app, 'operator@flux.test');
      const created = await send(operator, 'post', '/api/v1/platform/tenants', {
        name: 'Oceanic',
        slug: 'oceanic',
        modules: ['samples'],
        admin: { name: 'Owen', email: 'owen@oceanic.test', password: 'owen-pass-123' },
      }).expect(201);
      const oceanicId = created.body.data.id;
      await send(operator, 'put', `/api/v1/platform/tenants/${oceanicId}/modules`, {
        modules: ['samples', 'reports'],
      }).expect(200);

      const owen = await loginCookie(app, 'owen@oceanic.test', 'owen-pass-123');
      const tenantView = await entries(owen);
      expect(tenantView.map((e) => e.action)).toEqual([
        'tenant.modules_changed',
        'user.created',
        'tenant.created',
      ]);
      expect(tenantView[0]).toMatchObject({
        actor: { type: 'PLATFORM_ADMIN', id: null, name: 'FLUX platform', email: null },
        changes: { modules: { added: ['reports'], removed: [] } },
      });
      expect(JSON.stringify(tenantView)).not.toContain('operator@flux.test');

      const platformView = await get(
        operator,
        `/api/v1/platform/tenants/${oceanicId}/audit-logs`,
      ).expect(200);
      expect(platformView.body.data.map((e: AuditLogDto) => e.action)).toEqual([
        'tenant.modules_changed',
        'tenant.created',
      ]);
      expect(platformView.body.data[0].actor).toMatchObject({
        name: 'Olivia Operator',
        email: 'operator@flux.test',
      });

      await get(owen, `/api/v1/platform/tenants/${oceanicId}/audit-logs`).expect(403);
    });
  });
});
