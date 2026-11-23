import { MODULES, type ModuleKey } from '../tenancy/modules';

/** The four FLUX portals. A role grants entry to one or more of them. */
export const PORTALS = [
  { key: 'ADMIN', name: 'Admin', requiresModule: null },
  { key: 'LAB', name: 'Lab', requiresModule: null },
  { key: 'CLIENT', name: 'Client Portal', requiresModule: 'client-portal' },
  { key: 'FINANCE', name: 'Finance', requiresModule: 'finance' },
] as const satisfies readonly { key: string; name: string; requiresModule: ModuleKey | null }[];

export type PortalKey = (typeof PORTALS)[number]['key'];
export const PORTAL_KEYS = PORTALS.map((p) => p.key) as [PortalKey, ...PortalKey[]];

/** Portals the built-in Administrator role grants (the client portal is for client users). */
export const SYSTEM_ROLE_PORTALS: readonly PortalKey[] = ['ADMIN', 'LAB', 'FINANCE'];

export interface PermissionDefinition {
  key: string;
  module: ModuleKey;
  name: string;
  /** Holding this permission also grants these (e.g. manage implies view). */
  implies?: readonly string[];
}

/**
 * Permission catalogue. Roles combine these; tenants cannot invent new keys.
 * Keys are stored in the database: never rename one, only add or retire.
 */
export const PERMISSIONS = [
  // Administration (core)
  { key: 'user.view', module: 'administration', name: 'View users' },
  {
    key: 'user.manage',
    module: 'administration',
    name: 'Create, edit and disable users; assign roles',
    implies: ['user.view', 'role.view'],
  },
  { key: 'role.view', module: 'administration', name: 'View roles and permissions' },
  {
    key: 'role.manage',
    module: 'administration',
    name: 'Create, edit and clone roles',
    implies: ['role.view'],
  },
  { key: 'audit.view', module: 'administration', name: 'View the audit log' },

  // Clients
  { key: 'client.view', module: 'clients', name: 'View clients' },
  {
    key: 'client.manage',
    module: 'clients',
    name: 'Create and edit clients, billing parties and contacts',
    implies: ['client.view'],
  },

  // Vessels & fleets
  { key: 'vessel.view', module: 'vessels', name: 'View vessels and fleets' },
  {
    key: 'vessel.manage',
    module: 'vessels',
    name: 'Create and edit vessels and client relationships',
    implies: ['vessel.view'],
  },
  {
    key: 'fleet.manage',
    module: 'vessels',
    name: 'Create fleets and assign vessels',
    implies: ['vessel.view'],
  },

  // Laboratory setup
  { key: 'lab-setup.view', module: 'lab-setup', name: 'View laboratory master data' },
  {
    key: 'lab-setup.manage',
    module: 'lab-setup',
    name: 'Manage categories, service types, products and bottles',
    implies: ['lab-setup.view'],
  },

  // Receiving
  { key: 'receiving.view', module: 'receiving', name: 'View airway bills and received kits' },
  {
    key: 'receiving.receive',
    module: 'receiving',
    name: 'Receive kits (bulk and receive & register)',
    implies: ['receiving.view'],
  },

  // Samples
  { key: 'sample.view', module: 'samples', name: 'View samples and batches' },
  {
    key: 'sample.register',
    module: 'samples',
    name: 'Register batches and samples',
    implies: ['sample.view'],
  },
  {
    key: 'sample.test',
    module: 'samples',
    name: 'Enter and upload test results',
    implies: ['sample.view'],
  },

  // Reports
  { key: 'report.view', module: 'reports', name: 'View reports and sample status' },
  {
    key: 'report.upload',
    module: 'reports',
    name: 'Upload lab reports for review',
    implies: ['report.view'],
  },
  {
    key: 'report.review',
    module: 'reports',
    name: 'Review reports: reject or mark ready to publish',
    implies: ['report.view'],
  },
  {
    key: 'report.publish',
    module: 'reports',
    name: 'Publish final reports',
    implies: ['report.view'],
  },

  // Client portal
  {
    key: 'client-portal.view',
    module: 'client-portal',
    name: 'View own vessels, samples and published reports',
  },

  // Finance
  { key: 'invoice.view', module: 'finance', name: 'View invoices and credit notes' },
  {
    key: 'invoice.manage',
    module: 'finance',
    name: 'Create invoices and credit notes',
    implies: ['invoice.view'],
  },
] as const satisfies readonly PermissionDefinition[];

export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
export const PERMISSION_KEYS = PERMISSIONS.map((p) => p.key) as [PermissionKey, ...PermissionKey[]];

export function isPermissionKey(value: string): value is PermissionKey {
  return PERMISSIONS.some((p) => p.key === value);
}

export function permissionModule(key: PermissionKey): ModuleKey {
  return PERMISSIONS.find((p) => p.key === key)!.module;
}

/** A role as needed to compute access. */
export interface RoleAccessInput {
  isActive: boolean;
  /** The built-in Administrator role: everything the tenant is licensed for. */
  isSystem: boolean;
  portals: readonly string[];
  modules: readonly string[];
  permissions: readonly string[];
}

export interface EffectiveAccess {
  portals: PortalKey[];
  /** Modules the user can open (licensed and granted by at least one role). */
  modules: ModuleKey[];
  permissions: PermissionKey[];
}

/**
 * Computes a user's access from their roles and their tenant's effective (core + licensed)
 * modules. A permission counts only if its module is licensed to the tenant AND granted to
 * the same role; implied permissions are added. Unknown keys are ignored.
 */
export function computeAccess(
  tenantModules: readonly string[],
  roles: readonly RoleAccessInput[],
): EffectiveAccess {
  const licensed = new Set(tenantModules);
  const portals = new Set<string>();
  const modules = new Set<string>();
  const permissions = new Set<string>();

  for (const role of roles) {
    if (!role.isActive) continue;
    const roleModules = role.isSystem ? [...licensed] : role.modules.filter((m) => licensed.has(m));
    roleModules.forEach((m) => modules.add(m));

    const granted = role.isSystem
      ? PERMISSIONS.filter((p) => licensed.has(p.module)).map((p) => p.key)
      : role.permissions.filter(
          (key) => isPermissionKey(key) && roleModules.includes(permissionModule(key)),
        );
    for (const key of granted) {
      permissions.add(key);
      const def: PermissionDefinition | undefined = PERMISSIONS.find((p) => p.key === key);
      def?.implies?.forEach((implied) => permissions.add(implied));
    }

    for (const portal of role.isSystem ? SYSTEM_ROLE_PORTALS : role.portals) {
      const def = PORTALS.find((p) => p.key === portal);
      if (def && (def.requiresModule === null || licensed.has(def.requiresModule))) {
        portals.add(def.key);
      }
    }
  }

  return {
    portals: PORTALS.filter((p) => portals.has(p.key)).map((p) => p.key),
    modules: MODULES.filter((m) => modules.has(m.key)).map((m) => m.key),
    permissions: PERMISSIONS.filter((p) => permissions.has(p.key)).map((p) => p.key),
  };
}
