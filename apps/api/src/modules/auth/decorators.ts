import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser, AuthenticatedRequest } from './auth.types';

export const IS_PUBLIC_KEY = 'flux:public';
export const REQUIRES_SYSTEM_ADMIN_KEY = 'flux:requires-system-admin';

/** Skips authentication. Everything else requires a valid session (deny by default). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Restricts a handler to system administrators.
 * Temporary until M3, where it is replaced by permission checks (e.g. `user.manage`).
 */
export const RequireSystemAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SYSTEM_ADMIN_KEY, true);

/** Injects the signed-in user. Only valid on authenticated (non-@Public) routes. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw AppException.unauthenticated();
  return user;
});

/** Injects the current session ID. Only valid on authenticated routes. */
export const CurrentSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const sessionId = ctx.switchToHttp().getRequest<AuthenticatedRequest>().sessionId;
  if (!sessionId) throw AppException.unauthenticated();
  return sessionId;
});

export type { AuthUser };
