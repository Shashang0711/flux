import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  MODULES,
  PERMISSIONS,
  PORTALS,
  cloneRoleSchema,
  createRoleSchema,
  roleListFilterSchema,
  roleUserIdsSchema,
  setRoleModulesSchema,
  setRolePermissionsSchema,
  setRolePortalsSchema,
  updateRoleSchema,
  type PageQuery,
  type RoleDto,
  type RoleListFilter,
  type RoleSummaryDto,
  type RoleUserDto,
  type UpdateRoleRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { Paginated, pageQuerySchema } from '../../common/pagination/pagination';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CurrentTenant, CurrentUser, RequirePermission } from '../auth/decorators';
import { RolesService } from './roles.service';

const listQuerySchema = pageQuerySchema.extend(roleListFilterSchema.shape);
const body = <T extends z.ZodType>(schema: T) => Body(new ZodValidationPipe(schema));

/** The permission catalogue as it applies to the caller's tenant (licensed modules only). */
@Controller('access')
@RequirePermission('role.view')
export class AccessCatalogueController {
  @Get('catalogue')
  catalogue(@CurrentUser() user: AuthUser) {
    const licensed = user.modules;
    return {
      modules: MODULES.filter((m) => licensed.includes(m.key)),
      portals: PORTALS.filter(
        (p) => p.requiresModule === null || licensed.includes(p.requiresModule),
      ),
      permissions: PERMISSIONS.filter((p) => licensed.includes(p.module)),
    };
  }
}

/**
 * Roles of the caller's tenant: list/create, and the role tabs from the specification:
 * Portal Access, Module Access, Role Permissions and Assigned Users.
 */
@Controller('roles')
@RequirePermission('role.view')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuerySchema)) query: PageQuery & RoleListFilter,
  ): Promise<Paginated<RoleSummaryDto>> {
    return this.roles.list(tenant, query);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleDto> {
    return this.roles.get(tenant, id);
  }

  @Post()
  @RequirePermission('role.manage')
  create(
    @CurrentTenant() tenant: TenantContext,
    @body(createRoleSchema) input: z.output<typeof createRoleSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.create(tenant, input, actor);
  }

  @Patch(':id')
  @RequirePermission('role.manage')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(updateRoleSchema) input: UpdateRoleRequest,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.update(tenant, id, input, actor);
  }

  @Put(':id/portals')
  @RequirePermission('role.manage')
  setPortals(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(setRolePortalsSchema) input: z.output<typeof setRolePortalsSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.setPortals(tenant, id, input.portals, actor);
  }

  @Put(':id/modules')
  @RequirePermission('role.manage')
  setModules(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(setRoleModulesSchema) input: z.output<typeof setRoleModulesSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.setModules(tenant, id, input.modules, actor);
  }

  @Put(':id/permissions')
  @RequirePermission('role.manage')
  setPermissions(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(setRolePermissionsSchema) input: z.output<typeof setRolePermissionsSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.setPermissions(tenant, id, input.permissions, actor);
  }

  @Post(':id/clone')
  @RequirePermission('role.manage')
  clone(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(cloneRoleSchema) input: z.output<typeof cloneRoleSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleDto> {
    return this.roles.clone(tenant, id, input, actor);
  }

  @Get(':id/users')
  users(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RoleUserDto[]> {
    return this.roles.users(tenant, id);
  }

  /** Assigning roles is user management, so it needs user.manage. */
  @Post(':id/users')
  @RequirePermission('user.manage')
  addUsers(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @body(roleUserIdsSchema) input: z.output<typeof roleUserIdsSchema>,
    @CurrentUser() actor: AuthUser,
  ): Promise<RoleUserDto[]> {
    return this.roles.addUsers(tenant, id, input.userIds, actor);
  }

  @Delete(':id/users/:userId')
  @RequirePermission('user.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeUser(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<void> {
    await this.roles.removeUser(tenant, id, userId, actor);
  }
}
