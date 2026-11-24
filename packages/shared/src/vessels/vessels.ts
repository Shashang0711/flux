import { z } from 'zod';
import { customFieldInputSchema, type CustomFieldValues } from '../custom-fields/custom-fields';
import { createRelationshipSchema } from './relationships';

export const VesselStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type VesselStatus = (typeof VesselStatus)[keyof typeof VesselStatus];

/** Format of generated vessel codes: VS-00001. */
export function formatVesselCode(sequence: number): string {
  return `VS-${String(sequence).padStart(5, '0')}`;
}

/**
 * IMO ship identification number: 7 digits whose last digit is a check digit
 * (sum of the first six digits multiplied by 7, 6, 5, 4, 3, 2; last digit of that sum).
 * Accepts "IMO 9074729", "9074729"; returns the 7 digits, or null if invalid.
 */
export function normaliseImoNumber(input: string): string | null {
  const digits = input
    .trim()
    .toUpperCase()
    .replace(/^IMO\s*/, '')
    .replace(/\s+/g, '');
  if (!/^\d{7}$/.test(digits)) return null;
  const sum = [7, 6, 5, 4, 3, 2].reduce((acc, weight, i) => acc + Number(digits[i]) * weight, 0);
  return sum % 10 === Number(digits[6]) ? digits : null;
}

export interface VesselReferenceDto {
  id: string;
  code: string;
  name: string;
}

export interface VesselSummaryDto {
  id: string;
  /** Generated, e.g. VS-00001. */
  code: string;
  name: string;
  imoNumber: string | null;
  vesselType: VesselReferenceDto | null;
  status: VesselStatus;
  createdAt: string;
  updatedAt: string;
}

export interface VesselDto extends VesselSummaryDto {
  previousName: string | null;
  callSign: string | null;
  classificationSociety: VesselReferenceDto | null;
  yearBuilt: number | null;
  grossTonnage: number | null;
  deadweight: number | null;
  customFields: CustomFieldValues;
}

// ─── Validation ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const imoSchema = z
  .union([z.literal(''), z.string()])
  .transform((value, ctx) => {
    if (value.trim() === '') return null;
    const imo = normaliseImoNumber(value);
    if (!imo) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a valid 7-digit IMO number (check digit failed)',
      });
      return z.NEVER;
    }
    return imo;
  })
  .nullable()
  .optional();

const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** Numbers may arrive from forms as strings; "" means "no value". */
const optionalInt = (min: number, max: number, label: string) =>
  z
    .union([z.literal(''), z.coerce.number()])
    .transform((v, ctx) => {
      if (v === '') return null;
      if (!Number.isInteger(v) || v < min || v > max) {
        ctx.addIssue({
          code: 'custom',
          message: `${label} must be a whole number between ${min} and ${max}`,
        });
        return z.NEVER;
      }
      return v;
    })
    .nullable()
    .optional();

const vesselFields = {
  name: z.string().trim().min(1, 'Vessel name is required').max(200),
  imoNumber: imoSchema,
  previousName: optionalText(200),
  callSign: optionalText(20),
  vesselTypeId: optionalUuid,
  classificationSocietyId: optionalUuid,
  yearBuilt: optionalInt(1850, new Date().getUTCFullYear() + 3, 'Year built'),
  grossTonnage: optionalInt(0, 1_000_000, 'Gross tonnage'),
  deadweight: optionalInt(0, 1_000_000, 'Deadweight'),
};

export const createVesselSchema = z.object({
  ...vesselFields,
  customFields: customFieldInputSchema,
  /** Optional: link the new vessel to a client (and fleet) in the same step. */
  relationship: createRelationshipSchema.nullable().optional(),
});
export type CreateVesselRequest = z.input<typeof createVesselSchema>;

export const updateVesselSchema = z
  .object({
    ...vesselFields,
    status: z.enum([VesselStatus.ACTIVE, VesselStatus.INACTIVE]),
    customFields: customFieldInputSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateVesselRequest = z.output<typeof updateVesselSchema>;

export const vesselListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([VesselStatus.ACTIVE, VesselStatus.INACTIVE]).optional(),
  vesselTypeId: z.uuid().optional(),
});
export type VesselListFilter = z.infer<typeof vesselListFilterSchema>;
