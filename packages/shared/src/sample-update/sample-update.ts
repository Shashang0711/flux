import { z } from 'zod';
import type { SampleColour } from '../samples/samples';

/**
 * Sample Update page (design pack §9): one API with monthly, weekly, daily and list views.
 * Decided for M17:
 * - calendar rows are vessel + service type ("against vessel and service"); samples without a
 *   vessel get rows under their client, after the vessel rows;
 * - columns are the days of the month/week (hours for a day); a cell counts samples per colour;
 * - a sample is placed by the date it was registered, in the viewer's time zone;
 * - colours come from state (red: registered/testing/report rejected, yellow: lab report
 *   uploaded, green: final report published), computed exactly like sampleColour().
 */

export const SAMPLE_UPDATE_VIEWS = ['monthly', 'weekly', 'daily', 'list'] as const;
export type SampleUpdateView = (typeof SAMPLE_UPDATE_VIEWS)[number];

export type ColourCounts = Record<SampleColour, number>;

interface Ref {
  id: string;
  name: string;
}

export interface SampleUpdateRowDto {
  key: string;
  /** Null for samples without a vessel (row is labelled with the client). */
  vessel: Ref | null;
  client: Ref;
  serviceType: Ref;
  /** By column key (YYYY-MM-DD, or HH for the daily view); missing = no samples. */
  cells: Record<string, ColourCounts>;
  totals: ColourCounts;
}

export interface SampleUpdateGridDto {
  view: Exclude<SampleUpdateView, 'list'>;
  /** First and last day shown (YYYY-MM-DD, inclusive) in timeZone. */
  from: string;
  to: string;
  timeZone: string;
  columns: { key: string; label: string; weekend: boolean }[];
  rows: SampleUpdateRowDto[];
  totals: ColourCounts;
}

/** Clients, vessels and service types that have samples, for the filters. */
export interface SampleUpdateOptionsDto {
  clients: Ref[];
  vessels: Ref[];
  serviceTypes: Ref[];
}

export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const sampleUpdateQuerySchema = z.object({
  view: z.enum(SAMPLE_UPDATE_VIEWS).default('monthly'),
  /** Any day in the period to show; today when omitted. */
  date: isoDate.optional(),
  /** List view: only this day (a calendar cell). */
  day: isoDate.optional(),
  timeZone: z.string().max(64).refine(isTimeZone, { message: 'Unknown time zone' }).default('UTC'),
  clientId: z.uuid().optional(),
  vesselId: z.uuid().optional(),
  /** List view: only samples without a vessel. */
  noVessel: z.enum(['true']).optional(),
  serviceTypeId: z.uuid().optional(),
  colour: z.enum(['red', 'yellow', 'green']).optional(),
});
export type SampleUpdateQuery = z.output<typeof sampleUpdateQuerySchema>;

// ─── Periods (shared by API and web for navigation) ─────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const formatIsoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00Z`);
const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return formatIsoDate(d);
};

/** The days a view covers around `date` (weeks start on Monday). */
export function periodOf(view: SampleUpdateView, date: string): { from: string; to: string } {
  const d = parse(date);
  if (view === 'daily') return { from: date, to: date };
  if (view === 'weekly') {
    const monday = addDays(date, -((d.getUTCDay() + 6) % 7));
    return { from: monday, to: addDays(monday, 6) };
  }
  const first = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from: formatIsoDate(first), to: formatIsoDate(last) };
}

/** A date in the previous (-1) or next (+1) period. */
export function shiftPeriod(view: SampleUpdateView, date: string, step: -1 | 1): string {
  if (view === 'daily') return addDays(date, step);
  if (view === 'weekly') return addDays(date, 7 * step);
  const d = parse(date);
  return formatIsoDate(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + step, 1)));
}

export function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Today in a time zone (YYYY-MM-DD). */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
