import { INestApplication, type ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Tenant } from '@prisma/client';
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
    'TRUNCATE TABLE "sessions", "users", "tenant_modules", "tenants" RESTART IDENTITY CASCADE',
  );
}

export const TEST_PASSWORD = 'correct-horse-battery';

/** Creates a tenant directly in the database (system access). */
export async function createTenant(
  prisma: PrismaService,
  data: { slug: string; name?: string; modules?: string[]; status?: 'ACTIVE' | 'SUSPENDED' },
): Promise<Tenant> {
  return prisma.tenant.create({
    data: {
      slug: data.slug,
      name: data.name ?? data.slug,
      status: data.status ?? 'ACTIVE',
      modules: { create: (data.modules ?? []).map((moduleKey) => ({ moduleKey })) },
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
    isTenantAdmin?: boolean;
    status?: 'ACTIVE' | 'DISABLED';
  },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0]!,
      tenantId: data.isPlatformAdmin ? null : data.tenantId,
      isPlatformAdmin: data.isPlatformAdmin ?? false,
      isTenantAdmin: data.isTenantAdmin ?? false,
      status: data.status ?? 'ACTIVE',
      passwordHash: await hashPassword(TEST_PASSWORD),
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
