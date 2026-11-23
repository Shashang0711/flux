import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import type { AuthUser } from './auth.types';

/** lastSeenAt is refreshed at most this often, to avoid a write on every request. */
const TOUCH_INTERVAL_MS = 60_000;

type Tx = Prisma.TransactionClient;

export interface ResolvedSession {
  sessionId: string;
  user: AuthUser;
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get ttlMs(): number {
    return this.config.get('SESSION_TTL_HOURS', { infer: true }) * 3_600_000;
  }

  private get idleMs(): number {
    return this.config.get('SESSION_IDLE_MINUTES', { infer: true }) * 60_000;
  }

  /** Creates a session and returns the raw token for the cookie (never stored). */
  async create(
    userId: string,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs);
    await this.prisma.session.create({
      data: {
        tokenHash: hashToken(token),
        userId,
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent?.slice(0, 512),
      },
    });
    return { token, expiresAt };
  }

  /** Returns the session's user if the token is valid, active and the user is enabled. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: {
        user: { select: { id: true, email: true, name: true, status: true, isSystemAdmin: true } },
      },
    });
    if (!session) return null;

    const now = Date.now();
    const expired =
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= now ||
      session.lastSeenAt.getTime() + this.idleMs <= now;
    if (expired || session.user.status !== 'ACTIVE') return null;

    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return { sessionId: session.id, user: session.user };
  }

  async revokeByToken(token: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Signs a user out everywhere (optionally keeping one session, e.g. the current one). */
  async revokeAllForUser(
    userId: string,
    options: { except?: string; tx?: Tx } = {},
  ): Promise<void> {
    await (options.tx ?? this.prisma).session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.except ? { id: { not: options.except } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }
}
