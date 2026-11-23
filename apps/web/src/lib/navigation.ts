import type { PermissionKey, SessionInfo } from '@flux/shared';

export interface NavItem {
  href: string;
  label: string;
  /** Shown only to platform administrators. */
  platformOnly?: boolean;
  /** Shown only to tenant users holding this permission. */
  permission?: PermissionKey;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Sidebar structure. Later milestones add their screens here (Clients, Vessels, Samples, ...),
 * each with the permission that gates it.
 */
export const NAVIGATION: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard' }] },
  {
    label: 'Platform',
    items: [
      { href: '/platform/tenants', label: 'Tenants', platformOnly: true },
      { href: '/platform/reference-data', label: 'Reference data', platformOnly: true },
      { href: '/platform/audit', label: 'Audit log', platformOnly: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users', permission: 'user.view' },
      { href: '/admin/roles', label: 'Roles', permission: 'role.view' },
      {
        href: '/admin/reference-data',
        label: 'Reference data',
        permission: 'reference-data.manage',
      },
      { href: '/admin/audit', label: 'Audit log', permission: 'audit.view' },
    ],
  },
];

export function canSee(item: NavItem, session: SessionInfo): boolean {
  if (item.platformOnly) return session.user.isPlatformAdmin;
  if (item.permission) return session.access.permissions.includes(item.permission);
  return true;
}

/** The navigation this user may see; empty groups are dropped. */
export function visibleNavigation(session: SessionInfo): NavGroup[] {
  return NAVIGATION.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(item, session)),
  })).filter((group) => group.items.length > 0);
}
