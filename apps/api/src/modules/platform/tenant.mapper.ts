import type { Tenant, TenantModule } from '@prisma/client';
import { OPTIONAL_MODULE_KEYS, type ModuleKey, type TenantDto } from '@flux/shared';

export function toTenantDto(
  tenant: Tenant & { modules: Pick<TenantModule, 'moduleKey'>[] },
): TenantDto {
  const licensed = tenant.modules.map((m) => m.moduleKey);
  return {
    id: tenant.id,
    slug: tenant.slug,
    name: tenant.name,
    status: tenant.status,
    // Catalogue order; unknown or retired keys are dropped.
    modules: OPTIONAL_MODULE_KEYS.filter((key): key is ModuleKey => licensed.includes(key)),
    createdAt: tenant.createdAt.toISOString(),
    updatedAt: tenant.updatedAt.toISOString(),
  };
}
