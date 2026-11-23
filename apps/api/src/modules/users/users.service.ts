import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  PageQuery,
  UpdateUserRequest,
  UserDto,
  UserListFilter,
  createUserSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { grantOf, loadRolesForAssignment } from '../roles/role-loader';
import { assertAdministratorRemains, assertNoEscalation, tenantModules } from '../roles/role-rules';
import { USER_ROLES_INCLUDE, toUserDto } from './user.mapper';

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

/** Emails are unique across the platform, since sign-in is by email alone. */
const EMAIL_TAKEN = () =>
  AppException.conflict('A user with this email already exists', {
    fields: [{ path: 'email', message: 'Email is already in use' }],
  });

/**
 * Users of the caller's tenant. Every query runs through TenantDb, so row-level security
 * limits it to that tenant regardless of the `where` clauses below.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
  ) {}

  list(ctx: TenantContext, query: PageQuery & UserListFilter): Promise<Paginated<UserDto>> {
    const where: Prisma.UserWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { name: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.db.run(ctx.tenantId, async (tx) => {
      const [users, total] = await Promise.all([
        tx.user.findMany({
          where,
          include: USER_ROLES_INCLUDE,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.user.count({ where }),
      ]);
      return new Paginated(users.map(toUserDto), total, query);
    });
  }

  async get(ctx: TenantContext, id: string): Promise<UserDto> {
    const user = await this.db.run(ctx.tenantId, (tx) =>
      tx.user.findUnique({ where: { id }, include: USER_ROLES_INCLUDE }),
    );
    if (!user) throw AppException.notFound('User', id);
    return toUserDto(user);
  }

  async create(
    ctx: TenantContext,
    input: z.output<typeof createUserSchema>,
    actor: AuthUser,
  ): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.db.run(ctx.tenantId, async (tx) => {
        await this.assertCanAssign(tx, input.roleIds, actor);
        return tx.user.create({
          data: {
            tenantId: ctx.tenantId,
            email: input.email,
            name: input.name,
            passwordHash,
            userRoles: {
              // tenant_id comes from the user through the composite relation.
              create: input.roleIds.map((roleId) => ({ roleId, assignedById: actor.id })),
            },
          },
          include: USER_ROLES_INCLUDE,
        });
      });
      return toUserDto(user);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw EMAIL_TAKEN();
      throw error;
    }
  }

  async update(
    ctx: TenantContext,
    id: string,
    input: UpdateUserRequest,
    actor: AuthUser,
  ): Promise<UserDto> {
    if (actor.id === id && input.status === 'DISABLED') {
      throw AppException.badRequest('You cannot disable your own account');
    }
    try {
      const user = await this.db.run(ctx.tenantId, async (tx) => {
        if (input.status === 'DISABLED') {
          await assertAdministratorRemains(tx, { removingUserIds: [id] });
        }
        const updated = await tx.user.update({
          where: { id },
          data: input,
          include: USER_ROLES_INCLUDE,
        });
        if (input.status === 'DISABLED') await this.sessions.revokeAllForUser(id, { tx });
        return updated;
      });
      return toUserDto(user);
    } catch (error) {
      if (isPrismaError(error, 'P2002')) throw EMAIL_TAKEN();
      // Also what a user of another tenant looks like: invisible under RLS.
      if (isPrismaError(error, 'P2025')) throw AppException.notFound('User', id);
      throw error;
    }
  }

  /**
   * Replaces a user's roles. The actor must hold every permission of each role added or
   * removed (no escalation, and no stripping access you could not grant back), and the
   * tenant must keep an active Administrator.
   */
  async setRoles(
    ctx: TenantContext,
    id: string,
    roleIds: string[],
    actor: AuthUser,
  ): Promise<UserDto> {
    const user = await this.db.run(ctx.tenantId, async (tx) => {
      const existing = await tx.user.findUnique({ where: { id }, include: { userRoles: true } });
      if (!existing) throw AppException.notFound('User', id);

      // Validate the request as sent, so error paths point at the caller's roleIds.
      await loadRolesForAssignment(tx, roleIds);
      const current = existing.userRoles.map((ur) => ur.roleId);
      const added = roleIds.filter((r) => !current.includes(r));
      const removed = current.filter((r) => !roleIds.includes(r));
      await this.assertCanAssign(tx, [...added, ...removed], actor);

      const removedRoles = await tx.role.findMany({
        where: { id: { in: removed }, isSystem: true },
        select: { id: true },
      });
      if (removedRoles.length > 0) await assertAdministratorRemains(tx, { removingUserIds: [id] });

      await tx.userRole.deleteMany({ where: { userId: id, roleId: { in: removed } } });
      await tx.userRole.createMany({
        data: added.map((roleId) => ({
          tenantId: ctx.tenantId,
          userId: id,
          roleId,
          assignedById: actor.id,
        })),
      });
      return tx.user.findUniqueOrThrow({ where: { id }, include: USER_ROLES_INCLUDE });
    });
    return toUserDto(user);
  }

  /** Admin sets a new password for another user and signs them out everywhere. */
  async resetPassword(
    ctx: TenantContext,
    id: string,
    password: string,
    actor: AuthUser,
  ): Promise<void> {
    if (actor.id === id) {
      throw AppException.badRequest('Use change password to change your own password');
    }
    const passwordHash = await hashPassword(password);
    await this.db.run(ctx.tenantId, async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { passwordHash } });
      if (count === 0) throw AppException.notFound('User', id);
      await this.sessions.revokeAllForUser(id, { tx });
    });
  }

  private async assertCanAssign(tx: TenantTx, roleIds: string[], actor: AuthUser): Promise<void> {
    if (roleIds.length === 0) return;
    const licensed = await tenantModules(tx);
    const roles = await loadRolesForAssignment(tx, roleIds);
    for (const role of roles) assertNoEscalation(actor, grantOf(role, licensed), licensed);
  }
}
