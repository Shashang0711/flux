import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode, MODULES, type ModuleKey, type PermissionKey } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AuthenticatedRequest } from './auth.types';
import {
  IS_PUBLIC_KEY,
  REQUIRED_MODULE_KEY,
  REQUIRED_PERMISSIONS_KEY,
  REQUIRES_PLATFORM_ADMIN_KEY,
} from './decorators';
import { readSessionToken } from './session-cookie';
import { SessionService } from './session.service';

/**
 * Global guard. Every route requires a valid session unless marked @Public(), then:
 * @RequirePlatformAdmin(), @RequireModule() and @RequirePermission().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const meta = <T>(key: string) => this.reflector.getAllAndOverride<T>(key, targets);

    if (meta<boolean>(IS_PUBLIC_KEY)) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = readSessionToken(request.cookies);
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw AppException.unauthenticated();

    const user = {
      ...session.user,
      request: { id: request.id === undefined ? undefined : String(request.id), ip: request.ip },
    };
    request.user = user;
    request.sessionId = session.sessionId;

    if (meta<boolean>(REQUIRES_PLATFORM_ADMIN_KEY) && !user.isPlatformAdmin) {
      throw AppException.forbidden();
    }
    const module = meta<ModuleKey | undefined>(REQUIRED_MODULE_KEY);
    if (module && !user.modules.includes(module)) {
      const name = MODULES.find((m) => m.key === module)?.name ?? module;
      throw new AppException(
        HttpStatus.FORBIDDEN,
        ErrorCode.MODULE_NOT_ENABLED,
        `Your organisation does not have the ${name} module`,
      );
    }
    const required = meta<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS_KEY);
    if (required && !required.every((p) => user.access.permissions.includes(p))) {
      throw AppException.forbidden();
    }
    return true;
  }
}
