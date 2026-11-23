import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppException } from '../../common/errors/app.exception';
import type { AuthenticatedRequest } from './auth.types';
import { IS_PUBLIC_KEY, REQUIRES_SYSTEM_ADMIN_KEY } from './decorators';
import { readSessionToken } from './session-cookie';
import { SessionService } from './session.service';

/**
 * Global guard: every route requires a valid session unless marked @Public().
 * Also enforces @RequireSystemAdmin() (temporary until M3 permissions).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(request.cookies);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw AppException.unauthenticated();

    request.user = session.user;
    request.sessionId = session.sessionId;

    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRES_SYSTEM_ADMIN_KEY, targets) &&
      !session.user.isSystemAdmin
    ) {
      throw AppException.forbidden();
    }
    return true;
  }
}
