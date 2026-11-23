import { computeAccess } from '@flux/shared';
import { buildSessionAccess } from './access';

const role = (overrides: Partial<Parameters<typeof computeAccess>[1][number]> = {}) => ({
  isActive: true,
  isSystem: false,
  portals: [] as string[],
  modules: [] as string[],
  permissions: [] as string[],
  ...overrides,
});

describe('computeAccess', () => {
  it('grants a permission only if its module is on the same role and licensed', () => {
    const access = computeAccess(
      ['administration', 'samples'],
      [
        role({ modules: ['samples'], permissions: ['sample.test', 'report.view'] }),
        role({ modules: ['reports'], permissions: ['report.view'] }),
      ],
    );
    expect(access.permissions).toEqual(['sample.view', 'sample.test']);
    expect(access.modules).toEqual(['samples']);
  });

  it('adds implied permissions', () => {
    const access = computeAccess(
      ['administration'],
      [role({ modules: ['administration'], permissions: ['user.manage'] })],
    );
    expect(access.permissions).toEqual(['user.view', 'user.manage', 'role.view']);
  });

  it('ignores inactive roles and unknown keys', () => {
    const access = computeAccess(
      ['administration'],
      [
        role({ isActive: false, modules: ['administration'], permissions: ['user.view'] }),
        role({ modules: ['administration'], permissions: ['does.not.exist'] }),
      ],
    );
    expect(access.permissions).toEqual([]);
  });

  it('gives the system role everything licensed, and internal portals only', () => {
    const access = computeAccess(
      ['administration', 'finance', 'client-portal'],
      [role({ isSystem: true })],
    );
    expect(access.portals).toEqual(['ADMIN', 'LAB', 'FINANCE']);
    expect(access.permissions).toEqual(
      expect.arrayContaining(['invoice.manage', 'client-portal.view', 'role.manage']),
    );
    expect(access.permissions).not.toContain('sample.view');
  });

  it('drops portals whose module is not licensed', () => {
    const access = computeAccess(
      ['administration'],
      [role({ portals: ['CLIENT', 'LAB', 'FINANCE'] })],
    );
    expect(access.portals).toEqual(['LAB']);
  });
});

describe('buildSessionAccess', () => {
  const loaded = (defaultPortal: 'ADMIN' | 'LAB' | 'FINANCE', isActive = true) => ({
    isActive,
    isSystem: false,
    defaultPortal,
    portals: [{ portal: defaultPortal }],
    modules: [],
    permissions: [],
  });

  it('lands on the first active role’s default portal', () => {
    expect(buildSessionAccess([], [loaded('LAB', false), loaded('ADMIN')]).defaultPortal).toBe(
      'ADMIN',
    );
  });

  it('skips a default portal the tenant is not licensed for', () => {
    expect(buildSessionAccess([], [loaded('FINANCE'), loaded('LAB')]).defaultPortal).toBe('LAB');
  });

  it('has no landing portal without roles', () => {
    expect(buildSessionAccess([], []).defaultPortal).toBeNull();
  });
});
