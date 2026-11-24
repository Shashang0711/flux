import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  CUSTOM_FIELD_ENTITIES,
  createCustomFieldSchema,
  customFieldListQuerySchema,
  updateCustomFieldSchema,
  type CustomFieldDefinitionDto,
  type CustomFieldEntity,
  type UpdateCustomFieldRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequirePermission } from '../auth/decorators';
import { CustomFieldsService } from './custom-fields.service';

/** Record types with custom fields are available only when their module is licensed. */
function assertEntityAvailable(user: AuthUser, entity: CustomFieldEntity): void {
  const def = CUSTOM_FIELD_ENTITIES.find((e) => e.key === entity)!;
  if (!user.modules.includes(def.module)) {
    throw AppException.forbidden(`Your organisation does not use ${def.name.toLowerCase()}`);
  }
}

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly fields: CustomFieldsService) {}

  /** Record types the organisation can add fields to. */
  @Get('entities')
  entities(@CurrentTenant() _tenant: TenantContext, @CurrentUser() user: AuthUser) {
    return CUSTOM_FIELD_ENTITIES.filter((e) => user.modules.includes(e.module));
  }

  /** Any user of the tenant can read definitions (forms need them). */
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(customFieldListQuerySchema))
    query: z.output<typeof customFieldListQuerySchema>,
  ): Promise<CustomFieldDefinitionDto[]> {
    assertEntityAvailable(user, query.entity);
    return this.fields.list(tenant, query.entity, query.view);
  }

  @Post()
  @RequirePermission('custom-field.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createCustomFieldSchema))
    body: z.output<typeof createCustomFieldSchema>,
  ): Promise<CustomFieldDefinitionDto> {
    assertEntityAvailable(user, body.entity);
    return this.fields.create(tenant, body, user);
  }

  @Patch(':id')
  @RequirePermission('custom-field.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema)) body: UpdateCustomFieldRequest,
  ): Promise<CustomFieldDefinitionDto> {
    return this.fields.update(tenant, id, body, user);
  }
}
