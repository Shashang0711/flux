import { z } from 'zod';
import { customFieldInputSchema, type CustomFieldValues } from '../custom-fields/custom-fields';
import { emailSchema } from '../identity/users';

export const ClientStatus = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' } as const;
export type ClientStatus = (typeof ClientStatus)[keyof typeof ClientStatus];

export const ADDRESS_TYPES = [
  { key: 'REGISTERED', name: 'Registered office' },
  { key: 'BILLING', name: 'Billing' },
  { key: 'SHIPPING', name: 'Shipping / delivery' },
  { key: 'OTHER', name: 'Other' },
] as const;
export type AddressType = (typeof ADDRESS_TYPES)[number]['key'];
const ADDRESS_TYPE_KEYS = ADDRESS_TYPES.map((t) => t.key) as [AddressType, ...AddressType[]];

/** Format of generated client IDs: CL-00001 (wider once past 99999). */
export function formatClientCode(sequence: number): string {
  return `CL-${String(sequence).padStart(5, '0')}`;
}

export interface AddressFields {
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export interface ClientAddressDto extends AddressFields {
  id: string;
  type: AddressType;
  label: string | null;
}

export interface ClientContactDto {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

/** Billing parties may have no address yet, so every address field is nullable. */
export interface BillingPartyDto {
  id: string;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  taxNumber: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface ClientSummaryDto {
  id: string;
  /** Generated, e.g. CL-00001. */
  code: string;
  name: string;
  tradingName: string | null;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  primaryContact: { name: string; email: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClientDto extends ClientSummaryDto {
  website: string | null;
  taxNumber: string | null;
  notes: string | null;
  /** Tenant-defined fields: { [key]: value }. */
  customFields: CustomFieldValues;
  addresses: ClientAddressDto[];
  contacts: ClientContactDto[];
  billingParties: BillingPartyDto[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1, 'Required').max(max);
/** Optional text: empty strings become null. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();
const optionalEmail = z
  .union([z.literal(''), emailSchema])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();
const optionalUrl = z
  .union([z.literal(''), z.url({ message: 'Enter a full URL, e.g. https://example.com' }).max(300)])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const clientFields = {
  name: text(200),
  tradingName: optionalText(200),
  email: optionalEmail,
  phone: optionalText(50),
  website: optionalUrl,
  taxNumber: optionalText(50),
  notes: optionalText(2000),
};

export const createClientSchema = z.object({
  ...clientFields,
  customFields: customFieldInputSchema,
});
export type CreateClientRequest = z.input<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    ...clientFields,
    status: z.enum([ClientStatus.ACTIVE, ClientStatus.INACTIVE]),
    customFields: customFieldInputSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });
export type UpdateClientRequest = z.output<typeof updateClientSchema>;

const addressFields = {
  line1: text(200),
  line2: optionalText(200),
  city: text(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  country: text(100),
};

export const clientAddressSchema = z.object({
  type: z.enum(ADDRESS_TYPE_KEYS),
  label: optionalText(100),
  ...addressFields,
});
export const updateClientAddressSchema = clientAddressSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const clientContactSchema = z.object({
  name: text(200),
  jobTitle: optionalText(100),
  email: optionalEmail,
  phone: optionalText(50),
  isPrimary: z.boolean().default(false),
});
export const updateClientContactSchema = z
  .object({
    name: text(200),
    jobTitle: optionalText(100),
    email: optionalEmail,
    phone: optionalText(50),
    isPrimary: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const billingFields = {
  name: text(200),
  email: optionalEmail,
  phone: optionalText(50),
  taxNumber: optionalText(50),
  line1: optionalText(200),
  line2: optionalText(200),
  city: optionalText(100),
  region: optionalText(100),
  postalCode: optionalText(20),
  country: optionalText(100),
};

export const billingPartySchema = z.object({
  ...billingFields,
  isDefault: z.boolean().default(false),
});
export const updateBillingPartySchema = z
  .object({ ...billingFields, isDefault: z.boolean(), isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const clientListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([ClientStatus.ACTIVE, ClientStatus.INACTIVE]).optional(),
});
export type ClientListFilter = z.infer<typeof clientListFilterSchema>;
