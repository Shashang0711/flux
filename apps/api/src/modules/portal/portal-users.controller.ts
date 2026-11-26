import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  createPortalUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  type PortalUserDto,
  type ResetPasswordRequest,
  type UpdateUserRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireModule, RequirePermission } from '../auth/decorators';
import { PortalUsersService } from './portal-users.service';

/** Portal users tab of a client (staff side). */
@Controller('clients/:clientId/portal-users')
@RequireModule('client-portal')
@RequirePermission('client.view', 'user.view')
export class PortalUsersController {
  constructor(private readonly portalUsers: PortalUsersService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
  ): Promise<PortalUserDto[]> {
    return this.portalUsers.list(tenant, clientId);
  }

  @Post()
  @RequirePermission('client.view', 'user.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Body(new ZodValidationPipe(createPortalUserSchema))
    body: z.output<typeof createPortalUserSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<PortalUserDto> {
    return this.portalUsers.create(tenant, clientId, body, actor);
  }

  @Patch(':id')
  @RequirePermission('client.view', 'user.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<PortalUserDto> {
    return this.portalUsers.update(tenant, clientId, id, body, actor);
  }

  @Post(':id/reset-password')
  @RequirePermission('client.view', 'user.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @CurrentTenant() tenant: TenantContext,
    @Param('clientId', ParseUUIDPipe) clientId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    await this.portalUsers.resetPassword(tenant, clientId, id, body.password, actor);
  }
}
