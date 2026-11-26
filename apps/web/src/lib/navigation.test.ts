import { describe, expect, it } from 'vitest';
import type { SessionInfo } from '@flux/shared';
import { visibleNavigation } from './navigation';

function session(overrides: {
  isPlatformAdmin?: boolean;
  permissions?: string[];
  client?: boolean;
}): SessionInfo {
  return {
    user: {
      id: 'u',
      email: 'u@x.test',
      name: 'U',
      status: 'ACTIVE',
      isPlatformAdmin: overrides.isPlatformAdmin ?? false,
      roles: [],
      clientId: overrides.client ? 'c' : null,
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
    client: overrides.client ? { id: 'c', code: 'C-1', name: 'Client' } : null,
  };
}

const labels = (s: SessionInfo) => visibleNavigation(s).flatMap((g) => g.items.map((i) => i.label));

describe('visibleNavigation', () => {
  it('shows client users the client portal only', () => {
    expect(labels(session({ client: true, permissions: ['client-portal.view'] }))).toEqual([
      'Overview',
      'Samples',
      'Reports',
    ]);
    // Even a stray staff permission never shows staff screens to a client user.
    expect(labels(session({ client: true, permissions: ['user.view'] }))).toEqual([]);
  });

  it('shows platform screens only to platform admins', () => {
    expect(labels(session({ isPlatformAdmin: true }))).toEqual([
      'Dashboard',
      'Tenants',
      'Reference data',
      'Audit log',
    ]);
  });

  it('shows administration screens by permission', () => {
    expect(labels(session({ permissions: ['user.view'] }))).toEqual(['Dashboard', 'Users']);
    expect(labels(session({ permissions: ['user.view', 'role.view', 'audit.view'] }))).toEqual([
      'Dashboard',
      'Users',
      'Roles',
      'Audit log',
    ]);
  });

  it('shows an item that needs several permissions only when all are held', () => {
    expect(labels(session({ permissions: ['sample.register'] }))).not.toContain(
      'Receive & register',
    );
    expect(labels(session({ permissions: ['receiving.receive', 'sample.register'] }))).toContain(
      'Receive & register',
    );
  });

  it('drops empty groups', () => {
    expect(visibleNavigation(session({})).map((g) => g.label)).toEqual(['Overview']);
  });
});
