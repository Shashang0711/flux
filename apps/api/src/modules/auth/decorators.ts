import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import type { ModuleKey, PermissionKey } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser, AuthenticatedRequest, TenantContext } from './auth.types';

export const IS_PUBLIC_KEY = 'flux:public';
export const REQUIRES_PLATFORM_ADMIN_KEY = 'flux:requires-platform-admin';
export const REQUIRED_PERMISSIONS_KEY = 'flux:required-permissions';
export const REQUIRED_MODULE_KEY = 'flux:required-module';
export const CLIENT_USERS_KEY = 'flux:client-users';

type Decorator = MethodDecorator & ClassDecorator;

/** Skips authentication. Everything else requires a valid session (deny by default). */
export const Public = (): Decorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Platform operators only (tenant management). */
export const RequirePlatformAdmin = (): Decorator => SetMetadata(REQUIRES_PLATFORM_ADMIN_KEY, true);

/**
 * The caller must hold ALL of these permissions (from their active roles, limited to modules
 * licensed to their tenant). Method-level overrides class-level.
 */
export const RequirePermission = (...permissions: [PermissionKey, ...PermissionKey[]]): Decorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/**
 * Opens a route to client portal users. They are refused every other route (deny by default),
 * whatever permissions it requires, so a staff route can never leak to a client by mistake.
 */
export const AllowClientUsers = (): Decorator => SetMetadata(CLIENT_USERS_KEY, true);

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

/** Tenant and client of a client portal user; rejects everyone else (staff included). */
export interface ClientContext extends TenantContext {
  clientId: string;
}

export const CurrentClient = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ClientContext => {
    const user = requestOf(ctx).user;
    if (!user) throw AppException.unauthenticated();
    if (!user.tenantId || !user.clientId) {
      throw AppException.forbidden('The client portal is for client users');
    }
    return { tenantId: user.tenantId, clientId: user.clientId };
  },
);

export type { AuthUser, TenantContext };
