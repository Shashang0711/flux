import type { BillingParty, Client, ClientAddress, ClientContact, Prisma } from '@prisma/client';
import type {
  BillingPartyDto,
  ClientAddressDto,
  ClientContactDto,
  ClientDto,
  ClientSummaryDto,
  CustomFieldValues,
} from '@flux/shared';

export const BILLING_PARTY_ORDER: Prisma.BillingPartyOrderByWithRelationInput[] = [
  { isDefault: 'desc' },
  { isActive: 'desc' },
  { name: 'asc' },
];

export const CLIENT_DETAIL_INCLUDE = {
  addresses: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
  contacts: { orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
  billingParties: { orderBy: BILLING_PARTY_ORDER },
} satisfies Prisma.ClientInclude;

export const CLIENT_SUMMARY_INCLUDE = {
  contacts: { where: { isPrimary: true }, take: 1 },
} satisfies Prisma.ClientInclude;

export function toAddressDto(a: ClientAddress): ClientAddressDto {
  return {
    id: a.id,
    type: a.type,
    label: a.label,
    line1: a.line1,
    line2: a.line2,
    city: a.city,
    region: a.region,
    postalCode: a.postalCode,
    country: a.country,
  };
}

export function toContactDto(c: ClientContact): ClientContactDto {
  return {
    id: c.id,
    name: c.name,
    jobTitle: c.jobTitle,
    email: c.email,
    phone: c.phone,
    isPrimary: c.isPrimary,
  };
}

export function toBillingPartyDto(b: BillingParty): BillingPartyDto {
  return {
    id: b.id,
    name: b.name,
    email: b.email,
    phone: b.phone,
    taxNumber: b.taxNumber,
    line1: b.line1,
    line2: b.line2,
    city: b.city,
    region: b.region,
    postalCode: b.postalCode,
    country: b.country,
    isDefault: b.isDefault,
    isActive: b.isActive,
  };
}

export function toClientSummaryDto(c: Client & { contacts: ClientContact[] }): ClientSummaryDto {
  const primary = c.contacts.find((x) => x.isPrimary);
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    tradingName: c.tradingName,
    email: c.email,
    phone: c.phone,
    status: c.status,
    primaryContact: primary ? { name: primary.name, email: primary.email } : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

export function toClientDto(
  c: Client & {
    addresses: ClientAddress[];
    contacts: ClientContact[];
    billingParties: BillingParty[];
  },
): ClientDto {
  return {
    ...toClientSummaryDto(c),
    website: c.website,
    taxNumber: c.taxNumber,
    notes: c.notes,
    customFields: (c.customFields as CustomFieldValues) ?? {},
    addresses: c.addresses.map(toAddressDto),
    contacts: c.contacts.map(toContactDto),
    billingParties: c.billingParties.map(toBillingPartyDto),
  };
}

/** One-line description used in audit entries for removed sub-records. */
export function describeAddress(a: ClientAddress): string {
  return [a.line1, a.city, a.country].filter(Boolean).join(', ');
}
