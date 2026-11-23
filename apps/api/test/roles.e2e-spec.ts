import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import {
  createE2eApp,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Roles and permissions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let adminRoleId: string;
  let adminId: string;
  let admin: string;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) => api().post(url).set('Cookie', cookie).send(body),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
    delete: (url: string) => api().delete(url).set('Cookie', cookie),
  });

  /** Creates a tenant user holding a custom role with exactly these permissions. */
  async function userWith(email: string, modules: string[], permissions: string[]) {
    const role = await createRole(prisma, {
      tenantId,
      name: `role-${email}`,
      modules,
      permissions,
    });
    const user = await createUser(prisma, { email, tenantId, roleIds: [role.id] });
    return { user, role, cookie: await loginCookie(app, email) };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['samples', 'reports'] });
    tenantId = tenant.id;
    adminRoleId = tenant.adminRoleId;
    adminId = (
      await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [adminRoleId] })
    ).id;
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('catalogue and the Administrator role', () => {
    it('offers only licensed modules, portals and permissions', async () => {
      const res = await as(admin).get('/api/v1/access/catalogue').expect(200);
      expect(res.body.data.modules.map((m: { key: string }) => m.key)).toEqual([
        'administration',
        'samples',
        'reports',
      ]);
      expect(res.body.data.portals.map((p: { key: string }) => p.key)).toEqual(['ADMIN', 'LAB']);
      const keys = res.body.data.permissions.map((p: { key: string }) => p.key);
      expect(keys).toContain('sample.register');
      expect(keys).not.toContain('invoice.view');
    });

    it('shows the Administrator role with everything licensed, and keeps it locked', async () => {
      const res = await as(admin).get(`/api/v1/roles/${adminRoleId}`).expect(200);
      expect(res.body.data).toMatchObject({
        name: 'Administrator',
        isSystem: true,
        userCount: 1,
        portals: ['ADMIN', 'LAB'],
        modules: ['administration', 'samples', 'reports'],
      });
      expect(res.body.data.permissions).toEqual(expect.arrayContaining(['report.publish']));

      await as(admin).patch(`/api/v1/roles/${adminRoleId}`, { name: 'Boss' }).expect(400);
      await as(admin)
        .put(`/api/v1/roles/${adminRoleId}/permissions`, { permissions: [] })
        .expect(400);
      await as(admin).put(`/api/v1/roles/${adminRoleId}/modules`, { modules: [] }).expect(400);
    });

    it('grows with licensing: a newly licensed module is granted to administrators at once', async () => {
      await prisma.tenantModule.create({ data: { tenantId, moduleKey: 'finance' } });
      const me = await as(admin).get('/api/v1/auth/me').expect(200);
      expect(me.body.data.access.portals).toEqual(['ADMIN', 'LAB', 'FINANCE']);
      expect(me.body.data.access.permissions).toContain('invoice.manage');
    });
  });

  describe('creating and editing roles', () => {
    it('creates a role with its access and lists it', async () => {
      const res = await as(admin)
        .post('/api/v1/roles', {
          name: 'Lab Analyst',
          defaultPortal: 'LAB',
          modules: ['samples'],
          permissions: ['sample.test'],
        })
        .expect(201);
      expect(res.body.data).toMatchObject({
        name: 'Lab Analyst',
        isSystem: false,
        isActive: true,
        portals: ['LAB'],
        modules: ['samples'],
        permissions: ['sample.test'],
        userCount: 0,
      });

      const list = await as(admin).get('/api/v1/roles').expect(200);
      expect(list.body.data.map((r: { name: string }) => r.name)).toEqual([
        'Administrator',
        'Lab Analyst',
      ]);
    });

    it('rejects duplicate names, ignoring case', async () => {
      await as(admin).post('/api/v1/roles', { name: 'Analyst', defaultPortal: 'LAB' }).expect(201);
      const res = await as(admin)
        .post('/api/v1/roles', { name: 'ANALYST', defaultPortal: 'LAB' })
        .expect(409);
      expect(res.body.error.details.fields[0].path).toBe('name');
    });

    it('rejects unlicensed modules and portals, and permissions without their module', async () => {
      const res = await as(admin)
        .post('/api/v1/roles', {
          name: 'Bad',
          defaultPortal: 'ADMIN',
          portals: ['ADMIN', 'FINANCE'],
          modules: ['finance', 'samples'],
          permissions: ['report.view'],
        })
        .expect(400);
      const paths = res.body.error.details.map((d: { path: string }) => d.path);
      expect(paths).toEqual(expect.arrayContaining(['portals.1', 'modules.0', 'permissions.0']));
    });

    it('requires the default portal to be one of the role’s portals', async () => {
      await as(admin)
        .post('/api/v1/roles', { name: 'Bad', defaultPortal: 'LAB', portals: ['ADMIN'] })
        .expect(400);
    });

    it('drops permissions when their module is removed from the role', async () => {
      const role = (
        await as(admin).post('/api/v1/roles', {
          name: 'Reporter',
          defaultPortal: 'ADMIN',
          modules: ['samples', 'reports'],
          permissions: ['sample.view', 'report.upload'],
        })
      ).body.data;
      const res = await as(admin)
        .put(`/api/v1/roles/${role.id}/modules`, { modules: ['samples'] })
        .expect(200);
      expect(res.body.data).toMatchObject({ modules: ['samples'], permissions: ['sample.view'] });
    });

    it('keeps the default portal inside the role’s portals', async () => {
      const role = (await as(admin).post('/api/v1/roles', { name: 'Desk', defaultPortal: 'LAB' }))
        .body.data;
      await as(admin)
        .put(`/api/v1/roles/${role.id}/portals`, { portals: ['ADMIN'] })
        .expect(400);
      await as(admin)
        .put(`/api/v1/roles/${role.id}/portals`, { portals: ['ADMIN', 'LAB'] })
        .expect(200);
      await as(admin).patch(`/api/v1/roles/${role.id}`, { defaultPortal: 'ADMIN' }).expect(200);
    });
  });

  describe('cloning', () => {
    it('copies only the selected parts', async () => {
      const source = (
        await as(admin).post('/api/v1/roles', {
          name: 'Senior Analyst',
          defaultPortal: 'LAB',
          portals: ['LAB', 'ADMIN'],
          modules: ['samples'],
          permissions: ['sample.register', 'sample.test'],
        })
      ).body.data;

      const full = await as(admin)
        .post(`/api/v1/roles/${source.id}/clone`, { name: 'Senior Analyst (Night)' })
        .expect(201);
      expect(full.body.data).toMatchObject({
        portals: ['ADMIN', 'LAB'],
        modules: ['samples'],
        permissions: ['sample.register', 'sample.test'],
        defaultPortal: 'LAB',
      });

      const portalsOnly = await as(admin)
        .post(`/api/v1/roles/${source.id}/clone`, {
          name: 'Visitor',
          copyModules: false,
          copyPermissions: false,
        })
        .expect(201);
      expect(portalsOnly.body.data).toMatchObject({
        portals: ['ADMIN', 'LAB'],
        modules: [],
        permissions: [],
      });
    });

    it('can clone the Administrator role into an editable copy', async () => {
      const res = await as(admin)
        .post(`/api/v1/roles/${adminRoleId}/clone`, { name: 'Deputy Admin' })
        .expect(201);
      expect(res.body.data).toMatchObject({
        isSystem: false,
        modules: ['administration', 'samples', 'reports'],
      });
      expect(res.body.data.permissions).toContain('role.manage');
    });
  });

  describe('enforcement', () => {
    it('gates endpoints by permission: view-only users can list but not change', async () => {
      const { cookie } = await userWith('viewer@acme.test', ['administration'], ['user.view']);
      await as(cookie).get('/api/v1/users').expect(200);
      await as(cookie)
        .post('/api/v1/users', { email: 'x@acme.test', name: 'X', password: 'some-password-1' })
        .expect(403);
      await as(cookie).get('/api/v1/roles').expect(403);
    });

    it('applies "manage implies view"', async () => {
      const { cookie } = await userWith('mgr@acme.test', ['administration'], ['role.manage']);
      await as(cookie).get('/api/v1/roles').expect(200);
    });

    it('takes effect immediately when a role is assigned, deactivated or a module unlicensed', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'User Admin',
        modules: ['administration'],
        permissions: ['user.view'],
      });
      await createUser(prisma, { email: 'later@acme.test', tenantId });
      const cookie = await loginCookie(app, 'later@acme.test');
      const userId = (await as(cookie).get('/api/v1/auth/me')).body.data.user.id;

      await as(cookie).get('/api/v1/users').expect(403);
      await as(admin)
        .post(`/api/v1/roles/${role.id}/users`, { userIds: [userId] })
        .expect(201);
      await as(cookie).get('/api/v1/users').expect(200);

      await as(admin).patch(`/api/v1/roles/${role.id}`, { isActive: false }).expect(200);
      await as(cookie).get('/api/v1/users').expect(403);
    });

    it('loses permissions of a module the tenant is no longer licensed for', async () => {
      const { cookie } = await userWith('rep@acme.test', ['reports'], ['report.view']);
      expect((await as(cookie).get('/api/v1/auth/me')).body.data.access.permissions).toEqual([
        'report.view',
      ]);
      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'reports' } });
      expect((await as(cookie).get('/api/v1/auth/me')).body.data.access.permissions).toEqual([]);
    });
  });

  describe('no privilege escalation', () => {
    it('a user manager cannot hand out the Administrator role (or any role beyond their own access)', async () => {
      const { cookie, user } = await userWith('hr@acme.test', ['administration'], ['user.manage']);
      const res = await as(cookie)
        .put(`/api/v1/users/${user.id}/roles`, { roleIds: [adminRoleId] })
        .expect(403);
      expect(res.body.error.message).toMatch(/cannot grant permissions you do not have/);

      await as(cookie)
        .post(`/api/v1/roles/${adminRoleId}/users`, { userIds: [user.id] })
        .expect(403);
      await as(cookie)
        .post('/api/v1/users', {
          email: 'puppet@acme.test',
          name: 'Puppet',
          password: 'puppet-pass-1',
          roleIds: [adminRoleId],
        })
        .expect(403);
      expect(await prisma.user.count({ where: { email: 'puppet@acme.test' } })).toBe(0);
    });

    it('a role manager cannot add permissions they do not hold', async () => {
      const { cookie, role } = await userWith(
        'rm@acme.test',
        ['administration', 'samples'],
        ['role.manage', 'sample.view'],
      );
      await as(cookie)
        .post('/api/v1/roles', {
          name: 'Registrar',
          defaultPortal: 'LAB',
          modules: ['samples'],
          permissions: ['sample.register'],
        })
        .expect(403);
      // Not even on their own role.
      await as(cookie)
        .put(`/api/v1/roles/${role.id}/permissions`, {
          permissions: ['role.manage', 'sample.register'],
        })
        .expect(403);
      // Within their own access it works.
      await as(cookie)
        .post('/api/v1/roles', {
          name: 'Sample Viewer',
          defaultPortal: 'LAB',
          modules: ['samples'],
          permissions: ['sample.view'],
        })
        .expect(201);
    });
  });

  describe('keeping an Administrator', () => {
    it('blocks removing the last active Administrator, in every way', async () => {
      await as(admin).delete(`/api/v1/roles/${adminRoleId}/users/${adminId}`).expect(409);
      await as(admin).put(`/api/v1/users/${adminId}/roles`, { roleIds: [] }).expect(409);
      await as(admin).patch(`/api/v1/users/${adminId}`, { status: 'DISABLED' }).expect(400);
    });

    it('allows it while another active Administrator remains', async () => {
      const second = await createUser(prisma, {
        email: 'admin2@acme.test',
        tenantId,
        roleIds: [adminRoleId],
      });
      await as(admin).delete(`/api/v1/roles/${adminRoleId}/users/${second.id}`).expect(204);
      // Now admin is alone again.
      await as(admin).put(`/api/v1/users/${adminId}/roles`, { roleIds: [] }).expect(409);
    });

    it('does not count disabled users as remaining Administrators', async () => {
      await createUser(prisma, {
        email: 'ghost@acme.test',
        tenantId,
        roleIds: [adminRoleId],
        status: 'DISABLED',
      });
      await as(admin).delete(`/api/v1/roles/${adminRoleId}/users/${adminId}`).expect(409);
    });
  });

  describe('tenant isolation', () => {
    it('cannot see or assign another tenant’s roles', async () => {
      const other = await createTenant(prisma, { slug: 'other' });
      const foreignRole = await createRole(prisma, { tenantId: other.id, name: 'Foreign' });

      await as(admin).get(`/api/v1/roles/${foreignRole.id}`).expect(404);
      const res = await as(admin)
        .put(`/api/v1/users/${adminId}/roles`, { roleIds: [adminRoleId, foreignRole.id] })
        .expect(400);
      expect(res.body.error.details[0]).toMatchObject({
        path: 'roleIds.1',
        message: 'Role not found',
      });

      const list = await as(admin).get('/api/v1/roles').expect(200);
      expect(list.body.data.map((r: { name: string }) => r.name)).toEqual(['Administrator']);
    });

    it('rejects, in the database, linking a user to another tenant’s role', async () => {
      const other = await createTenant(prisma, { slug: 'other' });
      await expect(
        prisma.userRole.create({ data: { tenantId, userId: adminId, roleId: other.adminRoleId } }),
      ).rejects.toThrow(/Foreign key constraint/i);
    });
  });
});
