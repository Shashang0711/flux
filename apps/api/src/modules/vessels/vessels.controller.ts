import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  createVesselSchema,
  updateVesselSchema,
  vesselListFilterSchema,
  type PageQuery,
  type UpdateVesselRequest,
  type VesselDto,
  type VesselListFilter,
  type VesselSummaryDto,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { VesselsService } from './vessels.service';

const listQuerySchema = pageQuerySchema.extend(vesselListFilterSchema.shape);

/** Vessels & Fleets module: reads need vessel.view, changes need vessel.manage. */
@Controller('vessels')
@RequireModule('vessels')
@RequirePermission('vessel.view')
export class VesselsController {
  constructor(private readonly vessels: VesselsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & VesselListFilter,
  ): Promise<Paginated<VesselSummaryDto>> {
    return this.vessels.list(tenant, query);
  }

  @Post()
  @RequirePermission('vessel.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createVesselSchema)) input: z.output<typeof createVesselSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<VesselDto> {
    return this.vessels.create(tenant, input, actor);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VesselDto> {
    return this.vessels.get(tenant, id);
  }

  @Patch(':id')
  @RequirePermission('vessel.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateVesselSchema)) input: UpdateVesselRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<VesselDto> {
    return this.vessels.update(tenant, id, input, actor);
  }
}
