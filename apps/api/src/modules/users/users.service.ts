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
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { toUserDto } from './user.mapper';

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

const EMAIL_TAKEN = () =>
  AppException.conflict('A user with this email already exists', {
    fields: [{ path: 'email', message: 'Email is already in use' }],
  });

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async list(query: PageQuery & UserListFilter): Promise<Paginated<UserDto>> {
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
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.user.count({ where }),
    ]);
    return new Paginated(users.map(toUserDto), total, query);
  }

  async get(id: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw AppException.notFound('User', id);
    return toUserDto(user);
  }

  async create(input: CreateUserRequest): Promise<UserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await this.prisma.user.create({
        data: {
          email: input.email,
          name: input.name,
          passwordHash,
          isSystemAdmin: input.isSystemAdmin ?? false,
        },
      });
      return toUserDto(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw EMAIL_TAKEN();
      throw error;
    }
  }

  async update(id: string, input: UpdateUserRequest, actor: AuthUser): Promise<UserDto> {
    // Lock-out protection: the acting admin always remains an active system admin,
    // so at least one always exists.
    if (actor.id === id && (input.status === 'DISABLED' || input.isSystemAdmin === false)) {
      throw AppException.badRequest(
        'You cannot disable your own account or remove your own system-admin access',
      );
    }
    try {
      const user = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: input });
        if (input.status === 'DISABLED') {
          await this.sessions.revokeAllForUser(id, { tx });
        }
        return updated;
      });
      return toUserDto(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw EMAIL_TAKEN();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw AppException.notFound('User', id);
      }
      throw error;
    }
  }

  /** Admin sets a new password for another user and signs them out everywhere. */
  async resetPassword(id: string, password: string, actor: AuthUser): Promise<void> {
    if (actor.id === id) {
      throw AppException.badRequest('Use change password to change your own password');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({ where: { id }, data: { passwordHash } });
      if (count === 0) throw AppException.notFound('User', id);
      await this.sessions.revokeAllForUser(id, { tx });
    });
  }
}
