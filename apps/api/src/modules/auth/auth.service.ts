import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ErrorCode,
  type ChangePasswordRequest,
  type LoginRequest,
  type SessionInfo,
  type UserDto,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { recordAudit } from '../audit/audit';
import { USER_ROLES_INCLUDE, toUserDto } from '../users/user.mapper';
import type { AuthUser } from './auth.types';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './password';
import { SessionService } from './session.service';

const INVALID_CREDENTIALS = 'Invalid email or password';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
  ) {}

  async login(
    credentials: LoginRequest,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<{ user: UserDto; token: string; expiresAt: Date }> {
    // System lookup (bypasses RLS): the tenant is not known until the user is found.
    const user = await this.prisma.user.findUnique({
      where: { email: credentials.email },
      include: { tenant: { select: { status: true } }, client: { select: { status: true } } },
    });

    // Same message and similar timing for unknown email, wrong password and disabled account,
    // so the response does not reveal which accounts exist.
    if (!user) {
      await verifyAgainstDummy(credentials.password);
      throw this.invalidCredentials();
    }
    const passwordOk = await verifyPassword(user.passwordHash, credentials.password);
    if (!passwordOk || user.status !== 'ACTIVE') throw this.invalidCredentials();
    // Only revealed after a correct password, so it does not leak which accounts exist.
    if (user.tenant && user.tenant.status !== 'ACTIVE') {
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.TENANT_SUSPENDED,
        "Your organisation's access to FLUX is suspended",
      );
    }

    if (user.client && user.client.status !== 'ACTIVE') {
      throw AppException.forbidden('Portal access for your company is not active');
    }

    const { token, expiresAt } = await this.sessions.create(user.id, meta);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return { user: toUserDto(updated), token, expiresAt };
  }

  /** Session details; access was already computed by AuthGuard for this request. */
  async me(auth: AuthUser): Promise<SessionInfo> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.id },
      include: {
        ...USER_ROLES_INCLUDE,
        tenant: { select: { id: true, slug: true, name: true } },
        client: { select: { id: true, code: true, name: true } },
      },
    });
    if (!user) throw AppException.unauthenticated();
    const { tenant, client } = user;
    return {
      user: toUserDto(user),
      tenant: tenant ? { id: tenant.id, slug: tenant.slug, name: tenant.name } : null,
      modules: auth.modules,
      access: auth.access,
      client,
    };
  }

  /** Changes the caller's password and signs out their other sessions. */
  async changePassword(
    actor: AuthUser,
    currentSessionId: string,
    body: ChangePasswordRequest,
  ): Promise<void> {
    const userId = actor.id;
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(user.passwordHash, body.currentPassword))) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Current password is incorrect',
        [{ path: 'currentPassword', message: 'Current password is incorrect' }],
      );
    }
    const passwordHash = await hashPassword(body.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(userId, { except: currentSessionId, tx });
      // Platform admins belong to no tenant, so there is no tenant log to write to.
      if (user.tenantId) {
        await recordAudit(tx, {
          tenantId: user.tenantId,
          actor,
          action: 'user.password_changed',
          entity: { type: 'user', id: userId, label: user.name },
        });
      }
    });
  }

  private invalidCredentials(): AppException {
    return new AppException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.UNAUTHENTICATED,
      INVALID_CREDENTIALS,
    );
  }
}
