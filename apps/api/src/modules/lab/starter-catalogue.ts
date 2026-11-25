import type { CustomFieldType, ParameterType, RegistrationFieldScope } from '@prisma/client';

/** A starter test parameter; limits bound the acceptable range (outside = flagged). */
export interface StarterParameter {
  key: string;
  name: string;
  unit?: string;
  type: ParameterType;
  decimals?: number;
  method?: string;
  options?: string[];
  cautionMin?: number;
  cautionMax?: number;
  criticalMin?: number;
  criticalMax?: number;
  required?: boolean;
}

/**
 * Typical parameters per starter service type. Ballast water follows the IMO D-2 standard
 * (e.g. fewer than 10 viable organisms ≥ 50 µm per m³); others are common marine practice.
 * Every lab should review limits against its own methods and contracts.
 */
export const STARTER_PARAMETERS: Record<string, StarterParameter[]> = {
  BW: [
    {
      key: 'org_50',
      name: 'Viable organisms ≥ 50 µm',
      unit: 'per m³',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 5,
      criticalMax: 9,
      required: true,
    },
    {
      key: 'org_10_50',
      name: 'Viable organisms 10–50 µm',
      unit: 'per ml',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 5,
      criticalMax: 9,
      required: true,
    },
    {
      key: 'e_coli',
      name: 'E. coli',
      unit: 'cfu/100 ml',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 125,
      criticalMax: 249,
      required: true,
    },
    {
      key: 'enterococci',
      name: 'Intestinal Enterococci',
      unit: 'cfu/100 ml',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 50,
      criticalMax: 99,
      required: true,
    },
    { key: 'v_cholerae', name: 'Toxicogenic Vibrio cholerae', type: 'PASS_FAIL', required: true },
  ],
  PW: [
    {
      key: 'e_coli',
      name: 'E. coli',
      unit: 'cfu/100 ml',
      type: 'NUMBER',
      decimals: 0,
      criticalMax: 0,
      required: true,
    },
    {
      key: 'coliforms',
      name: 'Total coliforms',
      unit: 'cfu/100 ml',
      type: 'NUMBER',
      decimals: 0,
      criticalMax: 0,
      required: true,
    },
    {
      key: 'ph',
      name: 'pH',
      type: 'NUMBER',
      decimals: 1,
      cautionMin: 6.5,
      cautionMax: 9.5,
      criticalMin: 6,
      criticalMax: 10,
    },
    {
      key: 'free_chlorine',
      name: 'Free chlorine',
      unit: 'mg/l',
      type: 'NUMBER',
      decimals: 2,
      cautionMin: 0.2,
      cautionMax: 5,
    },
  ],
  GW: [
    {
      key: 'thermo_coliforms',
      name: 'Thermotolerant coliforms',
      unit: 'cfu/100 ml',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 50,
      criticalMax: 100,
      required: true,
    },
    {
      key: 'tss',
      name: 'Total suspended solids',
      unit: 'mg/l',
      type: 'NUMBER',
      decimals: 0,
      cautionMax: 25,
      criticalMax: 35,
    },
    {
      key: 'ph',
      name: 'pH',
      type: 'NUMBER',
      decimals: 1,
      cautionMin: 6.5,
      cautionMax: 8.5,
      criticalMin: 6,
      criticalMax: 9,
    },
  ],
  LO: [
    {
      key: 'viscosity_40',
      name: 'Viscosity at 40 °C',
      unit: 'cSt',
      type: 'NUMBER',
      decimals: 1,
      method: 'ASTM D445',
      cautionMin: 90,
      cautionMax: 110,
      criticalMin: 80,
      criticalMax: 120,
      required: true,
    },
    {
      key: 'water',
      name: 'Water content',
      unit: '%',
      type: 'NUMBER',
      decimals: 2,
      method: 'ASTM D6304',
      cautionMax: 0.2,
      criticalMax: 0.5,
      required: true,
    },
    {
      key: 'iron',
      name: 'Iron (Fe)',
      unit: 'ppm',
      type: 'NUMBER',
      decimals: 0,
      method: 'ASTM D5185',
      cautionMax: 50,
      criticalMax: 100,
    },
    {
      key: 'appearance',
      name: 'Appearance',
      type: 'CHOICE',
      options: ['Clear', 'Hazy', 'Dark', 'Emulsified'],
    },
  ],
  FO: [
    {
      key: 'density_15',
      name: 'Density at 15 °C',
      unit: 'kg/m³',
      type: 'NUMBER',
      decimals: 1,
      method: 'ISO 12185',
      criticalMax: 991,
      required: true,
    },
    {
      key: 'viscosity_50',
      name: 'Viscosity at 50 °C',
      unit: 'cSt',
      type: 'NUMBER',
      decimals: 1,
      method: 'ISO 3104',
      criticalMax: 380,
      required: true,
    },
    {
      key: 'sulphur',
      name: 'Sulphur',
      unit: '% m/m',
      type: 'NUMBER',
      decimals: 2,
      method: 'ISO 8754',
      cautionMax: 0.45,
      criticalMax: 0.5,
      required: true,
    },
    {
      key: 'water',
      name: 'Water',
      unit: '% V/V',
      type: 'NUMBER',
      decimals: 2,
      method: 'ISO 3733',
      cautionMax: 0.3,
      criticalMax: 0.5,
    },
  ],
};

/**
 * FLUX starter catalogue (design pack §7 examples). Imported as a copy the lab then owns and
 * edits; codes are the identity, so importing again only adds what is missing.
 */
interface StarterField {
  key: string;
  label: string;
  type: CustomFieldType;
  scope: RegistrationFieldScope;
  required?: boolean;
  options?: { value: string; label: string }[];
  helpText?: string;
}

const dateSampled: StarterField = {
  key: 'date_sampled',
  label: 'Date sampled',
  type: 'DATE',
  scope: 'SAMPLE',
  required: true,
};

export const STARTER_CATEGORIES = [
  { code: 'WATER', name: 'Water', sortOrder: 10 },
  { code: 'LUBE', name: 'Lubricating Oil', sortOrder: 20 },
  { code: 'FUEL', name: 'Fuel', sortOrder: 30 },
] as const;

export const STARTER_SERVICE_TYPES: {
  category: string;
  code: string;
  name: string;
  sortOrder: number;
  vesselRequired: boolean;
  fields: StarterField[];
}[] = [
  {
    category: 'WATER',
    code: 'BW',
    vesselRequired: true,
    name: 'Ballast Water',
    sortOrder: 10,
    fields: [
      { key: 'port_of_sampling', label: 'Port of sampling', type: 'TEXT', scope: 'BATCH' },
      {
        key: 'sampling_point',
        label: 'Sampling point',
        type: 'SELECT',
        scope: 'SAMPLE',
        required: true,
        options: [
          { value: 'intake', label: 'Intake' },
          { value: 'discharge', label: 'Discharge' },
          { value: 'tank', label: 'Ballast tank' },
        ],
      },
      dateSampled,
      {
        key: 'treatment_running',
        label: 'Treatment system running',
        type: 'BOOLEAN',
        scope: 'SAMPLE',
      },
    ],
  },
  {
    category: 'WATER',
    code: 'PW',
    vesselRequired: false,
    name: 'Potable Water',
    sortOrder: 20,
    fields: [
      {
        key: 'sampling_point',
        label: 'Sampling point',
        type: 'TEXT',
        scope: 'SAMPLE',
        required: true,
      },
      dateSampled,
      {
        key: 'free_chlorine',
        label: 'Free chlorine at sampling (mg/l)',
        type: 'NUMBER',
        scope: 'SAMPLE',
      },
    ],
  },
  {
    category: 'WATER',
    code: 'GW',
    vesselRequired: false,
    name: 'Grey Water',
    sortOrder: 30,
    fields: [
      {
        key: 'sampling_point',
        label: 'Sampling point',
        type: 'TEXT',
        scope: 'SAMPLE',
        required: true,
      },
      dateSampled,
    ],
  },
  {
    category: 'LUBE',
    code: 'LO',
    vesselRequired: true,
    name: 'Lubricating Oil Analysis',
    sortOrder: 10,
    fields: [
      {
        key: 'equipment',
        label: 'Equipment',
        type: 'TEXT',
        scope: 'SAMPLE',
        required: true,
        helpText: 'e.g. Main engine, Aux engine 2',
      },
      { key: 'oil_brand', label: 'Oil brand and grade', type: 'TEXT', scope: 'SAMPLE' },
      { key: 'running_hours', label: 'Hours since oil change', type: 'NUMBER', scope: 'SAMPLE' },
      dateSampled,
    ],
  },
  {
    category: 'FUEL',
    code: 'FO',
    vesselRequired: true,
    name: 'Fuel Oil Analysis',
    sortOrder: 10,
    fields: [
      { key: 'bunker_port', label: 'Bunkering port', type: 'TEXT', scope: 'BATCH' },
      { key: 'bdn_number', label: 'Bunker delivery note no.', type: 'TEXT', scope: 'SAMPLE' },
      {
        key: 'grade',
        label: 'Fuel grade',
        type: 'SELECT',
        scope: 'SAMPLE',
        required: true,
        options: [
          { value: 'vlsfo', label: 'VLSFO' },
          { value: 'hsfo', label: 'HSFO' },
          { value: 'ulsfo', label: 'ULSFO' },
          { value: 'mgo', label: 'MGO' },
        ],
      },
      dateSampled,
    ],
  },
];

export const STARTER_BOTTLE_TYPES = [
  { code: 'PET-1000', name: '1 L PET bottle', volumeMl: 1000, material: 'PET' },
  { code: 'PET-500', name: '500 ml PET bottle', volumeMl: 500, material: 'PET' },
  {
    code: 'STER-250',
    name: '250 ml sterile bottle',
    volumeMl: 250,
    material: 'Polypropylene, sterile',
  },
  { code: 'OIL-120', name: '120 ml oil sample bottle', volumeMl: 120, material: 'HDPE' },
] as const;

type Line = { bottle: string; quantity: number };

export const STARTER_PRODUCTS: {
  code: string;
  name: string;
  serviceTypes: string[];
  bottles: Line[];
  variants: { code: string; name: string; bottles?: Line[] }[];
}[] = [
  {
    code: 'BWK',
    name: 'Ballast Water Kit',
    serviceTypes: ['BW'],
    bottles: [{ bottle: 'PET-1000', quantity: 2 }],
    variants: [
      { code: 'UV', name: 'UV' },
      {
        code: 'ELEC',
        name: 'Electrolysis',
        bottles: [
          { bottle: 'PET-1000', quantity: 2 },
          { bottle: 'STER-250', quantity: 1 },
        ],
      },
      { code: 'OZONE', name: 'Ozone' },
    ],
  },
  {
    code: 'WQK',
    name: 'Water Quality Kit',
    serviceTypes: ['PW', 'GW'],
    bottles: [
      { bottle: 'PET-500', quantity: 1 },
      { bottle: 'STER-250', quantity: 1 },
    ],
    variants: [],
  },
  {
    code: 'LOK',
    name: 'Lube Oil Kit',
    serviceTypes: ['LO'],
    bottles: [{ bottle: 'OIL-120', quantity: 1 }],
    variants: [],
  },
  {
    code: 'FOK',
    name: 'Fuel Oil Kit',
    serviceTypes: ['FO'],
    bottles: [{ bottle: 'PET-500', quantity: 1 }],
    variants: [],
  },
];
