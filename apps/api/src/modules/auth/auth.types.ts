import type { Request } from 'express';
import type { User } from '@prisma/client';

/** The signed-in user, attached to the request by AuthGuard. */
export type AuthUser = Pick<User, 'id' | 'email' | 'name' | 'status' | 'isSystemAdmin'>;

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
}
