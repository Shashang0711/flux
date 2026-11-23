import { INestApplication, ModuleMetadata } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/database/prisma.service';

export interface PrismaMock {
  ping: jest.Mock;
  $connect: jest.Mock;
  $disconnect: jest.Mock;
}

/** Boots the real AppModule + HTTP pipeline with Prisma replaced by a mock. */
export async function createTestApp(
  extra: Pick<ModuleMetadata, 'controllers'> = {},
): Promise<{ app: INestApplication; prisma: PrismaMock }> {
  const prisma: PrismaMock = {
    ping: jest.fn().mockResolvedValue(undefined),
    $connect: jest.fn().mockResolvedValue(undefined),
    $disconnect: jest.fn().mockResolvedValue(undefined),
  };

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app, { corsOrigins: ['http://localhost:3000'] });
  await app.init();
  return { app, prisma };
}
