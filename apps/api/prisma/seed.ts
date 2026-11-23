import { PrismaClient } from '@prisma/client';
import { emailSchema, passwordSchema } from '@flux/shared';
import { hashPassword } from '../src/modules/auth/password';

/**
 * Idempotent seed. Each milestone appends its reference data here using upserts,
 * so running `npm run db:seed` repeatedly is always safe.
 */
/** The first platform administrator. Tenants and their admins are created through the API. */
async function seedBootstrapAdmin(prisma: PrismaClient): Promise<void> {
  const { FLUX_ADMIN_EMAIL, FLUX_ADMIN_PASSWORD, FLUX_ADMIN_NAME } = process.env;
  if (!FLUX_ADMIN_EMAIL || !FLUX_ADMIN_PASSWORD) {
    console.log('Bootstrap admin skipped: set FLUX_ADMIN_EMAIL and FLUX_ADMIN_PASSWORD.');
    return;
  }
  const email = emailSchema.parse(FLUX_ADMIN_EMAIL);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    // Never overwrite an existing account's password or flags on re-seed.
    console.log(`Bootstrap admin ${email} already exists; left unchanged.`);
    return;
  }
  const password = passwordSchema.parse(FLUX_ADMIN_PASSWORD);
  await prisma.user.create({
    data: {
      email,
      name: FLUX_ADMIN_NAME?.trim() || 'Platform Administrator',
      passwordHash: await hashPassword(password),
      // Platform operator: belongs to no tenant and creates tenants and their admins.
      isPlatformAdmin: true,
    },
  });
  console.log(`Bootstrap admin ${email} created.`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedBootstrapAdmin(prisma);
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
