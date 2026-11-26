import { describe, expect, it } from 'vitest';
import { daysBetween, periodOf, shiftPeriod } from '@flux/shared';

describe('Sample Update periods', () => {
  it('months, Monday-to-Sunday weeks and days', () => {
    expect(periodOf('monthly', '2026-02-15')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(periodOf('monthly', '2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(periodOf('weekly', '2026-11-26')).toEqual({ from: '2026-11-23', to: '2026-11-29' }); // Thursday
    expect(periodOf('weekly', '2026-11-29')).toEqual({ from: '2026-11-23', to: '2026-11-29' }); // Sunday
    expect(periodOf('weekly', '2026-12-30')).toEqual({ from: '2026-12-28', to: '2027-01-03' });
    expect(periodOf('daily', '2026-11-26')).toEqual({ from: '2026-11-26', to: '2026-11-26' });
  });

  it('moves between periods', () => {
    expect(shiftPeriod('monthly', '2026-01-31', -1)).toBe('2025-12-01');
    expect(shiftPeriod('monthly', '2026-12-15', 1)).toBe('2027-01-01');
    expect(shiftPeriod('weekly', '2026-11-26', 1)).toBe('2026-12-03');
    expect(shiftPeriod('daily', '2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-11-29', '2026-12-02')).toEqual([
      '2026-11-29',
      '2026-11-30',
      '2026-12-01',
      '2026-12-02',
    ]);
  });
});
