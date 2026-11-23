import type { Request } from 'express';
import type { ModuleKey } from '@flux/shared';

/** The signed-in user, attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Null for platform administrators. */
  tenantId: string | null;
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
  /** Modules the user's tenant can use (core + licensed). Empty for platform admins. */
  modules: ModuleKey[];
}

/** Tenant context for tenant-scoped handlers; see @CurrentTenant(). */
export interface TenantContext {
  tenantId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}
