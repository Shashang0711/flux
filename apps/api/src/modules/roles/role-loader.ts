import { HttpStatus } from '@nestjs/common';
import { ErrorCode, type ModuleKey, type PermissionKey, type PortalKey } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { TenantTx } from '../../database/tenant-db.service';
import { systemRoleGrant, type RoleGrant } from './role-rules';

export const ROLE_GRANT_INCLUDE = {
  portals: { select: { portal: true } },
  modules: { select: { moduleKey: true } },
  permissions: { select: { permissionKey: true } },
} as const;

export interface RoleWithGrantRows {
  isSystem: boolean;
  portals: { portal: PortalKey }[];
  modules: { moduleKey: string }[];
  permissions: { permissionKey: string }[];
}

/** What a role grants (stored rows, or everything licensed for the Administrator role). */
export function grantOf(role: RoleWithGrantRows, licensed: readonly ModuleKey[]): RoleGrant {
  if (role.isSystem) return systemRoleGrant(licensed);
  return {
    portals: role.portals.map((p) => p.portal),
    modules: role.modules.map((m) => m.moduleKey as ModuleKey),
    permissions: role.permissions.map((p) => p.permissionKey as PermissionKey),
  };
}

/** Loads roles of the tenant in scope by id; any unknown id is a validation error. */
export async function loadRolesForAssignment(
  tx: TenantTx,
  roleIds: string[],
  path = 'roleIds',
): Promise<(RoleWithGrantRows & { id: string; name: string })[]> {
  if (roleIds.length === 0) return [];
  const roles = await tx.role.findMany({
    where: { id: { in: roleIds } },
    include: ROLE_GRANT_INCLUDE,
  });
  const missing = roleIds.filter((id) => !roles.some((r) => r.id === id));
  if (missing.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Unknown role',
      missing.map((id) => ({ path: `${path}.${roleIds.indexOf(id)}`, message: 'Role not found' })),
    );
  }
  return roles;
}
