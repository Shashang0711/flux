import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each([
    ['/admin/users?page=2', '/admin/users?page=2'],
    ['/', '/'],
  ])('keeps relative path %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    [null],
    [''],
    ['https://evil.example'],
    ['//evil.example'],
    ['/\\evil.example'],
    ['javascript:alert(1)'],
  ])('falls back to / for %s', (input) => {
    expect(safeNextPath(input)).toBe('/');
  });
});
