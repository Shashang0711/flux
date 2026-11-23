import type { ModuleDefinition, PermissionDefinition, PORTALS } from '@flux/shared';

/** GET /access/catalogue: what this tenant can put into roles. */
export interface AccessCatalogue {
  modules: ModuleDefinition[];
  portals: (typeof PORTALS)[number][];
  permissions: PermissionDefinition[];
}
