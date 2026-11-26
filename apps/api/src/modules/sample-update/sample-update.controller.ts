import { Controller, Get, Query } from '@nestjs/common';
import {
  sampleUpdateQuerySchema,
  type PageQuery,
  type SampleSummaryDto,
  type SampleUpdateGridDto,
  type SampleUpdateOptionsDto,
  type SampleUpdateQuery,
} from '@flux/shared';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { TenantContext } from '../auth/auth.types';
import { CurrentTenant, RequireModule, RequirePermission } from '../auth/decorators';
import { SampleUpdateService } from './sample-update.service';

const listQuery = pageQuerySchema.extend(sampleUpdateQuerySchema.shape);

/**
 * Sample Update page (design pack §9, `GET /sample-updates?view=…`). Needs the Sample Management
 * module and report.view ("View reports and sample status").
 */
@Controller('sample-updates')
@RequireModule('samples')
@RequirePermission('report.view')
export class SampleUpdateController {
  constructor(private readonly updates: SampleUpdateService) {}

  /** Monthly, weekly or daily grid (rows: vessel + service type). */
  @Get()
  grid(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(sampleUpdateQuerySchema)) q: SampleUpdateQuery,
  ): Promise<SampleUpdateGridDto> {
    return this.updates.grid(t, q);
  }

  /** List view: one row per sample, paginated. */
  @Get('list')
  list(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(listQuery)) q: PageQuery & SampleUpdateQuery,
  ): Promise<Paginated<SampleSummaryDto>> {
    return this.updates.list(t, q, q);
  }

  @Get('options')
  options(@CurrentTenant() t: TenantContext): Promise<SampleUpdateOptionsDto> {
    return this.updates.options(t);
  }
}
