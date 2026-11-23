import { HttpStatus } from '@nestjs/common';
import {
  ErrorCode,
  PERMISSIONS,
  PORTALS,
  SYSTEM_ROLE_PORTALS,
  computeAccess,
  effectiveModules,
  permissionModule,
  type FieldIssue,
  type ModuleKey,
  type PermissionKey,
  type PortalKey,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { TenantTx } from '../../database/tenant-db.service';
import type { AuthUser } from '../auth/auth.types';

/** Effective (core + licensed) modules of the tenant in scope. RLS limits the query to it. */
export async function tenantModules(tx: TenantTx): Promise<ModuleKey[]> {
  const rows = await tx.tenantModule.findMany({ select: { moduleKey: true } });
  return effectiveModules(rows.map((r) => r.moduleKey));
}

export interface RoleGrant {
  portals: PortalKey[];
  modules: ModuleKey[];
  permissions: PermissionKey[];
}

/** What the built-in Administrator role grants right now: everything licensed. */
export function systemRoleGrant(licensed: readonly ModuleKey[]): RoleGrant {
  return {
    portals: SYSTEM_ROLE_PORTALS.filter((key) => {
      const portal = PORTALS.find((p) => p.key === key)!;
      return portal.requiresModule === null || licensed.includes(portal.requiresModule);
    }),
    modules: [...licensed],
    permissions: PERMISSIONS.filter((p) => licensed.includes(p.module)).map((p) => p.key),
  };
}

/**
 * Rule 1: a role may only grant what the tenant is licensed for, and each permission's
 * module must be granted by the same role.
 */
export function assertGrantIsValid(
  grant: Partial<RoleGrant>,
  licensed: readonly ModuleKey[],
): void {
  const issues: FieldIssue[] = [];
  grant.portals?.forEach((key, i) => {
    const portal = PORTALS.find((p) => p.key === key)!;
    if (portal.requiresModule && !licensed.includes(portal.requiresModule)) {
      issues.push({
        path: `portals.${i}`,
        message: `${portal.name} requires a module your organisation does not have`,
      });
    }
  });
  grant.modules?.forEach((key, i) => {
    if (!licensed.includes(key)) {
      issues.push({ path: `modules.${i}`, message: `Module '${key}' is not licensed` });
    }
  });
  if (grant.permissions && grant.modules) {
    const modules = grant.modules;
    grant.permissions.forEach((key, i) => {
      if (!modules.includes(permissionModule(key))) {
        issues.push({
          path: `permissions.${i}`,
          message: `'${key}' needs the '${permissionModule(key)}' module on this role`,
        });
      }
    });
  }
  if (issues.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'The role grants access that is not allowed',
      issues,
    );
  }
}

/**
 * Rule 2 (no privilege escalation): a user can only grant, through a role definition or a
 * role assignment, permissions they hold themselves.
 */
export function assertNoEscalation(
  actor: AuthUser,
  grant: Pick<RoleGrant, 'modules' | 'permissions'>,
  licensed: readonly ModuleKey[],
): void {
  const granted = computeAccess(licensed, [
    {
      isActive: true,
      isSystem: false,
      portals: [],
      modules: grant.modules,
      permissions: grant.permissions,
    },
  ]).permissions;
  const missing = granted.filter((p) => !actor.access.permissions.includes(p));
  if (missing.length > 0) {
    throw AppException.forbidden(
      `You cannot grant permissions you do not have yourself: ${missing.join(', ')}`,
    );
  }
}

/**
 * Rule 3: the tenant must always keep at least one active user with the Administrator role.
 * Locks the Administrator role row, so concurrent removals are serialised.
 */
export async function assertAdministratorRemains(
  tx: TenantTx,
  change: { removingUserIds: string[] },
): Promise<void> {
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM roles WHERE is_system FOR UPDATE`;
  const systemRoleId = locked[0]?.id;
  if (!systemRoleId) return;
  const remaining = await tx.userRole.count({
    where: {
      roleId: systemRoleId,
      userId: { notIn: change.removingUserIds },
      user: { status: 'ACTIVE' },
    },
  });
  if (remaining === 0) {
    throw AppException.conflict('Your organisation must keep at least one active Administrator');
  }
}
