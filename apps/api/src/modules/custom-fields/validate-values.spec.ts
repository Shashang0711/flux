import { customFieldKeyFromLabel, validateCustomFieldValues } from '@flux/shared';

const def = (key: string, type: string, extra: Record<string, unknown> = {}) => ({
  key,
  label: key.toUpperCase(),
  type: type as never,
  required: false,
  options: [] as { value: string; label: string }[],
  isActive: true,
  ...extra,
});

const DEFS = [
  def('notes', 'TEXT'),
  def('fleet_size', 'NUMBER'),
  def('since', 'DATE'),
  def('vip', 'BOOLEAN'),
  def('tier', 'SELECT', {
    options: [
      { value: 'gold', label: 'Gold' },
      { value: 'silver', label: 'Silver' },
    ],
  }),
  def('region', 'TEXT', { required: true }),
  def('legacy', 'TEXT', { isActive: false }),
];

describe('validateCustomFieldValues', () => {
  it('accepts and normalises valid values', () => {
    const { values, issues } = validateCustomFieldValues(
      DEFS,
      {
        notes: '  hi ',
        fleet_size: '12',
        since: '2024-02-29',
        vip: true,
        tier: 'gold',
        region: 'EU',
      },
      'create',
    );
    expect(issues).toEqual([]);
    expect(values).toEqual({
      notes: 'hi',
      fleet_size: 12,
      since: '2024-02-29',
      vip: true,
      tier: 'gold',
      region: 'EU',
    });
  });

  it('rejects wrong types, bad dates, unknown options, unknown and inactive fields', () => {
    const { issues } = validateCustomFieldValues(
      DEFS,
      {
        fleet_size: 'many',
        since: '2023-02-29',
        vip: 'yes',
        tier: 'bronze',
        nope: 1,
        legacy: 'x',
        region: 'EU',
      },
      'create',
    );
    expect(Object.fromEntries(issues.map((i) => [i.path, i.message]))).toEqual({
      'customFields.fleet_size': 'Must be a number',
      'customFields.since': 'Must be a date (YYYY-MM-DD)',
      'customFields.vip': 'Must be yes or no',
      'customFields.tier': 'Choose one of the listed options',
      'customFields.nope': 'Unknown custom field',
      'customFields.legacy': 'LEGACY is no longer in use',
    });
  });

  it('requires required fields on create only, but never lets them be cleared', () => {
    expect(validateCustomFieldValues(DEFS, {}, 'create').issues).toEqual([
      { path: 'customFields.region', message: 'REGION is required' },
    ]);
    expect(validateCustomFieldValues(DEFS, {}, 'update').issues).toEqual([]);
    expect(validateCustomFieldValues(DEFS, { region: '' }, 'update').issues).toEqual([
      { path: 'customFields.region', message: 'REGION is required' },
    ]);
  });

  it('turns empty optional values into null (clearing them)', () => {
    expect(
      validateCustomFieldValues(DEFS, { notes: '', fleet_size: null }, 'update').values,
    ).toEqual({
      notes: null,
      fleet_size: null,
    });
  });
});

describe('customFieldKeyFromLabel', () => {
  it('derives a stable key', () => {
    expect(customFieldKeyFromLabel('Vessel class notation')).toBe('vessel_class_notation');
    expect(customFieldKeyFromLabel('  P&I Club! ')).toBe('p_i_club');
    expect(customFieldKeyFromLabel('2nd contact')).toBe('field_2nd_contact');
  });
});
