import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  portalReportQuerySchema,
  portalSampleQuerySchema,
  type DownloadLinkDto,
  type PageQuery,
  type PortalOptionsDto,
  type PortalOverviewDto,
  type PortalReportDetailDto,
  type PortalReportDto,
  type PortalReportQuery,
  type PortalSampleDetailDto,
  type PortalSampleDto,
  type PortalSampleQuery,
} from '@flux/shared';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import {
  AllowClientUsers,
  CurrentClient,
  RequireModule,
  RequirePermission,
  type ClientContext,
} from '../auth/decorators';
import { PortalService } from './portal.service';

const sampleQuery = pageQuerySchema.extend(portalSampleQuerySchema.shape);
const reportQuery = pageQuerySchema.extend(portalReportQuerySchema.shape);

/** The client portal API: client users only (CurrentClient rejects staff). */
@Controller('portal')
@AllowClientUsers()
@RequireModule('client-portal')
@RequirePermission('client-portal.view')
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('overview')
  overview(@CurrentClient() client: ClientContext): Promise<PortalOverviewDto> {
    return this.portal.overview(client);
  }

  @Get('options')
  options(@CurrentClient() client: ClientContext): Promise<PortalOptionsDto> {
    return this.portal.options(client);
  }

  @Get('samples')
  samples(
    @CurrentClient() client: ClientContext,
    @Query(new ZodValidationPipe(sampleQuery)) query: PageQuery & PortalSampleQuery,
  ): Promise<Paginated<PortalSampleDto>> {
    return this.portal.samples(client, query);
  }

  @Get('samples/:id')
  sample(
    @CurrentClient() client: ClientContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortalSampleDetailDto> {
    return this.portal.sample(client, id);
  }

  @Get('reports')
  reports(
    @CurrentClient() client: ClientContext,
    @Query(new ZodValidationPipe(reportQuery)) query: PageQuery & PortalReportQuery,
  ): Promise<Paginated<PortalReportDto>> {
    return this.portal.reports(client, query);
  }

  @Get('reports/:id')
  report(
    @CurrentClient() client: ClientContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PortalReportDetailDto> {
    return this.portal.report(client, id);
  }

  @Get('reports/:id/download-link')
  downloadLink(
    @CurrentClient() client: ClientContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DownloadLinkDto> {
    return this.portal.reportDownloadLink(client, id);
  }
}
