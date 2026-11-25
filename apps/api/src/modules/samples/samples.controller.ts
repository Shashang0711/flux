import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  batchListQuerySchema,
  receiveAndRegisterSchema,
  registerBatchSchema,
  registrationDraftQuerySchema,
  sampleListQuerySchema,
  type BatchDto,
  type BatchSummaryDto,
  type PageQuery,
  type ReceiveRegisterOptionsDto,
  type RegistrationDraftDto,
  type SampleDto,
  type SampleListQuery,
  type SampleSummaryDto,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { SamplesService } from './samples.service';

type Out<T extends z.ZodType> = z.output<T>;
const uuid = (name = 'id') => Param(name, ParseUUIDPipe);
const batchListQuery = pageQuerySchema.extend(batchListQuerySchema.shape);
const sampleListQuery = pageQuerySchema.extend(sampleListQuerySchema.shape);

/** Sample Management module: reads need sample.view, registration sample.register. */
@Controller('samples')
@RequireModule('samples')
@RequirePermission('sample.view')
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get('registration-draft')
  @RequirePermission('sample.register')
  draft(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Query(new ZodValidationPipe(registrationDraftQuerySchema))
    q: Out<typeof registrationDraftQuerySchema>,
  ): Promise<RegistrationDraftDto> {
    return this.samples.draft(t, u, q.kitIds);
  }

  /** Registers the kits as one batch, one sample per kit, in a single transaction. */
  @Post('batches')
  @RequirePermission('sample.register')
  register(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(registerBatchSchema)) input: Out<typeof registerBatchSchema>,
  ): Promise<BatchDto> {
    return this.samples.register(t, u, input);
  }

  @Get('receive-register-options')
  @RequirePermission('sample.register', 'receiving.receive')
  receiveRegisterOptions(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
  ): Promise<ReceiveRegisterOptionsDto> {
    return this.samples.receiveRegisterOptions(t, u);
  }

  /** Receive & Register: receive a package's kits and register them as one batch, atomically. */
  @Post('receive-and-register')
  @RequirePermission('sample.register', 'receiving.receive')
  receiveAndRegister(
    @CurrentTenant() t: TenantContext,
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(receiveAndRegisterSchema))
    input: Out<typeof receiveAndRegisterSchema>,
  ): Promise<BatchDto> {
    return this.samples.receiveAndRegister(t, u, input);
  }

  @Get('batches')
  batches(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(batchListQuery)) q: PageQuery & Out<typeof batchListQuerySchema>,
  ): Promise<Paginated<BatchSummaryDto>> {
    return this.samples.listBatches(t, q, q);
  }

  @Get('batches/:id')
  batch(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<BatchDto> {
    return this.samples.getBatch(t, id);
  }

  @Get()
  list(
    @CurrentTenant() t: TenantContext,
    @Query(new ZodValidationPipe(sampleListQuery)) q: PageQuery & SampleListQuery,
  ): Promise<Paginated<SampleSummaryDto>> {
    return this.samples.listSamples(t, q, q);
  }

  @Get(':id')
  sample(@CurrentTenant() t: TenantContext, @uuid() id: string): Promise<SampleDto> {
    return this.samples.getSample(t, id);
  }
}
