import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CreateUserRequest,
  PageQuery,
  UpdateUserRequest,
  UserDto,
  UserListFilter,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb } from '../../database/tenant-db.service';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { toUserDto } from './user.mapper';

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
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.user.count({ where }),
      ]);
      return new Paginated(users.map(toUserDto), total, query);
    });
  }

  async get(ctx: TenantContext, id: string): Promise<UserDto> {
    const user = await this.db.run(ctx.tenantId, (tx) => tx.user.findUnique({ where: { id } }));
    if (!user) throw AppException.notFound('User', id);
    return toUserDto(user);
  }

  async create(ctx: TenantContext, input: CreateUserRequest): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.db.run(ctx.tenantId, (tx) =>
        tx.user.create({
          data: {
            tenantId: ctx.tenantId,
            email: input.email,
            name: input.name,
            passwordHash,
            isTenantAdmin: input.isTenantAdmin ?? false,
          },
        }),
      );
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
    // Lock-out protection: the acting admin always remains an active tenant admin,
    // so every tenant keeps at least one.
    if (actor.id === id && (input.status === 'DISABLED' || input.isTenantAdmin === false)) {
      throw AppException.badRequest(
        'You cannot disable your own account or remove your own administrator access',
      );
    }
    try {
      const user = await this.db.run(ctx.tenantId, async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: input });
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
}
