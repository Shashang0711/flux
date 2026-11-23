import type { Request } from 'express';
import type { ModuleKey, SessionAccess } from '@flux/shared';

/** The signed-in user, attached to the request by AuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Null for platform administrators. */
  tenantId: string | null;
  isPlatformAdmin: boolean;
  /** Modules the user's tenant can use (core + licensed). Empty for platform admins. */
  modules: ModuleKey[];
  /** What the user may do, from their active roles. Empty for platform admins. */
  access: SessionAccess;
  /** The current request (for the audit trail). Set by AuthGuard. */
  request?: { id?: string; ip?: string };
}

/** Tenant context for tenant-scoped handlers; see @CurrentTenant(). */
export interface TenantContext {
  tenantId: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}
