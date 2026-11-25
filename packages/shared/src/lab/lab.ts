import { z } from 'zod';
import type { TestParameterDto } from '../testing/testing';
import {
  CUSTOM_FIELD_TYPE_KEYS,
  customFieldKeyFromLabel,
  type CustomFieldOption,
  type CustomFieldType,
  type CustomFieldValues,
} from '../custom-fields/custom-fields';

/**
 * Laboratory master data (design pack §7): Category → Service Type → Product/Kit → Variant →
 * Bottle configuration. Decided for M9:
 * - a category owns its service types; kits and service types are many-to-many;
 * - each variant belongs to one kit; variants are optional;
 * - bottle types are a tenant-wide list; a kit lists its bottles, and a variant may replace
 *   that list with its own (no bottles on the variant = the kit's bottles);
 * - service types define registration fields, each entered per batch or per sample;
 * - every lab owns its catalogue; a FLUX starter catalogue can be imported as a copy.
 * Records are deactivated, never deleted, so samples keep stable references.
 */

export interface LabRef {
  id: string;
  code: string;
  name: string;
}

export interface LabCategoryDto extends LabRef {
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  serviceTypeCount: number;
}

export const REGISTRATION_FIELD_SCOPES = [
  { key: 'BATCH', name: 'Once per batch' },
  { key: 'SAMPLE', name: 'For each sample' },
] as const;
export type RegistrationFieldScope = (typeof REGISTRATION_FIELD_SCOPES)[number]['key'];

export interface RegistrationFieldDto {
  id: string;
  /** Stable identifier used to store values; never changes. */
  key: string;
  label: string;
  type: CustomFieldType;
  scope: RegistrationFieldScope;
  required: boolean;
  helpText: string | null;
  options: CustomFieldOption[];
  sortOrder: number;
  isActive: boolean;
}

export interface ServiceTypeSummaryDto extends LabRef {
  category: LabRef & { isActive: boolean };
  sortOrder: number;
  isActive: boolean;
  /** Samples of this type cannot be registered without a vessel. */
  vesselRequired: boolean;
  fieldCount: number;
  productCount: number;
}

export interface ServiceTypeDto extends ServiceTypeSummaryDto {
  description: string | null;
  /** In display order: batch fields first, then sample fields. */
  fields: RegistrationFieldDto[];
  /** Test parameters (results), in order. */
  parameters: TestParameterDto[];
  products: (LabRef & { isActive: boolean })[];
  createdAt: string;
  updatedAt: string;
}

export interface BottleTypeDto extends LabRef {
  volumeMl: number;
  material: string | null;
  isActive: boolean;
  /** Kits and variants using it. */
  usageCount: number;
}

export interface BottleLineDto {
  bottleType: LabRef & { volumeMl: number; isActive: boolean };
  quantity: number;
}

export interface ProductVariantDto extends LabRef {
  isActive: boolean;
  /** The variant's own bottles; empty when it uses the kit's. */
  bottles: BottleLineDto[];
  /** What a kit of this variant contains. */
  effectiveBottles: BottleLineDto[];
}

export interface ProductSummaryDto extends LabRef {
  isActive: boolean;
  serviceTypes: (LabRef & { isActive: boolean })[];
  variantCount: number;
}

export interface ProductDto extends ProductSummaryDto {
  description: string | null;
  bottles: BottleLineDto[];
  variants: ProductVariantDto[];
  createdAt: string;
  updatedAt: string;
}

export interface StarterImportResultDto {
  created: {
    categories: number;
    serviceTypes: number;
    parameters: number;
    bottleTypes: number;
    products: number;
  };
  /** Items skipped because their code already exists. */
  skipped: number;
}

/** Values entered for one registration, after validation against the service type. */
export interface RegistrationCheckResultDto {
  batch: CustomFieldValues;
  samples: CustomFieldValues[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Short business codes: "WATER", "BW-UV". Stored upper-case, unique per organisation. */
export const labCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, digits, - and _')
  .max(20);

const name = z.string().trim().min(1, 'Name is required').max(200);
const description = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const sortOrder = z.coerce.number().int().min(0).max(100_000);

/** Update schemas: every field optional, but at least one present. */
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .partial()
    .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const createLabCategorySchema = z.object({
  code: labCodeSchema,
  name,
  description,
  sortOrder: sortOrder.default(0),
});
export const updateLabCategorySchema = atLeastOne({
  code: labCodeSchema,
  name,
  description,
  sortOrder,
  isActive: z.boolean(),
});

export const createServiceTypeSchema = z.object({
  categoryId: z.uuid({ message: 'Choose a category' }),
  code: labCodeSchema,
  name,
  description,
  sortOrder: sortOrder.default(0),
  vesselRequired: z.boolean().default(false),
});
export const updateServiceTypeSchema = atLeastOne({
  categoryId: z.uuid({ message: 'Choose a category' }),
  code: labCodeSchema,
  name,
  description,
  sortOrder,
  isActive: z.boolean(),
  vesselRequired: z.boolean(),
});

const fieldKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores')
  .max(50);
const optionsSchema = z
  .array(
    z.object({
      value: z.string().trim().min(1).max(100),
      label: z.string().trim().min(1).max(100),
    }),
  )
  .max(100)
  .refine((o) => new Set(o.map((x) => x.value)).size === o.length, {
    message: 'Option values must be unique',
  });
const helpText = z
  .string()
  .trim()
  .max(300)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Key, type and scope are fixed after creation, so registered values stay valid. */
export const createRegistrationFieldSchema = z
  .object({
    key: fieldKeySchema.optional(),
    label: z.string().trim().min(1, 'Label is required').max(100),
    type: z.enum(CUSTOM_FIELD_TYPE_KEYS),
    scope: z.enum(['BATCH', 'SAMPLE']),
    required: z.boolean().default(false),
    helpText,
    options: optionsSchema.default([]),
    sortOrder: sortOrder.default(0),
  })
  .transform((f) => ({ ...f, key: f.key ?? customFieldKeyFromLabel(f.label) }))
  .refine((f) => f.type !== 'SELECT' || f.options.length > 0, {
    message: 'A dropdown needs at least one option',
    path: ['options'],
  })
  .refine((f) => f.type === 'SELECT' || f.options.length === 0, {
    message: 'Only dropdowns have options',
    path: ['options'],
  });
export type CreateRegistrationFieldRequest = z.input<typeof createRegistrationFieldSchema>;

export const updateRegistrationFieldSchema = atLeastOne({
  label: z.string().trim().min(1, 'Label is required').max(100),
  required: z.boolean(),
  helpText,
  options: optionsSchema,
  sortOrder,
  isActive: z.boolean(),
});

export const MAX_REGISTRATION_FIELDS = 30;

export const registrationCheckSchema = z.object({
  batch: z.record(z.string(), z.unknown()).default({}),
  samples: z.array(z.record(z.string(), z.unknown())).min(1).max(200),
});
export type RegistrationCheckRequest = z.input<typeof registrationCheckSchema>;

export const createBottleTypeSchema = z.object({
  code: labCodeSchema,
  name,
  volumeMl: z.coerce
    .number()
    .int('Volume must be whole millilitres')
    .min(1, 'Volume must be at least 1 ml')
    .max(100_000),
  material: z
    .string()
    .trim()
    .max(100)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
export const updateBottleTypeSchema = atLeastOne({
  ...createBottleTypeSchema.shape,
  isActive: z.boolean(),
});

export const bottleLinesSchema = z.object({
  bottles: z
    .array(
      z.object({
        bottleTypeId: z.uuid({ message: 'Choose a bottle type' }),
        quantity: z.coerce.number().int().min(1, 'At least 1').max(100, 'At most 100'),
      }),
    )
    .max(30)
    .refine((b) => new Set(b.map((x) => x.bottleTypeId)).size === b.length, {
      message: 'Each bottle type once; adjust its quantity instead',
    }),
});
export type BottleLinesRequest = z.input<typeof bottleLinesSchema>;

export const createProductSchema = z.object({
  code: labCodeSchema,
  name,
  description,
  serviceTypeIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one service type')
    .transform((ids) => [...new Set(ids)]),
});
export const updateProductSchema = atLeastOne({
  code: labCodeSchema,
  name,
  description,
  serviceTypeIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one service type')
    .transform((ids) => [...new Set(ids)]),
  isActive: z.boolean(),
});

export const createVariantSchema = z.object({ code: labCodeSchema, name });
export const updateVariantSchema = atLeastOne({ code: labCodeSchema, name, isActive: z.boolean() });

export const labListQuerySchema = z.object({
  view: z.enum(['active', 'all']).default('all'),
  categoryId: z.uuid().optional(),
  serviceTypeId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type LabListQuery = z.output<typeof labListQuerySchema>;
