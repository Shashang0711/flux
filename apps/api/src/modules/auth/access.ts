import {
  computeAccess,
  effectiveModules,
  type PortalKey,
  type RoleAccessInput,
  type SessionAccess,
} from '@flux/shared';

/** The role fields needed to compute access, as loaded with a user's roles. */
export const ROLE_ACCESS_SELECT = {
  isActive: true,
  isSystem: true,
  defaultPortal: true,
  portals: { select: { portal: true } },
  modules: { select: { moduleKey: true } },
  permissions: { select: { permissionKey: true } },
} as const;

export interface LoadedRole {
  isActive: boolean;
  isSystem: boolean;
  defaultPortal: PortalKey;
  portals: { portal: PortalKey }[];
  modules: { moduleKey: string }[];
  permissions: { permissionKey: string }[];
}

export function toRoleAccessInput(role: LoadedRole): RoleAccessInput {
  return {
    isActive: role.isActive,
    isSystem: role.isSystem,
    portals: role.portals.map((p) => p.portal),
    modules: role.modules.map((m) => m.moduleKey),
    permissions: role.permissions.map((p) => p.permissionKey),
  };
}

/**
 * A user's session access. `roles` must be ordered by assignment date: the landing portal is
 * the default portal of the first active role whose default portal the user can enter.
 */
export function buildSessionAccess(
  licensedModuleKeys: readonly string[],
  roles: readonly LoadedRole[],
): SessionAccess {
  const tenantModules = effectiveModules(licensedModuleKeys);
  const access = computeAccess(tenantModules, roles.map(toRoleAccessInput));
  const defaultPortal =
    roles.find((r) => r.isActive && access.portals.includes(r.defaultPortal))?.defaultPortal ??
    access.portals[0] ??
    null;
  return { ...access, defaultPortal };
}

export const NO_ACCESS: SessionAccess = {
  portals: [],
  modules: [],
  permissions: [],
  defaultPortal: null,
};
