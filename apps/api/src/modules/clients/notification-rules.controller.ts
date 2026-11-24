import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import {
  clientNotificationRuleSchema,
  notificationEventParamSchema,
  type ClientNotificationRuleDto,
  type NotificationEventKey,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { NotificationRulesService } from './notification-rules.service';

/** The client's notification rules: reads need client.view, changes client.manage. */
@Controller('clients/:id/notification-rules')
@RequireModule('clients')
@RequirePermission('client.view')
export class NotificationRulesController {
  constructor(private readonly rules: NotificationRulesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClientNotificationRuleDto[]> {
    return this.rules.list(tenant, id);
  }

  @Put(':event')
  @RequirePermission('client.manage')
  set(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('event', new ZodValidationPipe(notificationEventParamSchema))
    event: NotificationEventKey,
    @Body(new ZodValidationPipe(clientNotificationRuleSchema))
    input: z.output<typeof clientNotificationRuleSchema>,
  ): Promise<ClientNotificationRuleDto> {
    return this.rules.set(tenant, id, event, input, user);
  }
}
