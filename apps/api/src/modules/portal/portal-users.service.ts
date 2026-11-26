import { Injectable } from '@nestjs/common';
import { Prisma, type User } from '@prisma/client';
import type { PortalUserDto, UpdateUserRequest, createPortalUserSchema } from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { hashPassword } from '../auth/password';
import { SessionService } from '../auth/session.service';

const EMAIL_TAKEN = () =>
  AppException.conflict('A user with this email already exists', {
    fields: [{ path: 'email', message: 'Email is already in use' }],
  });

function toPortalUserDto(u: User): PortalUserDto {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    status: u.status,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * Client portal logins, managed on the client page. A portal user belongs to one client for
 * good (a trigger keeps users.client_id fixed) and holds no roles: their access is fixed.
 * Changes are audited on the user, related to the client (so they show on its Audit tab).
 */
@Injectable()
export class PortalUsersService {
  constructor(
    private readonly db: TenantDb,
    private readonly sessions: SessionService,
  ) {}

  list(ctx: TenantContext, clientId: string): Promise<PortalUserDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.client(tx, clientId);
      const users = await tx.user.findMany({
        where: { clientId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
      return users.map(toPortalUserDto);
    });
  }

  async create(
    ctx: TenantContext,
    clientId: string,
    input: z.output<typeof createPortalUserSchema>,
    actor: AuthUser,
  ): Promise<PortalUserDto> {
    const passwordHash = await hashPassword(input.password);
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const client = await this.client(tx, clientId);
        if (client.status !== 'ACTIVE') {
          throw AppException.conflict('Portal users can only be added to an active client');
        }
        const user = await tx.user.create({
          data: {
            tenantId: ctx.tenantId,
            clientId,
            email: input.email,
            name: input.name,
            passwordHash,
          },
        });
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'user.created',
          entity: { type: 'user', id: user.id, label: user.name },
          relatedIds: [clientId],
          changes: {
            ...fieldChanges(null, user, ['name', 'email']),
            client: { from: null, to: client.name },
          },
        });
        return toPortalUserDto(user);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw EMAIL_TAKEN();
      }
      throw error;
    }
  }

  async update(
    ctx: TenantContext,
    clientId: string,
    id: string,
    input: UpdateUserRequest,
    actor: AuthUser,
  ): Promise<PortalUserDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const before = await this.user(tx, clientId, id);
        const updated = await tx.user.update({ where: { id }, data: input });
        if (input.status === 'DISABLED') await this.sessions.revokeAllForUser(id, { tx });
        const changes = fieldChanges(before, updated, ['name', 'email', 'status']);
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, {
            tenantId: ctx.tenantId,
            actor,
            action: changes.status
              ? updated.status === 'DISABLED'
                ? 'user.disabled'
                : 'user.enabled'
              : 'user.updated',
            entity: { type: 'user', id, label: updated.name },
            relatedIds: [clientId],
            changes,
          });
        }
        return toPortalUserDto(updated);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw EMAIL_TAKEN();
      }
      throw error;
    }
  }

  /** Sets a new password and signs the user out everywhere. */
  async resetPassword(
    ctx: TenantContext,
    clientId: string,
    id: string,
    password: string,
    actor: AuthUser,
  ): Promise<void> {
    const passwordHash = await hashPassword(password);
    await this.db.run(ctx.tenantId, async (tx) => {
      const user = await this.user(tx, clientId, id);
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.sessions.revokeAllForUser(id, { tx });
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: 'user.password_reset',
        entity: { type: 'user', id, label: user.name },
        relatedIds: [clientId],
      });
    });
  }

  private async client(tx: TenantTx, id: string) {
    const client = await tx.client.findUnique({
      where: { id },
      select: { id: true, name: true, status: true },
    });
    if (!client) throw AppException.notFound('Client', id);
    return client;
  }

  private async user(tx: TenantTx, clientId: string, id: string): Promise<User> {
    const user = await tx.user.findFirst({ where: { id, clientId } });
    if (!user) throw AppException.notFound('Portal user', id);
    return user;
  }
}
