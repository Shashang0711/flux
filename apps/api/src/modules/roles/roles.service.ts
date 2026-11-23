import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  MODULES,
  PERMISSIONS,
  PORTALS,
  type ModuleKey,
  type PageQuery,
  type PermissionKey,
  type PortalKey,
  type RoleDto,
  type RoleListFilter,
  type RoleSummaryDto,
  type RoleUserDto,
  type UpdateRoleRequest,
  cloneRoleSchema,
  createRoleSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { compactChanges, fieldChanges, listChange, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { ROLE_GRANT_INCLUDE, grantOf } from './role-loader';
import {
  assertAdministratorRemains,
  assertGrantIsValid,
  assertNoEscalation,
  tenantModules,
  type RoleGrant,
} from './role-rules';

const NAME_TAKEN = () =>
  AppException.conflict('A role with this name already exists', {
    fields: [{ path: 'name', message: 'Name is already in use' }],
  });

const SYSTEM_ROLE_LOCKED = () =>
  AppException.badRequest('The built-in Administrator role cannot be changed');

type RoleRow = Prisma.RoleGetPayload<{
  include: typeof ROLE_GRANT_INCLUDE & { _count: { select: { userRoles: true } } };
}>;

function toSummary(role: Omit<RoleRow, 'portals' | 'modules' | 'permissions'>): RoleSummaryDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    defaultPortal: role.defaultPortal,
    isActive: role.isActive,
    isSystem: role.isSystem,
    userCount: role._count.userRoles,
    createdAt: role.createdAt.toISOString(),
    updatedAt: role.updatedAt.toISOString(),
  };
}

function toRoleDto(role: RoleRow, licensed: readonly ModuleKey[]): RoleDto {
  const grant = grantOf(role, licensed);
  // Catalogue order, for stable output.
  return {
    ...toSummary(role),
    portals: PORTALS.map((p) => p.key).filter((k) => grant.portals.includes(k)),
    modules: MODULES.map((m) => m.key).filter((k) => grant.modules.includes(k)),
    permissions: PERMISSIONS.map((p) => p.key).filter((k) => grant.permissions.includes(k)),
  };
}

const ROLE_INCLUDE = {
  ...ROLE_GRANT_INCLUDE,
  _count: { select: { userRoles: true } },
} as const;

const EMPTY_GRANT: RoleGrant = { portals: [], modules: [], permissions: [] };

/** Audit view of a grant change: one {added, removed} per list that differs. */
function grantChanges(before: RoleGrant, after: RoleGrant) {
  return {
    portals: listChange(before.portals, after.portals),
    modules: listChange(before.modules, after.modules),
    permissions: listChange(before.permissions, after.permissions),
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Roles of the caller's tenant (all access through TenantDb / row-level security). */
@Injectable()
export class RolesService {
  constructor(private readonly db: TenantDb) {}

  list(ctx: TenantContext, query: PageQuery & RoleListFilter): Promise<Paginated<RoleSummaryDto>> {
    const where: Prisma.RoleWhereInput = {
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}),
    };
    return this.db.run(ctx.tenantId, async (tx) => {
      const [roles, total] = await Promise.all([
        tx.role.findMany({
          where,
          include: { _count: { select: { userRoles: true } } },
          orderBy: [{ isSystem: 'desc' }, { name: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.role.count({ where }),
      ]);
      return new Paginated(roles.map(toSummary), total, query);
    });
  }

  get(ctx: TenantContext, id: string): Promise<RoleDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const role = await this.find(tx, id);
      return toRoleDto(role, await tenantModules(tx));
    });
  }

  async create(
    ctx: TenantContext,
    input: z.output<typeof createRoleSchema>,
    actor: AuthUser,
  ): Promise<RoleDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const licensed = await tenantModules(tx);
        const grant: RoleGrant = {
          portals: input.portals,
          modules: input.modules,
          permissions: input.permissions,
        };
        assertGrantIsValid(grant, licensed);
        assertNoEscalation(actor, grant, licensed);
        const role = await tx.role.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            description: input.description ?? null,
            defaultPortal: input.defaultPortal,
            isActive: input.isActive,
          },
        });
        await this.writeGrant(tx, ctx.tenantId, role.id, grant);
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'role.created',
          entity: { type: 'role', id: role.id, label: role.name },
          changes: compactChanges({
            ...fieldChanges(null, role, ['name', 'description', 'defaultPortal', 'isActive']),
            ...grantChanges(EMPTY_GRANT, grant),
          }),
        });
        return toRoleDto(await this.find(tx, role.id), licensed);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw NAME_TAKEN();
      throw error;
    }
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: UpdateRoleRequest,
    actor: AuthUser,
  ): Promise<RoleDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const role = await this.find(tx, id);
        if (role.isSystem) throw SYSTEM_ROLE_LOCKED();
        if (input.defaultPortal && !role.portals.some((p) => p.portal === input.defaultPortal)) {
          throw AppException.badRequest('The default portal must be one of the role’s portals', {
            fields: [{ path: 'defaultPortal', message: 'Add this portal to the role first' }],
          });
        }
        if (input.isActive === false) {
          // Deactivating removes the role's access from all its users at once.
          await tx.$queryRaw`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
        }
        const updated = await tx.role.update({ where: { id }, data: input });
        const changes = fieldChanges(role, updated, [
          'name',
          'description',
          'defaultPortal',
          'isActive',
        ]);
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, {
            tenantId: ctx.tenantId,
            actor,
            action: changes.isActive
              ? updated.isActive
                ? 'role.activated'
                : 'role.deactivated'
              : 'role.updated',
            entity: { type: 'role', id, label: updated.name },
            changes,
          });
        }
        return toRoleDto(await this.find(tx, id), await tenantModules(tx));
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw NAME_TAKEN();
      throw error;
    }
  }

  /** Portal Access tab. */
  setPortals(
    ctx: TenantContext,
    id: string,
    portals: PortalKey[],
    actor: AuthUser,
  ): Promise<RoleDto> {
    return this.replaceGrant(
      ctx,
      id,
      actor,
      'role.portals_changed',
      (current) => ({ ...current, portals }),
      { validateDefaultPortal: true },
    );
  }

  /** Module Access tab. Permissions of removed modules are dropped. */
  setModules(
    ctx: TenantContext,
    id: string,
    modules: ModuleKey[],
    actor: AuthUser,
  ): Promise<RoleDto> {
    return this.replaceGrant(ctx, id, actor, 'role.modules_changed', (current) => ({
      ...current,
      modules,
      permissions: current.permissions.filter((key) =>
        modules.includes(PERMISSIONS.find((p) => p.key === key)!.module),
      ),
    }));
  }

  /** Role Permissions tab. */
  setPermissions(
    ctx: TenantContext,
    id: string,
    permissions: PermissionKey[],
    actor: AuthUser,
  ): Promise<RoleDto> {
    return this.replaceGrant(ctx, id, actor, 'role.permissions_changed', (current) => ({
      ...current,
      permissions,
    }));
  }

  /** Clone From → New Role Name, copying only the selected parts. */
  async clone(
    ctx: TenantContext,
    sourceId: string,
    input: z.output<typeof cloneRoleSchema>,
    actor: AuthUser,
  ): Promise<RoleDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const source = await this.find(tx, sourceId);
        const licensed = await tenantModules(tx);
        const from = grantOf(source, licensed);
        const portals = input.copyPortals ? from.portals : [source.defaultPortal];
        const modules = input.copyModules ? from.modules : [];
        const grant: RoleGrant = {
          portals,
          modules,
          // Permissions are only meaningful with their modules.
          permissions: input.copyPermissions
            ? from.permissions.filter((key) =>
                modules.includes(PERMISSIONS.find((p) => p.key === key)!.module),
              )
            : [],
        };
        assertGrantIsValid(grant, licensed);
        assertNoEscalation(actor, grant, licensed);
        const role = await tx.role.create({
          data: {
            tenantId: ctx.tenantId,
            name: input.name,
            description: source.description,
            defaultPortal: portals.includes(source.defaultPortal)
              ? source.defaultPortal
              : portals[0]!,
          },
        });
        await this.writeGrant(tx, ctx.tenantId, role.id, grant);
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'role.cloned',
          entity: { type: 'role', id: role.id, label: role.name },
          relatedIds: [source.id],
          changes: compactChanges({
            clonedFrom: { from: null, to: source.name },
            ...fieldChanges(null, role, ['name', 'defaultPortal']),
            ...grantChanges(EMPTY_GRANT, grant),
          }),
        });
        return toRoleDto(await this.find(tx, role.id), licensed);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw NAME_TAKEN();
      throw error;
    }
  }

  /** Assigned Users tab. */
  users(ctx: TenantContext, id: string): Promise<RoleUserDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.find(tx, id);
      const rows = await tx.userRole.findMany({
        where: { roleId: id },
        include: { user: { select: { id: true, email: true, name: true, status: true } } },
        orderBy: { user: { name: 'asc' } },
      });
      return rows.map((r) => ({ ...r.user, assignedAt: r.assignedAt.toISOString() }));
    });
  }

  async addUsers(
    ctx: TenantContext,
    id: string,
    userIds: string[],
    actor: AuthUser,
  ): Promise<RoleUserDto[]> {
    await this.db.run(ctx.tenantId, async (tx) => {
      const role = await this.find(tx, id);
      const licensed = await tenantModules(tx);
      assertNoEscalation(actor, grantOf(role, licensed), licensed);
      const users = await tx.user.findMany({
        where: { id: { in: userIds } },
        select: {
          id: true,
          name: true,
          userRoles: { where: { roleId: id }, select: { roleId: true } },
        },
      });
      if (users.length !== userIds.length) {
        throw AppException.badRequest('One or more users were not found');
      }
      const newlyAssigned = users.filter((u) => u.userRoles.length === 0);
      await tx.userRole.createMany({
        data: newlyAssigned.map((user) => ({
          tenantId: ctx.tenantId,
          userId: user.id,
          roleId: id,
          assignedById: actor.id,
        })),
      });
      if (newlyAssigned.length > 0) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'role.users_assigned',
          entity: { type: 'role', id, label: role.name },
          relatedIds: newlyAssigned.map((u) => u.id),
          changes: { users: { added: newlyAssigned.map((u) => u.name), removed: [] } },
        });
      }
    });
    return this.users(ctx, id);
  }

  async removeUser(ctx: TenantContext, id: string, userId: string, actor: AuthUser): Promise<void> {
    await this.db.run(ctx.tenantId, async (tx) => {
      const role = await this.find(tx, id);
      const licensed = await tenantModules(tx);
      assertNoEscalation(actor, grantOf(role, licensed), licensed);
      if (role.isSystem) await assertAdministratorRemains(tx, { removingUserIds: [userId] });
      const assignment = await tx.userRole.findUnique({
        where: { userId_roleId: { userId, roleId: id } },
        select: { user: { select: { name: true } } },
      });
      if (!assignment) throw AppException.notFound('Role assignment');
      await tx.userRole.delete({ where: { userId_roleId: { userId, roleId: id } } });
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: 'role.user_unassigned',
        entity: { type: 'role', id, label: role.name },
        relatedIds: [userId],
        changes: { users: { added: [], removed: [assignment.user.name] } },
      });
    });
  }

  private async find(tx: TenantTx, id: string): Promise<RoleRow> {
    const role = await tx.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!role) throw AppException.notFound('Role', id);
    return role;
  }

  private replaceGrant(
    ctx: TenantContext,
    id: string,
    actor: AuthUser,
    action: 'role.portals_changed' | 'role.modules_changed' | 'role.permissions_changed',
    change: (current: RoleGrant) => RoleGrant,
    options: { validateDefaultPortal?: boolean } = {},
  ): Promise<RoleDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const role = await this.find(tx, id);
      if (role.isSystem) throw SYSTEM_ROLE_LOCKED();
      const licensed = await tenantModules(tx);
      const current = grantOf(role, licensed);
      const next = change(current);
      assertGrantIsValid(next, licensed);
      assertNoEscalation(actor, next, licensed);
      if (options.validateDefaultPortal && !next.portals.includes(role.defaultPortal)) {
        throw AppException.badRequest('The role’s default portal must stay in its portals', {
          fields: [
            { path: 'portals', message: `Keep ${role.defaultPortal} or change the default first` },
          ],
        });
      }
      await this.writeGrant(tx, ctx.tenantId, id, next, { replace: true });
      await tx.role.update({ where: { id }, data: { updatedAt: new Date() } });
      // Includes knock-on changes, e.g. permissions dropped with their module.
      const changes = compactChanges(grantChanges(current, next));
      if (changes) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action,
          entity: { type: 'role', id, label: role.name },
          changes,
        });
      }
      return toRoleDto(await this.find(tx, id), licensed);
    });
  }

  private async writeGrant(
    tx: TenantTx,
    tenantId: string,
    roleId: string,
    grant: RoleGrant,
    options: { replace?: boolean } = {},
  ): Promise<void> {
    if (options.replace) {
      await tx.rolePortal.deleteMany({ where: { roleId } });
      await tx.roleModule.deleteMany({ where: { roleId } });
      await tx.rolePermission.deleteMany({ where: { roleId } });
    }
    await tx.rolePortal.createMany({
      data: grant.portals.map((portal) => ({ tenantId, roleId, portal })),
    });
    await tx.roleModule.createMany({
      data: grant.modules.map((moduleKey) => ({ tenantId, roleId, moduleKey })),
    });
    await tx.rolePermission.createMany({
      data: grant.permissions.map((permissionKey) => ({ tenantId, roleId, permissionKey })),
    });
  }
}
