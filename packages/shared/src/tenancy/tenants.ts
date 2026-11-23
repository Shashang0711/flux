import { z } from 'zod';
import { emailSchema, passwordSchema } from '../identity/users';
import { OPTIONAL_MODULE_KEYS, type ModuleKey } from './modules';

export const TenantStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED' } as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

export interface TenantDto {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  /** Licensed optional modules (core modules are always available). */
  modules: ModuleKey[];
  createdAt: string;
  updatedAt: string;
}

/** Lower-case letters, digits and single hyphens; 3–40 characters. */
export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, digits and hyphens')
  .min(3)
  .max(40);

const tenantNameSchema = z.string().trim().min(1, 'Name is required').max(200);

export const optionalModulesSchema = z
  .array(z.enum(OPTIONAL_MODULE_KEYS as [ModuleKey, ...ModuleKey[]]))
  .transform((keys) => [...new Set(keys)]);

/** Creates a tenant together with its first administrator, atomically. */
export const createTenantSchema = z.object({
  name: tenantNameSchema,
  slug: tenantSlugSchema,
  modules: optionalModulesSchema.default([]),
  admin: z.object({
    email: emailSchema,
    name: z.string().trim().min(1, 'Name is required').max(200),
    password: passwordSchema,
  }),
});
export type CreateTenantRequest = z.input<typeof createTenantSchema>;

export const updateTenantSchema = z
  .object({
    name: tenantNameSchema,
    status: z.enum([TenantStatus.ACTIVE, TenantStatus.SUSPENDED]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });
export type UpdateTenantRequest = z.infer<typeof updateTenantSchema>;

export const setTenantModulesSchema = z.object({ modules: optionalModulesSchema });
export type SetTenantModulesRequest = z.input<typeof setTenantModulesSchema>;

export const tenantListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([TenantStatus.ACTIVE, TenantStatus.SUSPENDED]).optional(),
});
export type TenantListFilter = z.infer<typeof tenantListFilterSchema>;
