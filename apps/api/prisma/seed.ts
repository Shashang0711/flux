import { PrismaClient } from '@prisma/client';
import { emailSchema, passwordSchema } from '@flux/shared';
import { hashPassword } from '../src/modules/auth/password';
import { REFERENCE_DEFAULTS } from './reference-defaults';

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

/** FLUX default reference data: creates missing items, never changes existing ones. */
async function seedReferenceDefaults(prisma: PrismaClient): Promise<void> {
  let created = 0;
  for (const [listKey, items] of Object.entries(REFERENCE_DEFAULTS)) {
    for (const [index, item] of items.entries()) {
      const existing = await prisma.referenceItem.findFirst({
        where: { tenantId: null, listKey, code: { equals: item.code, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.referenceItem.create({
        data: { listKey, code: item.code, name: item.name, sortOrder: (index + 1) * 10 },
      });
      created += 1;
    }
  }
  console.log(`Reference data: ${created} FLUX default item(s) created.`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedBootstrapAdmin(prisma);
    await seedReferenceDefaults(prisma);
    console.log('Seed complete.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
