import { z } from 'zod';
import type { FileDto } from '../files/files';
import type { SampleStatus } from '../samples/samples';

/**
 * Lab reports (design pack §8, §9, §16). Decided for M14:
 * - a report covers one sample, or several samples of one batch (join table);
 * - only samples whose results are completed can be in a report, and a sample is in one report;
 * - reports are PDF; uploading one submits it for Admin review and turns its samples yellow;
 * - each upload is a version, so a replaced or corrected file keeps its history.
 * Admin review (reject / ready to publish) follows in M15.
 */

export const LabReportStatus = {
  SUBMITTED: 'SUBMITTED',
  REJECTED: 'REJECTED',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
} as const;
export type LabReportStatus = (typeof LabReportStatus)[keyof typeof LabReportStatus];

/** LR26-00001 */
export function formatLabReportCode(year: number, sequence: number): string {
  return `LR${String(year % 100).padStart(2, '0')}-${String(sequence).padStart(5, '0')}`;
}

export interface LabReportVersionDto {
  version: number;
  file: FileDto;
  note: string | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface LabReportSummaryDto {
  id: string;
  /** Generated, e.g. LR26-00001. */
  code: string;
  status: LabReportStatus;
  /** Who uploaded the current version. */
  uploadedBy: string | null;
  batch: { id: string; code: string };
  serviceType: { id: string; code: string; name: string };
  sampleCount: number;
  currentVersion: number;
  submittedAt: string;
}

export const ReviewDecision = {
  REJECTED: 'REJECTED',
  READY_TO_PUBLISH: 'READY_TO_PUBLISH',
  REOPENED: 'REOPENED',
} as const;
export type ReviewDecision = (typeof ReviewDecision)[keyof typeof ReviewDecision];

/** One Admin review decision (design pack §8 Admin Review); kept as history. */
export interface LabReportReviewDto {
  decision: ReviewDecision;
  /** The report version the decision was about. */
  version: number;
  comment: string | null;
  reviewer: string | null;
  decidedAt: string;
}

export interface LabReportDto extends LabReportSummaryDto {
  samples: {
    id: string;
    code: string;
    vessel: string | null;
    client: string;
    status: SampleStatus;
  }[];
  versions: LabReportVersionDto[];
  /** Newest first. */
  reviews: LabReportReviewDto[];
  /** Who uploaded the current version (they cannot review it: four eyes). */
  currentUploaderId: string | null;
}

export interface SampleAttachmentDto {
  id: string;
  file: FileDto;
  note: string | null;
  createdAt: string;
}

const note = z
  .string()
  .trim()
  .max(1000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

export const createLabReportSchema = z.object({
  batchId: z.uuid(),
  sampleIds: z
    .array(z.uuid())
    .min(1, 'Choose the samples the report covers')
    .max(200)
    .transform((ids) => [...new Set(ids)]),
  fileId: z.uuid({ message: 'Upload the report file' }),
  note,
});
export type CreateLabReportRequest = z.input<typeof createLabReportSchema>;

export const addReportVersionSchema = z.object({
  fileId: z.uuid({ message: 'Upload the report file' }),
  note,
});

export const labReportListQuerySchema = z.object({
  status: z.enum(['SUBMITTED', 'REJECTED', 'READY_TO_PUBLISH']).optional(),
  batchId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type LabReportListQuery = z.output<typeof labReportListQuerySchema>;

/** Rejecting returns the report to the lab; the comment says what to correct. */
export const rejectReportSchema = z.object({
  comment: z.string().trim().min(1, 'Say what the lab should correct').max(2000),
});
export const readyToPublishSchema = z.object({
  comment: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
});
/** Sends a ready-to-publish report back to review (before it is published). */
export const reopenReviewSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason').max(2000),
});

export const addAttachmentSchema = z.object({
  fileId: z.uuid({ message: 'Upload the file' }),
  note,
});
