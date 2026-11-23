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
  type AuditLogDto,
  type PageQuery,
  type TenantDto,
  type TenantListFilter,
  type UpdateTenantRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePlatformAdmin } from '../auth/decorators';
import { TenantsService } from './tenants.service';

const listQuerySchema = pageQuerySchema.extend(tenantListFilterSchema.shape);

/** Platform operator endpoints: tenants and their licensed modules. */
@Controller('platform')
@RequirePlatformAdmin()
export class PlatformController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly audit: AuditLogService,
  ) {}

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
    @CurrentUser() actor: AuthUser,
  ): Promise<TenantDto> {
    return this.tenants.create(body, actor);
  }

  @Patch('tenants/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateTenantSchema)) body: UpdateTenantRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<TenantDto> {
    return this.tenants.update(id, body, actor);
  }

  @Put('tenants/:id/modules')
  setModules(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setTenantModulesSchema))
    body: z.output<typeof setTenantModulesSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<TenantDto> {
    return this.tenants.setModules(id, body.modules, actor);
  }

  /** Organisation-level history of a tenant (not its internal activity). */
  @Get('tenants/:id/audit-logs')
  async history(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ): Promise<Paginated<AuditLogDto>> {
    await this.tenants.get(id);
    return this.audit.listForTenant(id, query);
  }
}
