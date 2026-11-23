import { z } from 'zod';
import type { ModuleKey } from '../tenancy/modules';

/**
 * Reference lists. Items come from FLUX defaults (platform, shared by every tenant) plus each
 * tenant's own additions. Adding a list needs only an entry here: no migration.
 * Keys are stored in the database: never rename one.
 */
export const REFERENCE_LISTS = [
  {
    key: 'vessel-type',
    name: 'Vessel types',
    itemName: 'vessel type',
    module: 'vessels',
    description: 'Used when creating vessels (e.g. Bulk Carrier, Oil Tanker)',
  },
  {
    key: 'classification-society',
    name: 'Classification societies',
    itemName: 'classification society',
    module: 'vessels',
    description: 'The society a vessel is classed with',
  },
  {
    key: 'vessel-relationship-type',
    name: 'Vessel relationship types',
    itemName: 'relationship type',
    module: 'vessels',
    description: 'How a client relates to a vessel (e.g. Ship Owner, Ship Manager)',
  },
] as const satisfies readonly {
  key: string;
  name: string;
  itemName: string;
  module: ModuleKey;
  description: string;
}[];

export type ReferenceListKey = (typeof REFERENCE_LISTS)[number]['key'];
export const REFERENCE_LIST_KEYS = REFERENCE_LISTS.map((l) => l.key) as [
  ReferenceListKey,
  ...ReferenceListKey[],
];

export function referenceList(key: ReferenceListKey) {
  return REFERENCE_LISTS.find((l) => l.key === key)!;
}

export interface ReferenceItemDto {
  id: string;
  list: ReferenceListKey;
  code: string;
  name: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  /** PLATFORM: a FLUX default shared by all tenants. TENANT: the tenant's own item. */
  source: 'PLATFORM' | 'TENANT';
  /** Platform items a tenant has chosen not to use. Always false for TENANT items. */
  hidden: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Short identifier: upper-case letters, digits, hyphens and underscores. */
export const referenceCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, digits, hyphens and underscores')
  .max(40);

export const createReferenceItemSchema = z.object({
  code: referenceCodeSchema,
  name: z.string().trim().min(1, 'Name is required').max(200),
  description: z.string().trim().max(500).nullable().optional(),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
});
export type CreateReferenceItemRequest = z.input<typeof createReferenceItemSchema>;

export const updateReferenceItemSchema = z
  .object({
    code: referenceCodeSchema,
    name: z.string().trim().min(1, 'Name is required').max(200),
    description: z.string().trim().max(500).nullable(),
    sortOrder: z.number().int().min(0).max(100_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateReferenceItemRequest = z.infer<typeof updateReferenceItemSchema>;

export const referenceVisibilitySchema = z.object({ hidden: z.boolean() });

export const referenceListQuerySchema = z.object({
  /**
   * all: everything, for management screens. Default (usable): only active, non-hidden items,
   * for dropdowns.
   */
  view: z.enum(['usable', 'all']).default('usable'),
});
export type ReferenceListQuery = z.infer<typeof referenceListQuerySchema>;
