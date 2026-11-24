import { INestApplication, type ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Portal, Tenant } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword } from '../src/modules/auth/password';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
}

/** Boots the full app against the test database. */
export async function createE2eApp(
  extra: Pick<ModuleMetadata, 'controllers'> = {},
): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { corsOrigins: [], trustProxy: 'loopback' });
  await app.init();
  return { app, prisma: app.get(PrismaService) };
}

/** Empties every application table. Only ever runs against the `_test` database. */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  const db = rows[0]?.db ?? '';
  if (!db.endsWith('_test')) throw new Error(`Refusing to truncate non-test database "${db}"`);
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "vessel_notification_override_vessel_contacts", "vessel_notification_override_contacts", "vessel_notification_overrides", ' +
      '"vessel_hidden_client_contacts", "vessel_contacts", "vessel_billing_overrides", "client_notification_rule_contacts", "client_notification_rules", ' +
      '"fleet_vessels", "fleets", "vessel_client_relationships", "vessels", "custom_field_definitions", "billing_parties", "client_contacts", "client_addresses", "clients", ' +
      '"tenant_sequences", "reference_item_hidden", "reference_items", "audit_logs", "user_roles", "role_permissions", "role_modules", "role_portals", "roles", ' +
      '"sessions", "users", "tenant_modules", "tenants" RESTART IDENTITY CASCADE',
  );
}

export const TEST_PASSWORD = 'correct-horse-battery';

/**
 * Creates a tenant directly in the database (system access), with its built-in
 * Administrator role, like the platform API does.
 */
export async function createTenant(
  prisma: PrismaService,
  data: { slug: string; name?: string; modules?: string[]; status?: 'ACTIVE' | 'SUSPENDED' },
): Promise<Tenant & { adminRoleId: string }> {
  const tenant = await prisma.tenant.create({
    data: {
      slug: data.slug,
      name: data.name ?? data.slug,
      status: data.status ?? 'ACTIVE',
      modules: { create: (data.modules ?? []).map((moduleKey) => ({ moduleKey })) },
    },
  });
  const role = await prisma.role.create({
    data: { tenantId: tenant.id, name: 'Administrator', defaultPortal: 'ADMIN', isSystem: true },
  });
  return { ...tenant, adminRoleId: role.id };
}

/** Creates a custom role directly in the database (system access). */
export async function createRole(
  prisma: PrismaService,
  data: {
    tenantId: string;
    name: string;
    portals?: Portal[];
    modules?: string[];
    permissions?: string[];
    isActive?: boolean;
  },
) {
  const portals = data.portals ?? ['ADMIN'];
  return prisma.role.create({
    data: {
      tenantId: data.tenantId,
      name: data.name,
      defaultPortal: portals[0]!,
      isActive: data.isActive ?? true,
      // tenant_id of child rows comes from the role through the composite relation.
      portals: { create: portals.map((portal) => ({ portal })) },
      modules: { create: (data.modules ?? []).map((moduleKey) => ({ moduleKey })) },
      permissions: { create: (data.permissions ?? []).map((permissionKey) => ({ permissionKey })) },
    },
  });
}

/**
 * Creates a user. Platform admins have no tenant; anyone else needs `tenantId`
 * (mirrors the database CHECK constraint).
 */
export async function createUser(
  prisma: PrismaService,
  data: {
    email: string;
    name?: string;
    tenantId?: string;
    isPlatformAdmin?: boolean;
    /** Role ids to assign (tenant users only). */
    roleIds?: string[];
    status?: 'ACTIVE' | 'DISABLED';
  },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0]!,
      tenantId: data.isPlatformAdmin ? null : data.tenantId,
      isPlatformAdmin: data.isPlatformAdmin ?? false,
      status: data.status ?? 'ACTIVE',
      passwordHash: await hashPassword(TEST_PASSWORD),
      userRoles: { create: (data.roleIds ?? []).map((roleId) => ({ roleId })) },
    },
  });
}

/** Signs in and returns the `flux_session=...` cookie pair. */
export async function loginCookie(
  app: INestApplication,
  email: string,
  password = TEST_PASSWORD,
): Promise<string> {
  // Imported lazily so this helper module has no hard dependency on supertest typing order.
  const request = (await import('supertest')).default;
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0];
  if (!cookie) throw new Error('No session cookie set');
  return cookie.split(';')[0]!;
}

/** Creates a reference item: a FLUX default when tenantId is omitted. */
export async function createReferenceItem(
  prisma: PrismaService,
  data: {
    list: string;
    code: string;
    name: string;
    tenantId?: string;
    isActive?: boolean;
    sortOrder?: number;
  },
) {
  return prisma.referenceItem.create({
    data: {
      tenantId: data.tenantId ?? null,
      listKey: data.list,
      code: data.code,
      name: data.name,
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
    },
  });
}
