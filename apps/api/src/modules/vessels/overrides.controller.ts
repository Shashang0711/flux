import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import {
  notificationEventParamSchema,
  setClientContactVisibilitySchema,
  setVesselBillingSchema,
  updateVesselContactSchema,
  vesselContactSchema,
  vesselNotificationOverrideSchema,
  type NotificationEventKey,
  type VesselLinkSettingsDto,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { OverridesService } from './overrides.service';
import { assertClientsModule } from './relationships.service';

const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));
const uuid = (name: string) => Param(name, ParseUUIDPipe);

/**
 * Vessel-level overrides per vessel–client relationship: billing party, contacts, notification
 * overrides. Need the Vessels and Clients modules; reads vessel.view, changes vessel.manage.
 * Every change returns the resolved settings.
 */
@Controller()
@RequireModule('vessels')
@RequirePermission('vessel.view')
export class OverridesController {
  constructor(private readonly overrides: OverridesService) {}

  @Get('relationships/:id/settings')
  settings(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.settings(tenant, id);
  }

  @Put('relationships/:id/billing')
  @RequirePermission('vessel.manage')
  setBilling(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(setVesselBillingSchema) input: z.output<typeof setVesselBillingSchema>,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.setBilling(tenant, id, input.billingPartyId, user);
  }

  @Post('relationships/:id/contacts')
  @RequirePermission('vessel.manage')
  addContact(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(vesselContactSchema) input: z.output<typeof vesselContactSchema>,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.addContact(tenant, id, input, user);
  }

  @Patch('vessel-contacts/:id')
  @RequirePermission('vessel.manage')
  updateContact(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @body(updateVesselContactSchema) input: z.output<typeof updateVesselContactSchema>,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.updateContact(tenant, id, input, user);
  }

  @Delete('vessel-contacts/:id')
  @RequirePermission('vessel.manage')
  removeContact(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.removeContact(tenant, id, user);
  }

  @Put('relationships/:id/client-contacts/:contactId')
  @RequirePermission('vessel.manage')
  setClientContactVisibility(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @uuid('contactId') contactId: string,
    @body(setClientContactVisibilitySchema)
    input: z.output<typeof setClientContactVisibilitySchema>,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.setClientContactHidden(tenant, id, contactId, input.hidden, user);
  }

  @Put('relationships/:id/notifications/:event')
  @RequirePermission('vessel.manage')
  setNotification(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthUser,
    @uuid('id') id: string,
    @Param('event', new ZodValidationPipe(notificationEventParamSchema))
    event: NotificationEventKey,
    @body(vesselNotificationOverrideSchema)
    input: z.output<typeof vesselNotificationOverrideSchema>,
  ): Promise<VesselLinkSettingsDto> {
    assertClientsModule(user);
    return this.overrides.setNotification(tenant, id, event, input, user);
  }
}
