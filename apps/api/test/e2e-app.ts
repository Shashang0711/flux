import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';
import { hashPassword } from '../src/modules/auth/password';

export interface E2eContext {
  app: INestApplication;
  prisma: PrismaService;
}

/** Boots the full app against the test database. */
export async function createE2eApp(): Promise<E2eContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "sessions", "users" RESTART IDENTITY CASCADE');
}

export const TEST_PASSWORD = 'correct-horse-battery';

export async function createUser(
  prisma: PrismaService,
  data: { email: string; name?: string; isSystemAdmin?: boolean; status?: 'ACTIVE' | 'DISABLED' },
) {
  return prisma.user.create({
    data: {
      email: data.email,
      name: data.name ?? data.email.split('@')[0]!,
      isSystemAdmin: data.isSystemAdmin ?? false,
      status: data.status ?? 'ACTIVE',
      passwordHash: await hashPassword(TEST_PASSWORD),
    },
  });
}
