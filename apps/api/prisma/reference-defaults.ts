import type { ReferenceListKey } from '@flux/shared';

/**
 * FLUX default reference data, created by the seed when missing (matched by list + code).
 * Existing items are never overwritten: platform admins may have edited them since.
 */
export const REFERENCE_DEFAULTS: Record<ReferenceListKey, { code: string; name: string }[]> = {
  'vessel-type': [
    { code: 'BULK', name: 'Bulk Carrier' },
    { code: 'OIL-TANKER', name: 'Oil Tanker' },
    { code: 'CHEM-TANKER', name: 'Chemical Tanker' },
    { code: 'PRODUCT-TANKER', name: 'Product Tanker' },
    { code: 'CONTAINER', name: 'Container Ship' },
    { code: 'LNG', name: 'LNG Carrier' },
    { code: 'LPG', name: 'LPG Carrier' },
    { code: 'GENERAL-CARGO', name: 'General Cargo' },
    { code: 'RO-RO', name: 'Ro-Ro Cargo' },
    { code: 'CAR-CARRIER', name: 'Vehicle Carrier' },
    { code: 'PASSENGER', name: 'Passenger / Cruise Ship' },
    { code: 'OFFSHORE', name: 'Offshore Support Vessel' },
    { code: 'TUG', name: 'Tug' },
    { code: 'DREDGER', name: 'Dredger' },
    { code: 'FISHING', name: 'Fishing Vessel' },
    { code: 'OTHER', name: 'Other' },
  ],
  'classification-society': [
    { code: 'ABS', name: 'American Bureau of Shipping' },
    { code: 'BV', name: 'Bureau Veritas' },
    { code: 'CCS', name: 'China Classification Society' },
    { code: 'CRS', name: 'Croatian Register of Shipping' },
    { code: 'DNV', name: 'DNV' },
    { code: 'IRS', name: 'Indian Register of Shipping' },
    { code: 'KR', name: 'Korean Register' },
    { code: 'LR', name: "Lloyd's Register" },
    { code: 'NK', name: 'ClassNK' },
    { code: 'PRS', name: 'Polish Register of Shipping' },
    { code: 'RINA', name: 'RINA' },
  ],
  'vessel-relationship-type': [
    { code: 'OWNER', name: 'Ship Owner' },
    { code: 'MANAGER', name: 'Ship Manager' },
    { code: 'TECH-MANAGER', name: 'Technical Manager' },
    { code: 'COMM-MANAGER', name: 'Commercial Manager' },
    { code: 'CHARTERER', name: 'Charterer' },
    { code: 'OPERATOR', name: 'Operator' },
  ],
};
