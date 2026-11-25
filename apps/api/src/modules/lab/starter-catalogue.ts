import type { CustomFieldType, RegistrationFieldScope } from '@prisma/client';

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
  fields: StarterField[];
}[] = [
  {
    category: 'WATER',
    code: 'BW',
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
