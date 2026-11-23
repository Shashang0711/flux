import { compactChanges, fieldChanges, listChange } from './audit';

describe('audit diff helpers', () => {
  it('reports only changed fields, with dates as ISO strings', () => {
    const before = { name: 'A', email: 'a@x', at: new Date('2026-01-01T00:00:00Z') };
    const after = { name: 'B', email: 'a@x', at: new Date('2026-01-02T00:00:00Z') };
    expect(fieldChanges(before, after, ['name', 'email', 'at'])).toEqual({
      name: { from: 'A', to: 'B' },
      at: { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' },
    });
  });

  it('treats a missing "before" as creation', () => {
    expect(fieldChanges(null, { name: 'A' }, ['name'])).toEqual({ name: { from: null, to: 'A' } });
  });

  it('diffs lists and ignores order', () => {
    expect(listChange(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(listChange(['a', 'b'], ['b', 'a'])).toBeUndefined();
  });

  it('compacts to null when nothing changed', () => {
    expect(compactChanges({ roles: undefined })).toBeNull();
    expect(compactChanges({ roles: { added: ['x'], removed: [] } })).toEqual({
      roles: { added: ['x'], removed: [] },
    });
  });
});
