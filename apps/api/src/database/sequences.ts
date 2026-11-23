import type { Prisma } from '@prisma/client';

/**
 * Next number of a per-tenant sequence (1, 2, 3, …), e.g. for client codes.
 *
 * Runs inside the caller's transaction: the counter row stays locked until it commits, so
 * concurrent creates are serialised and get distinct numbers, and a rolled-back create returns
 * its number (no gaps).
 */
export async function nextSequence(
  tx: Prisma.TransactionClient,
  tenantId: string,
  key: string,
): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO tenant_sequences (tenant_id, key, next_value)
    VALUES (${tenantId}::uuid, ${key}, 2)
    ON CONFLICT (tenant_id, key)
      DO UPDATE SET next_value = tenant_sequences.next_value + 1
    RETURNING next_value - 1 AS value`;
  return Number(rows[0]!.value);
}
