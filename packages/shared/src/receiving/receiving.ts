import { z } from 'zod';
import { isoDateSchema } from '../vessels/relationships';

/**
 * Receiving (design pack §8, Bulk Receiving). Decided for M10:
 * - an Airway Bill (AWB) is the shipment: OPEN while kits are received one by one, CLOSED when
 *   done (it can be reopened); there is no "expected" state;
 * - each received kit gets a system ID (RK-000001) and an optional serial printed on the kit,
 *   unique while the kit is not cancelled;
 * - vessel, client and service type are optional at receiving and can be completed until
 *   registration; the queue shows what is missing;
 * - the kit's condition on arrival is recorded (OK, damaged, leaking, incomplete) with a note.
 * Kits are cancelled with a reason, never deleted.
 */

export const AirwayBillStatus = { OPEN: 'OPEN', CLOSED: 'CLOSED' } as const;
export type AirwayBillStatus = (typeof AirwayBillStatus)[keyof typeof AirwayBillStatus];

export const KIT_CONDITIONS = [
  { key: 'OK', name: 'OK' },
  { key: 'DAMAGED', name: 'Damaged' },
  { key: 'LEAKING', name: 'Leaking' },
  { key: 'INCOMPLETE', name: 'Incomplete' },
] as const;
export type KitCondition = (typeof KIT_CONDITIONS)[number]['key'];
export const KIT_CONDITION_KEYS = KIT_CONDITIONS.map((c) => c.key) as [
  KitCondition,
  ...KitCondition[],
];

export const ReceivedKitStatus = {
  PENDING_REGISTRATION: 'PENDING_REGISTRATION',
  REGISTERED: 'REGISTERED',
  CANCELLED: 'CANCELLED',
} as const;
export type ReceivedKitStatus = (typeof ReceivedKitStatus)[keyof typeof ReceivedKitStatus];

/** Format of generated received-kit IDs: RK-000001. */
export function formatReceivedKitCode(sequence: number): string {
  return `RK-${String(sequence).padStart(6, '0')}`;
}

/** AWB numbers are compared without spaces and in upper case: "176 1234 5675" → "17612345675". */
export function normaliseAwbNumber(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, '');
}

interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface AirwayBillSummaryDto {
  id: string;
  number: string;
  courier: string | null;
  origin: string | null;
  /** Date the shipment arrived (YYYY-MM-DD). */
  receivedOn: string;
  status: AirwayBillStatus;
  kitCount: number;
  pendingCount: number;
  createdAt: string;
}

export interface AirwayBillDto extends AirwayBillSummaryDto {
  notes: string | null;
  closedAt: string | null;
  kits: ReceivedKitDto[];
}

export interface ReceivedKitDto {
  id: string;
  /** Generated, e.g. RK-000001. */
  code: string;
  serialNumber: string | null;
  airwayBill: { id: string; number: string };
  product: Ref;
  variant: Ref | null;
  serviceType: Ref | null;
  client: Ref | null;
  vessel: (Ref & { imoNumber: string | null }) | null;
  condition: KitCondition;
  conditionNotes: string | null;
  status: ReceivedKitStatus;
  cancelReason: string | null;
  receivedAt: string;
  receivedBy: string | null;
  /** What still has to be chosen before (or at) registration. */
  missing: ('serviceType' | 'client' | 'vessel')[];
}

/** Everything the receiving form offers, readable with receiving.view alone. */
export interface ReceivingOptionsDto {
  kits: (Ref & {
    variants: Ref[];
    serviceTypes: Ref[];
  })[];
  /** Empty when the Clients module is off. */
  clients: Ref[];
  /** Empty when the Vessels module is off. Each with its active clients (primary first). */
  vessels: (Ref & {
    imoNumber: string | null;
    clientIds: string[];
    primaryClientId: string | null;
  })[];
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

const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const awbNumberSchema = z
  .string()
  .transform(normaliseAwbNumber)
  .pipe(
    z
      .string()
      .min(1, 'AWB number is required')
      .max(40)
      .regex(/^[A-Z0-9-]+$/, 'Use letters, digits and dashes'),
  );

export const createAirwayBillSchema = z.object({
  number: awbNumberSchema,
  courier: optionalText(100),
  origin: optionalText(100),
  /** Defaults to today. */
  receivedOn: isoDateSchema,
  notes: optionalText(2000),
});
export type CreateAirwayBillRequest = z.input<typeof createAirwayBillSchema>;

export const updateAirwayBillSchema = createAirwayBillSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const airwayBillListQuerySchema = z.object({
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  q: z.string().trim().max(100).optional(),
});

const kitFields = {
  productId: z.uuid({ message: 'Choose the kit' }),
  variantId: optionalUuid,
  serialNumber: z
    .string()
    .trim()
    .toUpperCase()
    .max(60)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  serviceTypeId: optionalUuid,
  clientId: optionalUuid,
  vesselId: optionalUuid,
  condition: z.enum(KIT_CONDITION_KEYS).default('OK'),
  conditionNotes: optionalText(1000),
};

export const receiveKitSchema = z.object(kitFields);
export type ReceiveKitRequest = z.input<typeof receiveKitSchema>;

/** Every field may change while the kit waits for registration. */
export const updateReceivedKitSchema = z
  .object(kitFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const cancelReceivedKitSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason').max(500),
});

export const registrationQueueQuerySchema = z.object({
  /** linked: has a vessel; unlinked: no vessel. */
  link: z.enum(['linked', 'unlinked']).optional(),
  serviceTypeId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  airwayBillId: z.uuid().optional(),
  /** Kits whose condition is not OK. */
  flagged: z.enum(['true']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type RegistrationQueueQuery = z.output<typeof registrationQueueQuerySchema>;
