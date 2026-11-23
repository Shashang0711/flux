import { z } from 'zod';
import { MODULES, type ModuleKey } from '../tenancy/modules';
import {
  PERMISSION_KEYS,
  PORTAL_KEYS,
  type EffectiveAccess,
  type PermissionKey,
  type PortalKey,
} from './catalogue';

export interface RoleSummaryDto {
  id: string;
  name: string;
  description: string | null;
  defaultPortal: PortalKey;
  isActive: boolean;
  /** The built-in Administrator role: all licensed access, cannot be changed. */
  isSystem: boolean;
  userCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleDto extends RoleSummaryDto {
  portals: PortalKey[];
  modules: ModuleKey[];
  permissions: PermissionKey[];
}

export interface RoleUserDto {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  assignedAt: string;
}

const MODULE_KEYS = MODULES.map((m) => m.key) as [ModuleKey, ...ModuleKey[]];
const unique = <T>(values: T[]): T[] => [...new Set(values)];

export const portalsSchema = z.array(z.enum(PORTAL_KEYS)).transform(unique);
export const roleModulesSchema = z.array(z.enum(MODULE_KEYS)).transform(unique);
export const rolePermissionsSchema = z.array(z.enum(PERMISSION_KEYS)).transform(unique);

const roleNameSchema = z.string().trim().min(1, 'Name is required').max(100);
const descriptionSchema = z.string().trim().max(500).nullable();

export const createRoleSchema = z
  .object({
    name: roleNameSchema,
    description: descriptionSchema.optional(),
    defaultPortal: z.enum(PORTAL_KEYS),
    isActive: z.boolean().default(true),
    portals: portalsSchema.optional(),
    modules: roleModulesSchema.default([]),
    permissions: rolePermissionsSchema.default([]),
  })
  .transform((role) => ({ ...role, portals: role.portals ?? [role.defaultPortal] }))
  .refine((role) => role.portals.includes(role.defaultPortal), {
    message: 'The default portal must be one of the role’s portals',
    path: ['defaultPortal'],
  });
export type CreateRoleRequest = z.input<typeof createRoleSchema>;

export const updateRoleSchema = z
  .object({
    name: roleNameSchema,
    description: descriptionSchema,
    defaultPortal: z.enum(PORTAL_KEYS),
    isActive: z.boolean(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const setRolePortalsSchema = z.object({
  portals: portalsSchema.refine((p) => p.length > 0, 'A role needs at least one portal'),
});
export const setRoleModulesSchema = z.object({ modules: roleModulesSchema });
export const setRolePermissionsSchema = z.object({ permissions: rolePermissionsSchema });

/** Clone From → New Role Name, with the copy options from the role specification. */
export const cloneRoleSchema = z.object({
  name: roleNameSchema,
  copyPortals: z.boolean().default(true),
  copyModules: z.boolean().default(true),
  copyPermissions: z.boolean().default(true),
});
export type CloneRoleRequest = z.input<typeof cloneRoleSchema>;

export const roleUserIdsSchema = z.object({
  userIds: z.array(z.uuid()).min(1).max(500).transform(unique),
});
export const setUserRolesSchema = z.object({
  roleIds: z.array(z.uuid()).max(100).transform(unique),
});

export const roleListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type RoleListFilter = z.infer<typeof roleListFilterSchema>;

/** The caller's access, in GET /auth/me. */
export interface SessionAccess extends EffectiveAccess {
  /** Landing portal: the default portal of the user's first active role, if any. */
  defaultPortal: PortalKey | null;
}
