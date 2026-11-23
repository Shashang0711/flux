import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

export type TenantTx = Prisma.TransactionClient;

/**
 * Runs tenant-scoped data access under Postgres row-level security.
 *
 * Inside `run`, the transaction switches to the restricted `flux_app` role and sets
 * `app.tenant_id`, so every query can only see and write rows of that tenant, even if a
 * `where` clause is missing or wrong. Use this for ALL tenant data. The plain PrismaService
 * (which bypasses RLS) is reserved for system code: login, sessions and platform admin.
 */
@Injectable()
export class TenantDb {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(tenantId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE flux_app');
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
