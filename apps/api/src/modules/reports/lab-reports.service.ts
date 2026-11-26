import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  formatLabReportCode,
  type DownloadLinkDto,
  type FieldIssue,
  type LabReportDto,
  type LabReportListQuery,
  type LabReportSummaryDto,
  type PageQuery,
  type addReportVersionSchema,
  type createLabReportSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { nextSequence } from '../../database/sequences';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { FilesService, toFileDto } from '../files/files.service';

const SUMMARY_INCLUDE = {
  batch: { select: { id: true, code: true } },
  serviceType: { select: { id: true, code: true, name: true } },
  _count: { select: { samples: true } },
} satisfies Prisma.LabReportInclude;

const DETAIL_INCLUDE = {
  ...SUMMARY_INCLUDE,
  samples: {
    include: {
      sample: {
        select: {
          id: true,
          code: true,
          vessel: { select: { name: true } },
          client: { select: { name: true } },
        },
      },
    },
    orderBy: { sample: { code: 'asc' } },
  },
  versions: {
    include: { file: { include: { uploadedBy: { select: { name: true } } } } },
    orderBy: { version: 'desc' },
  },
} satisfies Prisma.LabReportInclude;

type SummaryRow = Prisma.LabReportGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailRow = Prisma.LabReportGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function toSummary(r: SummaryRow): LabReportSummaryDto {
  return {
    id: r.id,
    code: r.code,
    status: r.status,
    batch: r.batch,
    serviceType: r.serviceType,
    sampleCount: r._count.samples,
    currentVersion: r.currentVersion,
    submittedAt: r.submittedAt.toISOString(),
  };
}

function toDetail(r: DetailRow): LabReportDto {
  return {
    ...toSummary(r),
    samples: r.samples.map((s) => ({
      id: s.sample.id,
      code: s.sample.code,
      vessel: s.sample.vessel?.name ?? null,
      client: s.sample.client.name,
    })),
    versions: r.versions.map((v) => ({
      version: v.version,
      file: toFileDto(v.file),
      note: v.note,
      uploadedAt: v.uploadedAt.toISOString(),
      uploadedBy: v.file.uploadedBy?.name ?? null,
    })),
  };
}

function invalid(message: string, details: FieldIssue[]): AppException {
  return new AppException(HttpStatus.BAD_REQUEST, ErrorCode.VALIDATION_ERROR, message, details);
}

/**
 * Lab reports (design pack §8/§9): the lab uploads a PDF covering one or more completed samples
 * of a batch. Uploading submits it for Admin review (M15) and turns its samples yellow; replacing
 * the file adds a version.
 */
@Injectable()
export class LabReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly files: FilesService,
  ) {}

  create(
    ctx: TenantContext,
    user: AuthUser,
    input: z.output<typeof createLabReportSchema>,
  ): Promise<LabReportDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const batch = await tx.registrationBatch.findUnique({ where: { id: input.batchId } });
      if (!batch)
        throw invalid('Request validation failed', [
          { path: 'batchId', message: 'Choose a batch' },
        ]);
      const samples = await tx.sample.findMany({
        where: { id: { in: input.sampleIds } },
        include: { labReportLinks: { include: { report: { select: { code: true } } } } },
      });
      const issues: FieldIssue[] = [];
      if (
        samples.length !== input.sampleIds.length ||
        samples.some((s) => s.batchId !== batch.id)
      ) {
        issues.push({ path: 'sampleIds', message: `Choose samples of batch ${batch.code}` });
      }
      for (const s of samples) {
        if (s.status !== 'RESULTS_ENTERED') {
          issues.push({ path: 'sampleIds', message: `${s.code}: results are not complete yet` });
        }
        const existing = s.labReportLinks[0]?.report;
        if (existing)
          issues.push({
            path: 'sampleIds',
            message: `${s.code} is already in report ${existing.code}`,
          });
      }
      if (issues.length > 0) throw invalid('These samples cannot be reported', issues);
      await this.files.claim(tx, user, input.fileId, 'LAB_REPORT');

      const year = new Date().getUTCFullYear();
      const code = formatLabReportCode(
        year,
        await nextSequence(tx, ctx.tenantId, `lab-report:${year}`),
      );
      let reportId: string;
      try {
        const report = await tx.labReport.create({
          data: {
            tenantId: ctx.tenantId,
            code,
            batchId: batch.id,
            serviceTypeId: batch.serviceTypeId,
            versions: {
              // tenant_id comes from the parent report (composite relation).
              create: {
                version: 1,
                fileId: input.fileId,
                note: input.note ?? null,
                uploadedById: user.id,
              },
            },
          },
        });
        reportId = report.id;
        await tx.labReportSample.createMany({
          data: samples.map((s) => ({
            tenantId: ctx.tenantId,
            reportId: report.id,
            batchId: batch.id,
            sampleId: s.id,
          })),
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw AppException.conflict(
            'One of these samples was put in another report in the meantime',
          );
        }
        throw error;
      }
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor: user,
        action: 'report.submitted',
        entity: { type: 'lab-report', id: reportId, label: code },
        relatedIds: [batch.id, ...samples.map((s) => s.id)],
        changes: { samples: { added: samples.map((s) => s.code).sort(), removed: [] } },
      });
      return this.detail(tx, reportId);
    });
  }

  /** Replaces the report file with a new version (before Admin has accepted it). */
  addVersion(
    ctx: TenantContext,
    user: AuthUser,
    id: string,
    input: z.output<typeof addReportVersionSchema>,
  ): Promise<LabReportDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const report = await tx.labReport.findUnique({ where: { id } });
      if (!report) throw AppException.notFound('Lab report', id);
      if (report.status === 'READY_TO_PUBLISH') {
        throw AppException.badRequest(
          'This report is ready to publish and can no longer be replaced',
        );
      }
      await this.files.claim(tx, user, input.fileId, 'LAB_REPORT');
      const version = report.currentVersion + 1;
      await tx.labReportVersion.create({
        data: {
          tenantId: ctx.tenantId,
          reportId: id,
          version,
          fileId: input.fileId,
          note: input.note ?? null,
          uploadedById: user.id,
        },
      });
      await tx.labReport.update({
        where: { id },
        data: { currentVersion: version, status: 'SUBMITTED', submittedAt: new Date() },
      });
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor: user,
        action: 'report.version_uploaded',
        entity: { type: 'lab-report', id, label: report.code },
        relatedIds: [report.batchId],
        changes: {
          version: { from: report.currentVersion, to: version },
          ...(report.status !== 'SUBMITTED'
            ? { status: { from: report.status, to: 'SUBMITTED' } }
            : {}),
        },
      });
      return this.detail(tx, id);
    });
  }

  list(
    ctx: TenantContext,
    query: LabReportListQuery,
    page: PageQuery,
  ): Promise<Paginated<LabReportSummaryDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.LabReportWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.batchId ? { batchId: query.batchId } : {}),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' } },
                { batch: { code: { contains: query.q, mode: 'insensitive' } } },
                {
                  samples: {
                    some: { sample: { code: { contains: query.q, mode: 'insensitive' } } },
                  },
                },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.labReport.findMany({
          where,
          include: SUMMARY_INCLUDE,
          orderBy: { submittedAt: 'desc' },
          ...toSkipTake(page),
        }),
        tx.labReport.count({ where }),
      ]);
      return new Paginated(rows.map(toSummary), total, page);
    });
  }

  get(ctx: TenantContext, id: string): Promise<LabReportDto> {
    return this.db.run(ctx.tenantId, (tx) => this.detail(tx, id));
  }

  /** A short-lived link to one version's file (latest when no version is given). */
  downloadLink(ctx: TenantContext, id: string, version?: number): Promise<DownloadLinkDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const report = await tx.labReport.findUnique({ where: { id } });
      if (!report) throw AppException.notFound('Lab report', id);
      const v = await tx.labReportVersion.findUnique({
        where: { reportId_version: { reportId: id, version: version ?? report.currentVersion } },
      });
      if (!v) throw AppException.notFound('Report version');
      return this.files.link(v.fileId);
    });
  }

  private async detail(tx: TenantTx, id: string): Promise<LabReportDto> {
    const row = await tx.labReport.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw AppException.notFound('Lab report', id);
    return toDetail(row);
  }
}
