/**
 * Module catalogue. A tenant can use a module only if it is core or licensed to the tenant
 * (tenant_modules). Keys are stored in the database: never rename one, only add or retire.
 */
export const MODULES = [
  {
    key: 'administration',
    name: 'Administration',
    description: 'Users, roles and audit log',
    core: true,
  },
  {
    key: 'clients',
    name: 'Clients',
    description: 'Client companies, billing parties and contacts',
    core: false,
  },
  {
    key: 'vessels',
    name: 'Vessels & Fleets',
    description: 'Vessel master data, client relationships and fleets',
    core: false,
  },
  {
    key: 'lab-setup',
    name: 'Laboratory Setup',
    description: 'Categories, service types, products, variants and bottle sizes',
    core: false,
  },
  {
    key: 'receiving',
    name: 'Sample Receiving',
    description: 'Airway bills, bulk receiving and receive & register',
    core: false,
  },
  {
    key: 'samples',
    name: 'Sample Management',
    description: 'Registration queue, batches, testing and results',
    core: false,
  },
  {
    key: 'reports',
    name: 'Reports',
    description: 'Lab reports, admin review, publishing and sample status tracking',
    core: false,
  },
  {
    key: 'client-portal',
    name: 'Client Portal',
    description: 'Self-service access for client users',
    core: false,
  },
  {
    key: 'finance',
    name: 'Finance',
    description: 'Invoices and credit notes',
    core: false,
  },
] as const;

export type ModuleKey = (typeof MODULES)[number]['key'];
export type ModuleDefinition = (typeof MODULES)[number];

export const CORE_MODULE_KEYS: readonly ModuleKey[] = MODULES.filter((m) => m.core).map(
  (m) => m.key,
);
export const OPTIONAL_MODULE_KEYS: readonly ModuleKey[] = MODULES.filter((m) => !m.core).map(
  (m) => m.key,
);

export function isModuleKey(value: string): value is ModuleKey {
  return MODULES.some((m) => m.key === value);
}

/** Effective modules for a tenant: core modules plus its licensed optional modules. */
export function effectiveModules(licensed: readonly string[]): ModuleKey[] {
  return MODULES.filter((m) => m.core || licensed.includes(m.key)).map((m) => m.key);
}
