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
  REFERENCE_LISTS,
  REFERENCE_LIST_KEYS,
  auditListFilterSchema,
  createReferenceItemSchema,
  referenceListQuerySchema,
  referenceVisibilitySchema,
  updateReferenceItemSchema,
  type AuditListFilter,
  type AuditLogDto,
  type PageQuery,
  type ReferenceItemDto,
  type ReferenceListKey,
  type ReferenceListQuery,
  type UpdateReferenceItemRequest,
} from '@flux/shared';
import { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AuditLogService } from '../audit/audit-log.service';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import {
  CurrentTenant,
  CurrentUser,
  RequirePermission,
  RequirePlatformAdmin,
} from '../auth/decorators';
import { PlatformReferenceDataService } from './platform-reference-data.service';
import { ReferenceDataService } from './reference-data.service';
import { assertListAvailable } from './reference-items';

const listParam = new ZodValidationPipe(z.enum(REFERENCE_LIST_KEYS));

/** Reference data as seen by a tenant: FLUX defaults plus its own items. */
@Controller('reference-data')
export class ReferenceDataController {
  constructor(private readonly reference: ReferenceDataService) {}

  /** Lists available to the caller's organisation (by licensed module). */
  @Get()
  lists(@CurrentTenant() _tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return REFERENCE_LISTS.filter((l) => user.modules.includes(l.module));
  }

  /** Any user of the tenant may read lists (forms need them for dropdowns). */
  @Get(':list')
  items(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('list', listParam) list: ReferenceListKey,
    @Query(new ZodValidationPipe(referenceListQuerySchema)) query: ReferenceListQuery,
  ): Promise<ReferenceItemDto[]> {
    assertListAvailable(user, list);
    return this.reference.list(tenant, list, query);
  }

  @Post(':list')
  @RequirePermission('reference-data.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('list', listParam) list: ReferenceListKey,
    @Body(new ZodValidationPipe(createReferenceItemSchema))
    body: z.output<typeof createReferenceItemSchema>,
  ): Promise<ReferenceItemDto> {
    assertListAvailable(user, list);
    return this.reference.create(tenant, list, body, user);
  }

  @Patch(':list/:id')
  @RequirePermission('reference-data.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('list', listParam) list: ReferenceListKey,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateReferenceItemSchema)) body: UpdateReferenceItemRequest,
  ): Promise<ReferenceItemDto> {
    assertListAvailable(user, list);
    return this.reference.update(tenant, list, id, body, user);
  }

  @Put(':list/:id/visibility')
  @RequirePermission('reference-data.manage')
  setVisibility(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('list', listParam) list: ReferenceListKey,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(referenceVisibilitySchema)) body: { hidden: boolean },
  ): Promise<ReferenceItemDto> {
    assertListAvailable(user, list);
    return this.reference.setVisibility(tenant, list, id, body.hidden, user);
  }
}

/** FLUX defaults, managed by platform admins, and the platform-level audit log. */
@Controller('platform')
@RequirePlatformAdmin()
export class PlatformReferenceDataController {
  constructor(
    private readonly reference: PlatformReferenceDataService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('reference-data')
  lists() {
    return REFERENCE_LISTS;
  }

  @Get('reference-data/:list')
  items(@Param('list', listParam) list: ReferenceListKey): Promise<ReferenceItemDto[]> {
    return this.reference.list(list);
  }

  @Post('reference-data/:list')
  create(
    @Param('list', listParam) list: ReferenceListKey,
    @Body(new ZodValidationPipe(createReferenceItemSchema))
    body: z.output<typeof createReferenceItemSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    return this.reference.create(list, body, actor);
  }

  @Patch('reference-data/:list/:id')
  update(
    @Param('list', listParam) list: ReferenceListKey,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateReferenceItemSchema)) body: UpdateReferenceItemRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    return this.reference.update(list, id, body, actor);
  }

  /** Platform-level audit entries (not any tenant's). */
  @Get('audit-logs')
  auditLogs(
    @Query(new ZodValidationPipe(pageQuerySchema.extend(auditListFilterSchema.shape)))
    query: PageQuery & AuditListFilter,
  ): Promise<Paginated<AuditLogDto>> {
    return this.audit.listPlatform(query);
  }
}
