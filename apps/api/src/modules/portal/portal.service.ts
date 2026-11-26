import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  PORTAL_SAMPLE_STATUS_KEYS,
  formatResultValue,
  portalSampleStatus,
  worstFlag,
  type PageQuery,
  type PortalOptionsDto,
  type PortalOverviewDto,
  type PortalReportDetailDto,
  type PortalReportDto,
  type PortalReportQuery,
  type PortalResultDto,
  type PortalSampleDetailDto,
  type PortalSampleDto,
  type PortalSampleQuery,
  type PortalSampleStatus,
  type DownloadLinkDto,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import type { ClientContext } from '../auth/decorators';
import { FilesService } from '../files/files.service';

const PUBLISHED = { status: 'PUBLISHED' } as const;

/** Where clause for each portal status (published = in a published report). */
function statusWhere(status: PortalSampleStatus): Prisma.SampleWhereInput {
  const published = { labReportLinks: { some: { report: PUBLISHED } } };
  if (status === 'PUBLISHED') return published;
  if (status === 'RECEIVED') return { status: 'REGISTERED', NOT: published };
  return { status: { in: ['UNDER_TESTING', 'RESULTS_ENTERED'] }, NOT: published };
}

const SAMPLE_INCLUDE = {
  vessel: { select: { id: true, name: true, imoNumber: true } },
  serviceType: { select: { id: true, name: true } },
  receivedKit: { select: { code: true, serialNumber: true } },
  labReportLinks: {
    select: { report: { select: { id: true, code: true, status: true, publishedAt: true } } },
  },
  results: { select: { flag: true } },
} satisfies Prisma.SampleInclude;

type SampleRow = Prisma.SampleGetPayload<{ include: typeof SAMPLE_INCLUDE }>;

function toPortalSample(s: SampleRow): PortalSampleDto {
  const report = s.labReportLinks[0]?.report ?? null;
  const status = portalSampleStatus({ status: s.status, reportStatus: report?.status });
  const published = status === 'PUBLISHED' && report?.publishedAt ? report : null;
  return {
    id: s.id,
    code: s.code,
    status,
    vessel: s.vessel,
    serviceType: s.serviceType,
    kit: s.receivedKit,
    registeredAt: s.registeredAt.toISOString(),
    report: published
      ? {
          id: published.id,
          code: published.code,
          publishedAt: published.publishedAt!.toISOString(),
        }
      : null,
    // Flags are lab work in progress until the report is published.
    worstFlag: published ? worstFlag(s.results.map((r) => r.flag)) : null,
  };
}

/**
 * The client portal: everything is limited to samples registered to the caller's client
 * (`clientId` in every query) on top of tenant RLS. A report is visible once published and
 * only through the client's own samples in it.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly db: TenantDb,
    private readonly files: FilesService,
  ) {}

  overview(ctx: ClientContext): Promise<PortalOverviewDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await tx.client.findUniqueOrThrow({
        where: { id: ctx.clientId },
        select: { id: true, code: true, name: true },
      });
      const counts = await Promise.all(
        PORTAL_SAMPLE_STATUS_KEYS.map((status) =>
          tx.sample.count({ where: { clientId: ctx.clientId, ...statusWhere(status) } }),
        ),
      );
      const vessels = await tx.sample.findMany({
        where: { clientId: ctx.clientId, vesselId: { not: null } },
        distinct: ['vesselId'],
        select: { vesselId: true },
      });
      const recent = await this.reportRows(tx, ctx, {}, { skip: 0, take: 5 });
      return {
        client,
        counts: Object.fromEntries(
          PORTAL_SAMPLE_STATUS_KEYS.map((key, i) => [key, counts[i]!]),
        ) as Record<PortalSampleStatus, number>,
        vesselCount: vessels.length,
        recentReports: recent.map((r) => this.toReport(r)),
      };
    });
  }

  options(ctx: ClientContext): Promise<PortalOptionsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const [vessels, serviceTypes] = await Promise.all([
        tx.vessel.findMany({
          where: { samples: { some: { clientId: ctx.clientId } } },
          select: { id: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        tx.serviceType.findMany({
          where: { samples: { some: { clientId: ctx.clientId } } },
          select: { id: true, name: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      ]);
      return { vessels, serviceTypes };
    });
  }

  samples(
    ctx: ClientContext,
    query: PageQuery & PortalSampleQuery,
  ): Promise<Paginated<PortalSampleDto>> {
    const where: Prisma.SampleWhereInput = {
      clientId: ctx.clientId,
      ...(query.vesselId ? { vesselId: query.vesselId } : {}),
      ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
      ...(query.q
        ? {
            OR: [
              { code: { contains: query.q, mode: 'insensitive' } },
              { receivedKit: { code: { contains: query.q, mode: 'insensitive' } } },
              { receivedKit: { serialNumber: { contains: query.q, mode: 'insensitive' } } },
              { vessel: { name: { contains: query.q, mode: 'insensitive' } } },
            ],
          }
        : {}),
      ...(query.status ? { AND: [statusWhere(query.status)] } : {}),
    };
    return this.db.run(ctx.tenantId, async (tx) => {
      const [rows, total] = await Promise.all([
        tx.sample.findMany({
          where,
          include: SAMPLE_INCLUDE,
          orderBy: [{ registeredAt: 'desc' }, { code: 'desc' }],
          ...toSkipTake(query),
        }),
        tx.sample.count({ where }),
      ]);
      return new Paginated(rows.map(toPortalSample), total, query);
    });
  }

  sample(ctx: ClientContext, id: string): Promise<PortalSampleDetailDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const row = await tx.sample.findFirst({
        where: { id, clientId: ctx.clientId },
        include: SAMPLE_INCLUDE,
      });
      if (!row) throw AppException.notFound('Sample', id);
      const sample = toPortalSample(row);
      let results: PortalResultDto[] | null = null;
      if (sample.status === 'PUBLISHED') {
        const values = await tx.sampleResult.findMany({
          where: { sampleId: id },
          include: {
            parameter: {
              select: { name: true, unit: true, method: true, type: true, decimals: true },
            },
          },
          orderBy: [{ parameter: { sortOrder: 'asc' } }, { parameter: { name: 'asc' } }],
        });
        results = values.map((r) => ({
          parameter: r.parameter.name,
          unit: r.parameter.unit,
          method: r.parameter.method,
          value: formatResultValue(r.parameter, r.valueNumber ?? r.valueBoolean ?? r.valueText),
          flag: r.flag,
        }));
      }
      return { ...sample, results };
    });
  }

  reports(
    ctx: ClientContext,
    query: PageQuery & PortalReportQuery,
  ): Promise<Paginated<PortalReportDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where = this.reportWhere(ctx, query);
      const [rows, total] = await Promise.all([
        this.reportRows(tx, ctx, query, toSkipTake(query)),
        tx.labReport.count({ where }),
      ]);
      return new Paginated(
        rows.map((r) => this.toReport(r)),
        total,
        query,
      );
    });
  }

  report(ctx: ClientContext, id: string): Promise<PortalReportDetailDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const row = await this.publishedReport(tx, ctx, id);
      const samples = await tx.sample.findMany({
        where: { clientId: ctx.clientId, labReportLinks: { some: { reportId: id } } },
        include: SAMPLE_INCLUDE,
        orderBy: { code: 'asc' },
      });
      return { ...this.toReport(row), samples: samples.map(toPortalSample) };
    });
  }

  /** The final (published) report file. Never the lab's internal versions. */
  reportDownloadLink(ctx: ClientContext, id: string): Promise<DownloadLinkDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const report = await this.publishedReport(tx, ctx, id);
      if (!report.finalFileId) throw AppException.notFound('Final report');
      return this.files.link(report.finalFileId);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private reportWhere(ctx: ClientContext, query: PortalReportQuery): Prisma.LabReportWhereInput {
    return {
      ...PUBLISHED,
      samples: {
        some: {
          sample: {
            clientId: ctx.clientId,
            ...(query.vesselId ? { vesselId: query.vesselId } : {}),
          },
        },
      },
      ...(query.q ? { code: { contains: query.q, mode: 'insensitive' } } : {}),
    };
  }

  private reportInclude(ctx: ClientContext) {
    return {
      serviceType: { select: { id: true, name: true } },
      // Only this client's samples of the report.
      samples: {
        where: { sample: { clientId: ctx.clientId } },
        select: {
          sample: {
            select: { vessel: { select: { name: true } }, results: { select: { flag: true } } },
          },
        },
      },
    } satisfies Prisma.LabReportInclude;
  }

  private reportRows(
    tx: TenantTx,
    ctx: ClientContext,
    query: PortalReportQuery,
    page: { skip: number; take: number },
  ) {
    return tx.labReport.findMany({
      where: this.reportWhere(ctx, query),
      include: this.reportInclude(ctx),
      orderBy: [{ publishedAt: 'desc' }, { code: 'desc' }],
      ...page,
    });
  }

  private async publishedReport(tx: TenantTx, ctx: ClientContext, id: string) {
    const row = await tx.labReport.findFirst({
      where: { id, ...this.reportWhere(ctx, {}) },
      include: this.reportInclude(ctx),
    });
    // Unpublished, another client's or another tenant's: all look the same.
    if (!row) throw AppException.notFound('Report', id);
    return row;
  }

  private toReport(
    r: Prisma.LabReportGetPayload<{ include: ReturnType<PortalService['reportInclude']> }>,
  ): PortalReportDto {
    const vessels = [
      ...new Set(r.samples.map((s) => s.sample.vessel?.name).filter((n): n is string => !!n)),
    ].sort((a, b) => a.localeCompare(b));
    return {
      id: r.id,
      code: r.code,
      serviceType: r.serviceType,
      publishedAt: r.publishedAt!.toISOString(),
      sampleCount: r.samples.length,
      vessels,
      worstFlag: worstFlag(r.samples.flatMap((s) => s.sample.results.map((x) => x.flag))),
    };
  }
}
