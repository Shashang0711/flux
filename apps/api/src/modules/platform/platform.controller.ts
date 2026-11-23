import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  MODULES,
  createTenantSchema,
  setTenantModulesSchema,
  tenantListFilterSchema,
  updateTenantSchema,
  type PageQuery,
  type TenantDto,
  type TenantListFilter,
  type UpdateTenantRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { RequirePlatformAdmin } from '../auth/decorators';
import { TenantsService } from './tenants.service';

const listQuerySchema = pageQuerySchema.extend(tenantListFilterSchema.shape);

/** Platform operator endpoints: tenants and their licensed modules. */
@Controller('platform')
@RequirePlatformAdmin()
export class PlatformController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('modules')
  modules(): typeof MODULES {
    return MODULES;
  }

  @Get('tenants')
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & TenantListFilter,
  ): Promise<Paginated<TenantDto>> {
    return this.tenants.list(query);
  }

  @Get('tenants/:id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<TenantDto> {
    return this.tenants.get(id);
  }

  @Post('tenants')
  create(
    @Body(new ZodValidationPipe(createTenantSchema)) body: z.output<typeof createTenantSchema>,
  ): Promise<TenantDto> {
    return this.tenants.create(body);
  }

  @Patch('tenants/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantRequest,
  ): Promise<TenantDto> {
    return this.tenants.update(id, body);
  }

  @Put('tenants/:id/modules')
  setModules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setTenantModulesSchema))
    body: z.output<typeof setTenantModulesSchema>,
  ): Promise<TenantDto> {
    return this.tenants.setModules(id, body.modules);
  }
}
