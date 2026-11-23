import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ModuleKey } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser, AuthenticatedRequest, TenantContext } from './auth.types';

export const IS_PUBLIC_KEY = 'flux:public';
export const REQUIRES_PLATFORM_ADMIN_KEY = 'flux:requires-platform-admin';
export const REQUIRES_TENANT_ADMIN_KEY = 'flux:requires-tenant-admin';
export const REQUIRED_MODULE_KEY = 'flux:required-module';

type Decorator = MethodDecorator & ClassDecorator;

/** Skips authentication. Everything else requires a valid session (deny by default). */
export const Public = (): Decorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Platform operators only (tenant management). */
export const RequirePlatformAdmin = (): Decorator => SetMetadata(REQUIRES_PLATFORM_ADMIN_KEY, true);

/**
 * Administrators of the caller's tenant only.
 * Temporary until M3b, where it is replaced by role permissions.
 */
export const RequireTenantAdmin = (): Decorator => SetMetadata(REQUIRES_TENANT_ADMIN_KEY, true);

/** The caller's tenant must be licensed for this module (core modules always pass). */
export const RequireModule = (module: ModuleKey): Decorator =>
  SetMetadata(REQUIRED_MODULE_KEY, module);

function requestOf(ctx: ExecutionContext): AuthenticatedRequest {
  return ctx.switchToHttp().getRequest<AuthenticatedRequest>();
}

/** Injects the signed-in user. Only valid on authenticated (non-@Public) routes. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = requestOf(ctx).user;
  if (!user) throw AppException.unauthenticated();
  return user;
});

/** Injects the current session ID. Only valid on authenticated routes. */
export const CurrentSessionId = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const sessionId = requestOf(ctx).sessionId;
  if (!sessionId) throw AppException.unauthenticated();
  return sessionId;
});

/**
 * Injects the caller's tenant. Rejects callers without one (platform admins), so a
 * tenant-scoped handler can never run without a tenant to scope to.
 */
export const CurrentTenant = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): TenantContext => {
    const user = requestOf(ctx).user;
    if (!user) throw AppException.unauthenticated();
    if (!user.tenantId) {
      throw AppException.forbidden('This action is only available inside an organisation');
    }
    return { tenantId: user.tenantId };
  },
);

export type { AuthUser, TenantContext };
