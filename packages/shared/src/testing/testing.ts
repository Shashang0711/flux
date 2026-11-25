import { z } from 'zod';
import type { SampleStatus } from '../samples/samples';

/**
 * Testing and results (design pack §8 Under Testing). Decided for M13:
 * - results are structured: one value per test parameter (files come with the file service);
 * - parameters are defined per service type (name, unit, type, decimals, method, order);
 * - numeric parameters may have caution and critical min/max; results are flagged Normal /
 *   Caution / Critical automatically (a failed pass/fail result is Critical);
 * - batch results can be entered in a grid or uploaded from a CSV template.
 * A sample is UNDER_TESTING once a result is saved and RESULTS_ENTERED when completed (all
 * required parameters have values); it can be reopened for corrections.
 */

export const PARAMETER_TYPES = [
  { key: 'NUMBER', name: 'Number' },
  { key: 'TEXT', name: 'Text' },
  { key: 'PASS_FAIL', name: 'Pass / fail' },
  { key: 'CHOICE', name: 'Choice' },
] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number]['key'];
export const PARAMETER_TYPE_KEYS = PARAMETER_TYPES.map((t) => t.key) as [
  ParameterType,
  ...ParameterType[],
];

export type ResultFlag = 'NORMAL' | 'CAUTION' | 'CRITICAL';
const SEVERITY: Record<ResultFlag, number> = { NORMAL: 0, CAUTION: 1, CRITICAL: 2 };

export interface ParameterLimits {
  cautionMin: number | null;
  cautionMax: number | null;
  criticalMin: number | null;
  criticalMax: number | null;
}

export interface TestParameterDto extends ParameterLimits {
  id: string;
  /** Stable identifier (CSV column); never changes. */
  key: string;
  name: string;
  unit: string | null;
  type: ParameterType;
  /** NUMBER: decimal places shown and accepted (0–6). */
  decimals: number | null;
  method: string | null;
  /** CHOICE: the allowed answers. */
  options: string[];
  /** Must have a value before results can be completed. */
  required: boolean;
  sortOrder: number;
  isActive: boolean;
}

/** A stored value: number for NUMBER, boolean for PASS_FAIL (true = pass), text otherwise. */
export type ResultValue = number | boolean | string;

export interface SampleResultDto {
  parameterId: string;
  value: ResultValue;
  flag: ResultFlag | null;
  enteredAt: string;
  enteredBy: string | null;
}

export interface SampleResultsDto {
  sampleId: string;
  status: SampleStatus;
  /** Active parameters, plus inactive ones that already have a result. */
  parameters: TestParameterDto[];
  results: SampleResultDto[];
  worstFlag: ResultFlag | null;
  /** Required active parameters still without a value. */
  missingRequired: string[];
}

export interface BatchResultsDto {
  batchId: string;
  batchCode: string;
  parameters: TestParameterDto[];
  samples: {
    id: string;
    code: string;
    status: SampleStatus;
    kit: { code: string; serialNumber: string | null };
    vessel: string | null;
    results: SampleResultDto[];
    worstFlag: ResultFlag | null;
    missingRequired: string[];
  }[];
}

// ─── Value handling (API and browser) ───────────────────────────────────────

/**
 * Parses an entered value (from a form, grid or CSV cell). Empty means "no value" (null).
 * Returns an error message for values the parameter does not accept.
 */
export function parseResultValue(
  p: Pick<TestParameterDto, 'type' | 'decimals' | 'options' | 'name'>,
  raw: unknown,
): { value: ResultValue | null } | { error: string } {
  if (raw === null || raw === undefined) return { value: null };
  const text = typeof raw === 'string' ? raw.trim() : raw;
  if (text === '') return { value: null };
  switch (p.type) {
    case 'NUMBER': {
      // Accept "1,5" as well as "1.5" (CSV from European Excel).
      const n = typeof text === 'number' ? text : Number(String(text).replace(',', '.'));
      if (!Number.isFinite(n)) return { error: `${p.name} must be a number` };
      const decimals = p.decimals ?? 6;
      const factor = 10 ** decimals;
      if (Math.abs(Math.round(n * factor) - n * factor) > 1e-6) {
        return {
          error: `${p.name}: at most ${decimals} decimal place${decimals === 1 ? '' : 's'}`,
        };
      }
      return { value: n };
    }
    case 'PASS_FAIL': {
      if (typeof text === 'boolean') return { value: text };
      const t = String(text).toLowerCase();
      if (['pass', 'p', 'yes', 'true', 'ok'].includes(t)) return { value: true };
      if (['fail', 'f', 'no', 'false'].includes(t)) return { value: false };
      return { error: `${p.name} must be pass or fail` };
    }
    case 'CHOICE': {
      const match = p.options.find((o) => o.toLowerCase() === String(text).toLowerCase());
      return match
        ? { value: match }
        : { error: `${p.name} must be one of: ${p.options.join(', ')}` };
    }
    default: {
      const t = String(text);
      return t.length > 500 ? { error: `${p.name}: at most 500 characters` } : { value: t };
    }
  }
}

/** Critical outside the critical range, caution outside the caution range; null when no limits. */
export function flagFor(
  p: Pick<TestParameterDto, 'type'> & ParameterLimits,
  value: ResultValue,
): ResultFlag | null {
  if (p.type === 'PASS_FAIL') return value === true ? 'NORMAL' : 'CRITICAL';
  if (p.type !== 'NUMBER' || typeof value !== 'number') return null;
  const outside = (min: number | null, max: number | null) =>
    (min !== null && value < min) || (max !== null && value > max);
  if (outside(p.criticalMin, p.criticalMax)) return 'CRITICAL';
  if (outside(p.cautionMin, p.cautionMax)) return 'CAUTION';
  const hasLimits = [p.cautionMin, p.cautionMax, p.criticalMin, p.criticalMax].some(
    (l) => l !== null,
  );
  return hasLimits ? 'NORMAL' : null;
}

export function worstFlag(flags: (ResultFlag | null | undefined)[]): ResultFlag | null {
  return flags.reduce<ResultFlag | null>(
    (worst, f) => (f && (!worst || SEVERITY[f] > SEVERITY[worst]) ? f : worst),
    null,
  );
}

/** "≤ 9", "90–110", "≥ 15" for display. */
export function rangeLabel(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${min}–${max}`;
  if (max !== null) return `≤ ${max}`;
  if (min !== null) return `≥ ${min}`;
  return null;
}

export function formatResultValue(
  p: Pick<TestParameterDto, 'type' | 'decimals'>,
  v: ResultValue | null | undefined,
): string {
  if (v === null || v === undefined) return '';
  if (p.type === 'PASS_FAIL') return v ? 'Pass' : 'Fail';
  if (p.type === 'NUMBER' && typeof v === 'number' && p.decimals !== null)
    return v.toFixed(p.decimals);
  return String(v);
}

// ─── Schemas ────────────────────────────────────────────────────────────────

const limit = z
  .union([z.literal(''), z.null(), z.coerce.number()])
  .transform((v) => (v === '' || v === null ? null : v))
  .optional();

const parameterFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  unit: z
    .string()
    .trim()
    .max(40)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  decimals: z
    .union([z.literal(''), z.null(), z.coerce.number().int().min(0).max(6)])
    .transform((v) => (v === '' ? null : v))
    .optional(),
  method: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  options: z
    .array(z.string().trim().min(1).max(60))
    .max(30)
    .refine((o) => new Set(o.map((x) => x.toLowerCase())).size === o.length, {
      message: 'Choices must be unique',
    })
    .optional(),
  cautionMin: limit,
  cautionMax: limit,
  criticalMin: limit,
  criticalMax: limit,
  required: z.boolean().optional(),
  sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
};

/** Checks that each range is ordered and the caution range lies within the critical range. */
export function limitIssues(l: Partial<ParameterLimits>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const v = (k: keyof ParameterLimits) => l[k] ?? null;
  if (v('cautionMin') !== null && v('cautionMax') !== null && v('cautionMin')! > v('cautionMax')!) {
    issues.push({ path: 'cautionMax', message: 'Caution max must be at least caution min' });
  }
  if (
    v('criticalMin') !== null &&
    v('criticalMax') !== null &&
    v('criticalMin')! > v('criticalMax')!
  ) {
    issues.push({ path: 'criticalMax', message: 'Critical max must be at least critical min' });
  }
  if (
    v('criticalMin') !== null &&
    v('cautionMin') !== null &&
    v('cautionMin')! < v('criticalMin')!
  ) {
    issues.push({ path: 'cautionMin', message: 'Caution min must not be below critical min' });
  }
  if (
    v('criticalMax') !== null &&
    v('cautionMax') !== null &&
    v('cautionMax')! > v('criticalMax')!
  ) {
    issues.push({ path: 'cautionMax', message: 'Caution max must not be above critical max' });
  }
  return issues;
}

export const createParameterSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]*$/, 'Use lower-case letters, digits and underscores')
      .max(50)
      .optional(),
    type: z.enum(PARAMETER_TYPE_KEYS),
    ...parameterFields,
  })
  .superRefine((p, ctx) => {
    if (p.type === 'CHOICE' && !p.options?.length) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'Add at least one choice' });
    }
    if (p.type !== 'CHOICE' && p.options?.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Only choice parameters have choices',
      });
    }
    const hasLimits = [p.cautionMin, p.cautionMax, p.criticalMin, p.criticalMax].some(
      (x) => x != null,
    );
    if (p.type !== 'NUMBER' && hasLimits) {
      ctx.addIssue({
        code: 'custom',
        path: ['criticalMax'],
        message: 'Only number parameters have limits',
      });
    }
    for (const i of limitIssues(p))
      ctx.addIssue({ code: 'custom', path: [i.path], message: i.message });
  });
export type CreateParameterRequest = z.input<typeof createParameterSchema>;

/** Key and type are fixed after creation, so stored results stay valid. */
export const updateParameterSchema = z
  .object({ ...parameterFields, isActive: z.boolean() })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

/** Results to save for one sample; a null/empty value removes that result. */
export const sampleResultsInputSchema = z.object({
  results: z
    .array(
      z.object({
        parameterId: z.uuid(),
        value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
      }),
    )
    .max(200),
});

export const batchResultsInputSchema = z.object({
  samples: z
    .array(z.object({ sampleId: z.uuid() }).extend(sampleResultsInputSchema.shape))
    .min(1)
    .max(200),
});
export type BatchResultsRequest = z.input<typeof batchResultsInputSchema>;

export const dryRunQuerySchema = z.object({ dryRun: z.enum(['true', 'false']).optional() });
