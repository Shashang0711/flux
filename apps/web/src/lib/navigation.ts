import type { PermissionKey, SessionInfo } from '@flux/shared';
import type { IconName } from '@/components/icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
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
 * Sidebar structure. Later milestones add their screens here (Samples, Reports, ...), each with
 * the permission that gates it and an icon.
 */
export const NAVIGATION: NavGroup[] = [
  { label: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: 'dashboard' }] },
  {
    label: 'Platform',
    items: [
      { href: '/platform/tenants', label: 'Tenants', icon: 'tenants', platformOnly: true },
      {
        href: '/platform/reference-data',
        label: 'Reference data',
        icon: 'reference',
        platformOnly: true,
      },
      { href: '/platform/audit', label: 'Audit log', icon: 'audit', platformOnly: true },
    ],
  },
  {
    label: 'Clients',
    items: [
      { href: '/admin/clients', label: 'Clients', icon: 'clients', permission: 'client.view' },
      { href: '/admin/vessels', label: 'Vessels', icon: 'vessels', permission: 'vessel.view' },
    ],
  },
  {
    label: 'Samples',
    items: [
      { href: '/lab/receiving', label: 'Receiving', icon: 'inbox', permission: 'receiving.view' },
      {
        href: '/lab/registration-queue',
        label: 'Registration queue',
        icon: 'queue',
        permission: 'receiving.view',
      },
      { href: '/lab/batches', label: 'Batches', icon: 'batch', permission: 'sample.view' },
      { href: '/lab/samples', label: 'Samples', icon: 'sample', permission: 'sample.view' },
    ],
  },
  {
    label: 'Lab setup',
    items: [
      {
        href: '/admin/lab/service-types',
        label: 'Service types',
        icon: 'flask',
        permission: 'lab-setup.view',
      },
      { href: '/admin/lab/kits', label: 'Kits', icon: 'kit', permission: 'lab-setup.view' },
      {
        href: '/admin/lab/bottles',
        label: 'Bottle types',
        icon: 'bottle',
        permission: 'lab-setup.view',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      { href: '/admin/users', label: 'Users', icon: 'users', permission: 'user.view' },
      { href: '/admin/roles', label: 'Roles', icon: 'roles', permission: 'role.view' },
      {
        href: '/admin/reference-data',
        label: 'Reference data',
        icon: 'reference',
        permission: 'reference-data.manage',
      },
      {
        href: '/admin/custom-fields',
        label: 'Custom fields',
        icon: 'fields',
        permission: 'custom-field.manage',
      },
      { href: '/admin/audit', label: 'Audit log', icon: 'audit', permission: 'audit.view' },
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
