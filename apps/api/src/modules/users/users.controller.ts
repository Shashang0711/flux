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
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequireSystemAdmin } from '../auth/decorators';
import { UsersService } from './users.service';

const listQuerySchema = pageQuerySchema.extend(userListFilterSchema.shape);

@Controller('users')
@RequireSystemAdmin()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & UserListFilter,
  ): Promise<Paginated<UserDto>> {
    return this.users.list(query);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string): Promise<UserDto> {
    return this.users.get(id);
  }

  @Post()
  create(
    @Body(new ZodValidationPipe(createUserSchema)) body: z.output<typeof createUserSchema>,
  ): Promise<UserDto> {
    return this.users.create(body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateUserSchema)) body: UpdateUserRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<UserDto> {
    return this.users.update(id, body, actor);
  }

  @Post(':id/reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    await this.users.resetPassword(id, body.password, actor);
  }
}
