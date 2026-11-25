import { z } from 'zod';
import type { CustomFieldValues } from '../custom-fields/custom-fields';
import type { RegistrationFieldDto } from '../lab/lab';
import type { ResultFlag } from '../testing/testing';
import {
  createAirwayBillSchema,
  receiveKitSchema,
  type ReceivedKitDto,
  type ReceivingOptionsDto,
} from '../receiving/receiving';

/**
 * Batch registration (design pack §8, §16, §20). Decided for M11:
 * - a batch has one service type (one registration form); its kits may come from different
 *   vessels and clients, and each sample keeps its own;
 * - one received kit becomes one sample;
 * - every sample has a client; a vessel is required only for service types marked so;
 * - IDs are year-based: batch B26-00001, sample S26-000001 (numbering restarts each year).
 * Registration is one transaction; a kit can be registered once only.
 */

export const SampleStatus = {
  REGISTERED: 'REGISTERED',
  UNDER_TESTING: 'UNDER_TESTING',
  RESULTS_ENTERED: 'RESULTS_ENTERED',
} as const;
export type SampleStatus = (typeof SampleStatus)[keyof typeof SampleStatus];

/**
 * Sample Update colours (design pack §9): red once registered, yellow when the lab report is
 * uploaded, green when published. Computed from state, never stored; report states arrive with
 * M14–M16, so every sample is red until then.
 */
export type SampleColour = 'red' | 'yellow' | 'green';
export function sampleColour(_sample: { status: SampleStatus }): SampleColour {
  return 'red';
}

/** B26-00001 */
export function formatBatchCode(year: number, sequence: number): string {
  return `B${String(year % 100).padStart(2, '0')}-${String(sequence).padStart(5, '0')}`;
}
/** S26-000001 */
export function formatSampleCode(year: number, sequence: number): string {
  return `S${String(year % 100).padStart(2, '0')}-${String(sequence).padStart(6, '0')}`;
}

interface Ref {
  id: string;
  code: string;
  name: string;
}

export interface BatchSummaryDto {
  id: string;
  /** Generated, e.g. B26-00001. */
  code: string;
  serviceType: Ref;
  sampleCount: number;
  /** Samples per status (testing progress). */
  statusCounts: Record<SampleStatus, number>;
  registeredAt: string;
  registeredBy: string | null;
}

export interface SampleSummaryDto {
  id: string;
  /** Generated, e.g. S26-000001. */
  code: string;
  status: SampleStatus;
  colour: SampleColour;
  /** Worst result flag so far (null: no flagged results). */
  worstFlag: ResultFlag | null;
  batch: { id: string; code: string };
  serviceType: Ref;
  client: Ref;
  vessel: (Ref & { imoNumber: string | null }) | null;
  kit: {
    id: string;
    code: string;
    serialNumber: string | null;
    product: Ref;
    variant: Ref | null;
  };
  registeredAt: string;
}

export interface SampleDto extends SampleSummaryDto {
  /** Values of the service type's sample fields. */
  values: CustomFieldValues;
  /** The batch's values (entered once for all its samples). */
  batchValues: CustomFieldValues;
  /** Field definitions to label and format the values (incl. inactive ones). */
  fields: RegistrationFieldDto[];
  airwayBill: { id: string; number: string };
  registeredBy: string | null;
}

export interface BatchDto extends BatchSummaryDto {
  values: CustomFieldValues;
  fields: RegistrationFieldDto[];
  notes: string | null;
  samples: (SampleSummaryDto & { values: CustomFieldValues })[];
}

/** What the Register batch form needs for the chosen kits. */
export interface RegistrationDraftDto {
  kits: ReceivedKitDto[];
  /** Service types every chosen kit can be registered for, with their active fields. */
  serviceTypes: (Ref & { vesselRequired: boolean; fields: RegistrationFieldDto[] })[];
  clients: ReceivingOptionsDto['clients'];
  vessels: ReceivingOptionsDto['vessels'];
}

// ─── Validation ─────────────────────────────────────────────────────────────

const optionalUuid = z
  .union([z.literal(''), z.uuid()])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const MAX_BATCH_SAMPLES = 200;

export const registerBatchSchema = z.object({
  serviceTypeId: z.uuid({ message: 'Choose the service type' }),
  /** Values of the service type's batch fields. */
  values: z.record(z.string(), z.unknown()).default({}),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  samples: z
    .array(
      z.object({
        kitId: z.uuid(),
        /** Completes or overrides the kit's client and vessel; omitted = as received. */
        clientId: optionalUuid,
        vesselId: optionalUuid,
        values: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .min(1, 'Choose at least one kit')
    .max(MAX_BATCH_SAMPLES, `At most ${MAX_BATCH_SAMPLES} kits per batch`)
    .refine((s) => new Set(s.map((x) => x.kitId)).size === s.length, {
      message: 'A kit can be in the batch only once',
    }),
});
export type RegisterBatchRequest = z.input<typeof registerBatchSchema>;

export const registrationDraftQuerySchema = z.object({
  kitIds: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1, 'Choose at least one kit').max(MAX_BATCH_SAMPLES)),
});

export const batchListQuerySchema = z.object({
  serviceTypeId: z.uuid().optional(),
  /** Only batches with samples whose results are not complete. */
  open: z.enum(['true']).optional(),
  q: z.string().trim().max(100).optional(),
});

export const sampleListQuerySchema = z.object({
  status: z.enum(['REGISTERED', 'UNDER_TESTING', 'RESULTS_ENTERED']).optional(),
  serviceTypeId: z.uuid().optional(),
  clientId: z.uuid().optional(),
  vesselId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  /** Only samples still being worked on (registered or under testing). */
  open: z.enum(['true']).optional(),
  q: z.string().trim().max(100).optional(),
});
export type SampleListQuery = z.output<typeof sampleListQuerySchema>;

// ─── Receive & Register (M12) ───────────────────────────────────────────────

/** What the Receive & Register form needs. */
export interface ReceiveRegisterOptionsDto {
  /** Active service types that at least one active kit is used for, with their active fields. */
  serviceTypes: (Ref & { vesselRequired: boolean; fields: RegistrationFieldDto[] })[];
  kits: ReceivingOptionsDto['kits'];
  clients: ReceivingOptionsDto['clients'];
  vessels: ReceivingOptionsDto['vessels'];
  /** Open airway bills the package can be added to, newest first. */
  openAirwayBills: { id: string; number: string; receivedOn: string }[];
}

/**
 * Receive & Register (design pack §8): a package is received and its kits registered together,
 * in one transaction. Either an open AWB is chosen (airwayBillId) or a new one is described.
 * Errors use the batch-registration paths: samples.<n>.<field>.
 */
export const receiveAndRegisterSchema = z
  .object({
    airwayBillId: optionalUuid,
    airwayBill: createAirwayBillSchema.optional(),
    serviceTypeId: z.uuid({ message: 'Choose the service type' }),
    values: z.record(z.string(), z.unknown()).default({}),
    notes: z
      .string()
      .trim()
      .max(2000)
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    samples: z
      .array(
        receiveKitSchema
          .omit({ serviceTypeId: true })
          .extend({ values: z.record(z.string(), z.unknown()).default({}) }),
      )
      .min(1, 'Add at least one kit')
      .max(MAX_BATCH_SAMPLES, `At most ${MAX_BATCH_SAMPLES} kits per batch`),
  })
  .superRefine((v, ctx) => {
    if (!v.airwayBillId && !v.airwayBill) {
      ctx.addIssue({
        code: 'custom',
        path: ['airwayBill', 'number'],
        message: 'AWB number is required',
      });
    }
    const seen = new Map<string, number>();
    v.samples.forEach((s, i) => {
      if (!s.serialNumber) return;
      if (seen.has(s.serialNumber)) {
        ctx.addIssue({
          code: 'custom',
          path: ['samples', i, 'serialNumber'],
          message: `Same serial as kit ${seen.get(s.serialNumber)! + 1}`,
        });
      } else seen.set(s.serialNumber, i);
    });
  });
export type ReceiveAndRegisterRequest = z.input<typeof receiveAndRegisterSchema>;
