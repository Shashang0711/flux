import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import {
  batchResultsInputSchema,
  dryRunQuerySchema,
  sampleResultsInputSchema,
  type BatchResultsDto,
  type SampleResultsDto,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { TestingService } from './testing.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = (name = 'id') => Param(name, ParseUUIDPipe);

/** Under Testing: reads need sample.view, entering and completing results sample.test. */
@Controller('samples')
@RequireModule('samples')
@RequirePermission('sample.view')
export class TestingController {
  constructor(private readonly testing: TestingService) {}

  @Get(':id/results')
  sampleResults(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<SampleResultsDto> {
    return this.testing.sampleResults(t, id);
  }

  @Put(':id/results')
  @RequirePermission('sample.test')
  saveSampleResults(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Body(new ZodValidationPipe(sampleResultsInputSchema))
    input: Out<typeof sampleResultsInputSchema>,
  ): Promise<SampleResultsDto> {
    return this.testing.saveSampleResults(t, u, id, input.results);
  }

  @Post(':id/complete-results')
  @RequirePermission('sample.test')
  complete(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<SampleResultsDto> {
    return this.testing.completeSample(t, u, id);
  }

  @Post(':id/reopen-results')
  @RequirePermission('sample.test')
  reopen(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<SampleResultsDto> {
    return this.testing.reopenSample(t, u, id);
  }

  @Get('batches/:id/results')
  batchResults(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<BatchResultsDto> {
    return this.testing.batchResults(t, id);
  }

  /** Grid and CSV upload; ?dryRun=true validates and previews without saving. */
  @Put('batches/:id/results')
  @RequirePermission('sample.test')
  saveBatchResults(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
    @Query(new ZodValidationPipe(dryRunQuerySchema)) q: Out<typeof dryRunQuerySchema>,
    @Body(new ZodValidationPipe(batchResultsInputSchema))
    input: Out<typeof batchResultsInputSchema>,
  ): Promise<BatchResultsDto> {
    return this.testing.saveBatchResults(t, u, id, input.samples, q.dryRun === 'true');
  }

  @Post('batches/:id/start-testing')
  @RequirePermission('sample.test')
  startTesting(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<BatchResultsDto> {
    return this.testing.startTesting(t, u, id);
  }

  @Post('batches/:id/complete-results')
  @RequirePermission('sample.test')
  completeBatch(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @uuid() id: string,
  ): Promise<BatchResultsDto> {
    return this.testing.completeBatch(t, u, id);
  }
}
