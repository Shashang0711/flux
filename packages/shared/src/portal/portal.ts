import { z } from 'zod';
import type { SessionAccess } from '../access/roles';
import { emailSchema, passwordSchema } from '../identity/users';
import type { ResultFlag } from '../testing/testing';

/**
 * Client portal (design pack §3, §9 "Client portal exposes only records authorised for that
 * client"). Decided for M18:
 * - a client portal user belongs to exactly one client (users.client_id, fixed at creation);
 * - they see the samples registered to that client only, whichever vessel they were taken on;
 * - every sample shows a simple status; result values and the final report appear once the
 *   report is published. Internal versions, review comments and lab attachments never do;
 * - logins are managed on the client page (Portal users tab). Their access is fixed (they get
 *   no roles) and the API refuses them every route not built for the portal.
 */

export const PORTAL_SAMPLE_STATUSES = [
  { key: 'RECEIVED', label: 'Received' },
  { key: 'IN_TESTING', label: 'In testing' },
  { key: 'PUBLISHED', label: 'Report published' },
] as const;
export type PortalSampleStatus = (typeof PORTAL_SAMPLE_STATUSES)[number]['key'];
export const PORTAL_SAMPLE_STATUS_KEYS = PORTAL_SAMPLE_STATUSES.map((s) => s.key) as [
  PortalSampleStatus,
  ...PortalSampleStatus[],
];

/** What a client sees: registered = received; published report = published; else in testing. */
export function portalSampleStatus(sample: {
  status: string;
  reportStatus: string | null | undefined;
}): PortalSampleStatus {
  if (sample.reportStatus === 'PUBLISHED') return 'PUBLISHED';
  return sample.status === 'REGISTERED' ? 'RECEIVED' : 'IN_TESTING';
}

/** The fixed access of a client portal user (nothing if the tenant lacks the module). */
export function clientUserAccess(tenantModules: readonly string[]): SessionAccess {
  if (!tenantModules.includes('client-portal')) {
    return { portals: [], modules: [], permissions: [], defaultPortal: null };
  }
  return {
    portals: ['CLIENT'],
    modules: ['client-portal'],
    permissions: ['client-portal.view'],
    defaultPortal: 'CLIENT',
  };
}

interface Ref {
  id: string;
  name: string;
}

export interface PortalSampleDto {
  id: string;
  code: string;
  status: PortalSampleStatus;
  vessel: (Ref & { imoNumber: string | null }) | null;
  serviceType: Ref;
  kit: { code: string; serialNumber: string | null };
  registeredAt: string;
  /** The published report (null until published). */
  report: { id: string; code: string; publishedAt: string } | null;
  /** Worst result flag, once published. */
  worstFlag: ResultFlag | null;
}

export interface PortalResultDto {
  parameter: string;
  unit: string | null;
  method: string | null;
  /** Formatted for display. */
  value: string;
  flag: ResultFlag | null;
}

export interface PortalSampleDetailDto extends PortalSampleDto {
  /** Result values, once the report is published (null before). */
  results: PortalResultDto[] | null;
}

export interface PortalReportDto {
  id: string;
  code: string;
  serviceType: Ref;
  publishedAt: string;
  /** Only this client's samples in the report. */
  sampleCount: number;
  vessels: string[];
  worstFlag: ResultFlag | null;
}

export interface PortalReportDetailDto extends PortalReportDto {
  samples: PortalSampleDto[];
}

export interface PortalOverviewDto {
  client: { id: string; code: string; name: string };
  counts: Record<PortalSampleStatus, number>;
  vesselCount: number;
  recentReports: PortalReportDto[];
}

export interface PortalOptionsDto {
  vessels: Ref[];
  serviceTypes: Ref[];
}

export const portalSampleQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(PORTAL_SAMPLE_STATUS_KEYS).optional(),
  vesselId: z.uuid().optional(),
  serviceTypeId: z.uuid().optional(),
});
export type PortalSampleQuery = z.output<typeof portalSampleQuerySchema>;

export const portalReportQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  vesselId: z.uuid().optional(),
});
export type PortalReportQuery = z.output<typeof portalReportQuerySchema>;

// ─── Portal users (managed by the lab on the client page) ───────────────────

export interface PortalUserDto {
  id: string;
  email: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  lastLoginAt: string | null;
  createdAt: string;
}

export const createPortalUserSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1, 'Name is required').max(200),
  password: passwordSchema,
});
export type CreatePortalUserRequest = z.input<typeof createPortalUserSchema>;
