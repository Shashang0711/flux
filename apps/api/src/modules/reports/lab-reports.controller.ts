import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  addReportVersionSchema,
  createLabReportSchema,
  labReportListQuerySchema,
  publishReportSchema,
  readyToPublishSchema,
  rejectReportSchema,
  reopenReviewSchema,
  type DownloadLinkDto,
  type LabReportDto,
  type LabReportListQuery,
  type LabReportSummaryDto,
  type NotificationDto,
  type PageQuery,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { LabReportsService } from './lab-reports.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = (name = 'id') => Param(name, ParseUUIDPipe);
const listQuery = pageQuerySchema.extend(labReportListQuerySchema.shape);

/** Reports module: lab reports. Reading needs report.view, uploading report.upload. */
@Controller('lab-reports')
@RequireModule('reports')
@RequirePermission('report.view')
export class LabReportsController {
  constructor(private readonly reports: LabReportsService) {}

  @Get()
  list(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(listQuery)) q: PageQuery & LabReportListQuery,
  ): Promise<Paginated<LabReportSummaryDto>> {
    return this.reports.list(t, q, q);
  }

  @Get(':id')
  get(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<LabReportDto> {
    return this.reports.get(t, id);
  }

  /** Uploading a report submits it for Admin review. */
  @Post()
  @RequirePermission('report.upload')
  create(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(createLabReportSchema)) input: Out<typeof createLabReportSchema>,
  ): Promise<LabReportDto> {
    return this.reports.create(t, u, input);
  }

  @Post(':id/versions')
  @RequirePermission('report.upload')
  addVersion(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(addReportVersionSchema)) input: Out<typeof addReportVersionSchema>,
  ): Promise<LabReportDto> {
    return this.reports.addVersion(t, u, id, input);
  }

  // ─── Admin review ─────────────────────────────────────────────────────────

  /** Back to the lab for correction; the comment says what to correct. */
  @Post(':id/reject')
  @RequirePermission('report.review')
  reject(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(rejectReportSchema)) input: Out<typeof rejectReportSchema>,
  ): Promise<LabReportDto> {
    return this.reports.review(t, u, id, 'REJECTED', input.comment);
  }

  /** Only reports marked ready appear on the Publish page (M16). */
  @Post(':id/ready-to-publish')
  @RequirePermission('report.review')
  readyToPublish(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(readyToPublishSchema)) input: Out<typeof readyToPublishSchema>,
  ): Promise<LabReportDto> {
    return this.reports.review(t, u, id, 'READY_TO_PUBLISH', input.comment ?? null);
  }

  @Post(':id/reopen-review')
  @RequirePermission('report.review')
  reopenReview(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(reopenReviewSchema)) input: Out<typeof reopenReviewSchema>,
  ): Promise<LabReportDto> {
    return this.reports.review(t, u, id, 'REOPENED', input.reason);
  }

  // ─── Publishing ───────────────────────────────────────────────────────────

  /** Releases the final report (PDF), turns the samples green and sends the notifications. */
  @Post(':id/publish')
  @RequirePermission('report.publish')
  publish(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(publishReportSchema)) input: Out<typeof publishReportSchema>,
  ): Promise<LabReportDto> {
    return this.reports.publish(t, u, id, input);
  }

  @Get(':id/final-download-link')
  finalLink(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<DownloadLinkDto> {
    return this.reports.finalDownloadLink(t, id);
  }

  @Get(':id/notifications')
  notifications(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<NotificationDto[]> {
    return this.reports.notificationsOf(t, id);
  }

  @Post(':id/notifications/retry')
  @RequirePermission('report.publish')
  retry(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<NotificationDto[]> {
    return this.reports.retryNotifications(t, u, id);
  }

  @Get(':id/download-link')
  latestLink(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<DownloadLinkDto> {
    return this.reports.downloadLink(t, id);
  }

  @Get(':id/versions/:version/download-link')
  versionLink(
    @CurrentTenant() t: TenantContext,
    @uuid() id: string,
    @Param('version', ParseIntPipe) version: number,
  ): Promise<DownloadLinkDto> {
    return this.reports.downloadLink(t, id, version);
  }
}
