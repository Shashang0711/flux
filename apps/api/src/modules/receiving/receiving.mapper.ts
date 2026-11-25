import type { Prisma } from '@prisma/client';
import type { AirwayBillSummaryDto, ReceivedKitDto } from '@flux/shared';

const REF = { select: { id: true, code: true, name: true } } as const;

export const KIT_INCLUDE = {
  airwayBill: { select: { id: true, number: true } },
  product: REF,
  variant: REF,
  serviceType: REF,
  client: REF,
  vessel: { select: { id: true, code: true, name: true, imoNumber: true } },
  receivedBy: { select: { name: true } },
} satisfies Prisma.ReceivedKitInclude;

export type KitRow = Prisma.ReceivedKitGetPayload<{ include: typeof KIT_INCLUDE }>;

export function toKitDto(k: KitRow): ReceivedKitDto {
  const missing: ReceivedKitDto['missing'] = [];
  if (!k.serviceTypeId) missing.push('serviceType');
  if (!k.clientId) missing.push('client');
  if (!k.vesselId) missing.push('vessel');
  return {
    id: k.id,
    code: k.code,
    serialNumber: k.serialNumber,
    airwayBill: k.airwayBill,
    product: k.product,
    variant: k.variant,
    serviceType: k.serviceType,
    client: k.client,
    vessel: k.vessel,
    condition: k.condition,
    conditionNotes: k.conditionNotes,
    status: k.status,
    cancelReason: k.cancelReason,
    receivedAt: k.receivedAt.toISOString(),
    receivedBy: k.receivedBy?.name ?? null,
    missing: k.status === 'PENDING_REGISTRATION' ? missing : [],
  };
}

type AwbRow = Prisma.AirwayBillGetPayload<object> & {
  kitCount: number;
  pendingCount: number;
};

export function toAwbSummaryDto(a: AwbRow): AirwayBillSummaryDto {
  return {
    id: a.id,
    number: a.number,
    courier: a.courier,
    origin: a.origin,
    receivedOn: a.receivedOn.toISOString().slice(0, 10),
    status: a.status,
    kitCount: a.kitCount,
    pendingCount: a.pendingCount,
    createdAt: a.createdAt.toISOString(),
  };
}

/** Readable values for the audit trail: names, not ids. */
export function kitAuditValues(k: KitRow): Record<string, unknown> {
  return {
    serialNumber: k.serialNumber,
    kit: k.product.name,
    variant: k.variant?.name ?? null,
    serviceType: k.serviceType?.name ?? null,
    client: k.client ? `${k.client.code} ${k.client.name}` : null,
    vessel: k.vessel ? `${k.vessel.code} ${k.vessel.name}` : null,
    condition: k.condition,
    conditionNotes: k.conditionNotes,
  };
}
