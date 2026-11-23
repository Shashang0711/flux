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
  Query,
} from '@nestjs/common';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userListFilterSchema,
  type PageQuery,
  type ResetPasswordRequest,
  type UpdateUserRequest,
  type UserDto,
  type UserListFilter,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequireTenantAdmin } from '../auth/decorators';
import { UsersService } from './users.service';

const listQuerySchema = pageQuerySchema.extend(userListFilterSchema.shape);

/** Users of the caller's own tenant. */
@Controller('users')
@RequireTenantAdmin()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & UserListFilter,
  ): Promise<Paginated<UserDto>> {
    return this.users.list(tenant, query);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserDto> {
    return this.users.get(tenant, id);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
  ): Promise<UserDto> {
    return this.users.create(tenant, body);
  }

  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<UserDto> {
    return this.users.update(tenant, id, body, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    await this.users.resetPassword(tenant, id, body.password, actor);
  }
}
