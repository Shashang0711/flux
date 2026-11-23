import { PrismaClient } from '@prisma/client';

/**
 * Idempotent seed. Each milestone appends its reference data here using upserts,
 * so running `npm run db:seed` repeatedly is always safe.
 */
async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('Seed complete (no reference data yet).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
