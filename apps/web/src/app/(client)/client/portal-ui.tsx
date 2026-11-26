import 'server-only';
import { cookies } from 'next/headers';
import { PORTAL_SAMPLE_STATUSES, isTimeZone, type PortalSampleStatus } from '@flux/shared';
import { TIME_ZONE_COOKIE } from '@/lib/time-zone';

const TONE: Record<PortalSampleStatus, string> = {
  RECEIVED: 'badge-muted',
  IN_TESTING: 'badge-warn',
  PUBLISHED: 'badge-ok',
};

export function portalStatusLabel(status: PortalSampleStatus): string {
  return PORTAL_SAMPLE_STATUSES.find((s) => s.key === status)!.label;
}

/** Received / In testing / Report published. */
export function PortalStatusBadge({ status }: { status: PortalSampleStatus }) {
  return <span className={`badge ${TONE[status]}`}>{portalStatusLabel(status)}</span>;
}

/** Formats dates in the viewer's time zone (from the cookie the shell sets). */
export async function dateFormatter(): Promise<(iso: string) => string> {
  const raw = (await cookies()).get(TIME_ZONE_COOKIE)?.value;
  const tz = raw ? decodeURIComponent(raw) : 'UTC';
  const format = new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeZone: isTimeZone(tz) ? tz : 'UTC',
  });
  return (iso) => format.format(new Date(iso));
}
