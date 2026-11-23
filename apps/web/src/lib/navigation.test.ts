import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@flux/shared';
import { visibleNavigation } from './navigation';

function session(overrides: { isPlatformAdmin?: boolean; permissions?: string[] }): SessionInfo {
  return {
    user: {
      id: 'u',
      email: 'u@x.test',
      name: 'U',
      status: 'ACTIVE',
      isPlatformAdmin: overrides.isPlatformAdmin ?? false,
      roles: [],
      lastLoginAt: null,
      createdAt: '',
      updatedAt: '',
    },
    tenant: overrides.isPlatformAdmin ? null : { id: 't', slug: 't', name: 'T' },
    modules: [],
    access: {
      portals: [],
      modules: [],
      permissions: (overrides.permissions ?? []) as SessionInfo['access']['permissions'],
      defaultPortal: null,
    },
  };
}

const labels = (s: SessionInfo) => visibleNavigation(s).flatMap((g) => g.items.map((i) => i.label));

describe('visibleNavigation', () => {
  it('shows platform screens only to platform admins', () => {
    expect(labels(session({ isPlatformAdmin: true }))).toEqual(['Dashboard', 'Tenants']);
  });

  it('shows administration screens by permission', () => {
    expect(labels(session({ permissions: ['user.view'] }))).toEqual(['Dashboard', 'Users']);
    expect(labels(session({ permissions: ['user.view', 'role.view'] }))).toEqual([
      'Dashboard',
      'Users',
      'Roles',
    ]);
  });

  it('drops empty groups', () => {
    expect(visibleNavigation(session({})).map((g) => g.label)).toEqual(['Overview']);
  });
});
