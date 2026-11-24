import { z } from 'zod';
import type { FieldIssue } from '../api/errors';
import type { ModuleKey } from '../tenancy/modules';

/** Record types that can carry custom fields. Add vessels, samples, … here later. */
export const CUSTOM_FIELD_ENTITIES = [
  { key: 'client', name: 'Clients', module: 'clients' },
  { key: 'vessel', name: 'Vessels', module: 'vessels' },
] as const satisfies readonly {
  key: string;
  name: string;
  module: ModuleKey;
}[];
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number]['key'];
export const CUSTOM_FIELD_ENTITY_KEYS = CUSTOM_FIELD_ENTITIES.map((e) => e.key) as [
  CustomFieldEntity,
  ...CustomFieldEntity[],
];

export const CUSTOM_FIELD_TYPES = [
  { key: 'TEXT', name: 'Short text' },
  { key: 'LONG_TEXT', name: 'Long text' },
  { key: 'NUMBER', name: 'Number' },
  { key: 'DATE', name: 'Date' },
  { key: 'BOOLEAN', name: 'Yes / no' },
  { key: 'SELECT', name: 'Dropdown' },
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]['key'];
export const CUSTOM_FIELD_TYPE_KEYS = CUSTOM_FIELD_TYPES.map((t) => t.key) as [
  CustomFieldType,
  ...CustomFieldType[],
];

export const MAX_CUSTOM_FIELDS_PER_ENTITY = 50;

export interface CustomFieldOption {
  value: string;
  label: string;
}

export interface CustomFieldDefinitionDto {
  id: string;
  entity: CustomFieldEntity;
  /** Stable identifier used to store values; never changes. */
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  helpText: string | null;
  /** SELECT fields only. */
  options: CustomFieldOption[];
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Values as stored on a record: { [key]: value }. */
export type CustomFieldValues = Record<string, string | number | boolean | null>;

// ─── Definition schemas ─────────────────────────────────────────────────────

const keySchema = z
  .string()
  .trim()
  .regex(
    /^[a-z][a-z0-9_]*$/,
    'Use lower-case letters, digits and underscores, starting with a letter',
  )
  .max(50);

const optionsSchema = z
  .array(
    z.object({
      value: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(100),
    }),
  )
  .max(100)
  .refine((opts) => new Set(opts.map((o) => o.value)).size === opts.length, {
    message: 'Option values must be unique',
  });

export const createCustomFieldSchema = z
  .object({
    entity: z.enum(CUSTOM_FIELD_ENTITY_KEYS),
    /** Optional: derived from the label when omitted. */
    key: keySchema.optional(),
    label: z.string().trim().min(1, 'Label is required').max(100),
    type: z.enum(CUSTOM_FIELD_TYPE_KEYS),
    required: z.boolean().default(false),
    helpText: z.string().trim().max(300).nullable().optional(),
    options: optionsSchema.default([]),
    sortOrder: z.number().int().min(0).max(100_000).default(0),
  })
  .refine((f) => f.type !== 'SELECT' || f.options.length > 0, {
    message: 'A dropdown needs at least one option',
    path: ['options'],
  })
  .refine((f) => f.type === 'SELECT' || f.options.length === 0, {
    message: 'Only dropdowns have options',
    path: ['options'],
  });
export type CreateCustomFieldRequest = z.input<typeof createCustomFieldSchema>;

/** Key, entity and type are fixed after creation, so stored values stay valid. */
export const updateCustomFieldSchema = z
  .object({
    label: z.string().trim().min(1, 'Label is required').max(100),
    required: z.boolean(),
    helpText: z.string().trim().max(300).nullable(),
    options: optionsSchema,
    sortOrder: z.number().int().min(0).max(100_000),
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateCustomFieldRequest = z.infer<typeof updateCustomFieldSchema>;

export const customFieldListQuerySchema = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITY_KEYS),
  view: z.enum(['active', 'all']).default('active'),
});

/** "Vessel class notation" → "vessel_class_notation" */
export function customFieldKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50);
  return /^[a-z]/.test(key) ? key : `field_${key}`.slice(0, 50);
}

// ─── Value validation (used by the API; safe to use in the browser) ────────

/** Values sent with a record: any JSON value per key; validated below. */
export const customFieldInputSchema = z.record(z.string(), z.unknown()).optional();

type Definition = Pick<
  CustomFieldDefinitionDto,
  'key' | 'label' | 'type' | 'required' | 'options' | 'isActive'
>;

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/**
 * Validates custom field values against the tenant's definitions.
 * - create: every active required field must have a value;
 * - update: only the keys sent are checked, but a required value can never be cleared.
 * Unknown and inactive fields are rejected. Empty strings count as "no value" (null).
 */
export function validateCustomFieldValues(
  definitions: readonly Definition[],
  input: Record<string, unknown> | undefined,
  mode: 'create' | 'update',
): { values: CustomFieldValues; issues: FieldIssue[] } {
  const values: CustomFieldValues = {};
  const issues: FieldIssue[] = [];
  const sent = input ?? {};
  const path = (key: string) => `customFields.${key}`;

  for (const [key, raw] of Object.entries(sent)) {
    const def = definitions.find((d) => d.key === key);
    if (!def) {
      issues.push({ path: path(key), message: 'Unknown custom field' });
      continue;
    }
    if (!def.isActive) {
      issues.push({ path: path(key), message: `${def.label} is no longer in use` });
      continue;
    }
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === null || value === undefined || value === '') {
      if (def.required) issues.push({ path: path(key), message: `${def.label} is required` });
      else values[key] = null;
      continue;
    }
    switch (def.type) {
      case 'TEXT':
      case 'LONG_TEXT': {
        const max = def.type === 'TEXT' ? 500 : 5000;
        if (typeof value !== 'string') issues.push({ path: path(key), message: 'Must be text' });
        else if (value.length > max)
          issues.push({ path: path(key), message: `At most ${max} characters` });
        else values[key] = value;
        break;
      }
      case 'NUMBER': {
        const n = typeof value === 'string' ? Number(value) : value;
        if (typeof n !== 'number' || !Number.isFinite(n))
          issues.push({ path: path(key), message: 'Must be a number' });
        else values[key] = n;
        break;
      }
      case 'DATE':
        if (typeof value !== 'string' || !isIsoDate(value)) {
          issues.push({ path: path(key), message: 'Must be a date (YYYY-MM-DD)' });
        } else values[key] = value;
        break;
      case 'BOOLEAN':
        if (typeof value !== 'boolean')
          issues.push({ path: path(key), message: 'Must be yes or no' });
        else values[key] = value;
        break;
      case 'SELECT':
        if (typeof value !== 'string' || !def.options.some((o) => o.value === value)) {
          issues.push({ path: path(key), message: 'Choose one of the listed options' });
        } else values[key] = value;
        break;
    }
  }

  if (mode === 'create') {
    for (const def of definitions) {
      if (def.isActive && def.required && !(def.key in sent)) {
        issues.push({ path: path(def.key), message: `${def.label} is required` });
      }
    }
  }
  return { values, issues };
}

/** Human-readable value, e.g. for lists and audit views. */
export function formatCustomFieldValue(def: Definition, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (def.type === 'BOOLEAN') return value ? 'Yes' : 'No';
  if (def.type === 'SELECT')
    return def.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
}
