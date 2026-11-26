import type { Prisma } from '@prisma/client';
import {
  sampleColour,
  worstFlag,
  type SampleStatus,
  type BatchSummaryDto,
  type CustomFieldValues,
  type SampleSummaryDto,
} from '@flux/shared';

const REF = { select: { id: true, code: true, name: true } } as const;

export const SAMPLE_INCLUDE = {
  batch: { select: { id: true, code: true } },
  serviceType: REF,
  client: REF,
  vessel: { select: { id: true, code: true, name: true, imoNumber: true } },
  receivedKit: {
    select: {
      id: true,
      code: true,
      serialNumber: true,
      product: REF,
      variant: REF,
      airwayBill: { select: { id: true, number: true } },
    },
  },
  results: { select: { flag: true } },
  labReportLinks: { select: { report: { select: { id: true, code: true, status: true } } } },
} satisfies Prisma.SampleInclude;

export type SampleRow = Prisma.SampleGetPayload<{ include: typeof SAMPLE_INCLUDE }>;

export function toSampleSummaryDto(s: SampleRow): SampleSummaryDto {
  const { airwayBill: _awb, ...kit } = s.receivedKit;
  const labReport = s.labReportLinks[0]?.report ?? null;
  return {
    id: s.id,
    code: s.code,
    status: s.status,
    colour: sampleColour({ status: s.status, labReport }),
    worstFlag: worstFlag(s.results.map((r) => r.flag)),
    labReport,
    batch: s.batch,
    serviceType: s.serviceType,
    client: s.client,
    vessel: s.vessel,
    kit,
    registeredAt: s.registeredAt.toISOString(),
  };
}

export const BATCH_SUMMARY_INCLUDE = {
  serviceType: REF,
  registeredBy: { select: { name: true } },
  _count: { select: { samples: true } },
  samples: { select: { status: true } },
} satisfies Prisma.RegistrationBatchInclude;

export type BatchSummaryRow = Prisma.RegistrationBatchGetPayload<{
  include: typeof BATCH_SUMMARY_INCLUDE;
}>;

export function toBatchSummaryDto(b: BatchSummaryRow): BatchSummaryDto {
  return {
    id: b.id,
    code: b.code,
    serviceType: b.serviceType,
    sampleCount: b._count.samples,
    statusCounts: b.samples.reduce<Record<SampleStatus, number>>(
      (acc, s) => ({ ...acc, [s.status]: acc[s.status] + 1 }),
      { REGISTERED: 0, UNDER_TESTING: 0, RESULTS_ENTERED: 0 },
    ),
    registeredAt: b.registeredAt.toISOString(),
    registeredBy: b.registeredBy?.name ?? null,
  };
}

export const values = (json: Prisma.JsonValue): CustomFieldValues =>
  (json ?? {}) as CustomFieldValues;
