import { z } from 'zod';
import type { SessionAccess } from '../access/roles';

/** Name of the httpOnly cookie carrying the session token. */
export const SESSION_COOKIE_NAME = 'flux_session';

export const PASSWORD_MIN_LENGTH = 8;
/** Upper bound protects the server from hashing arbitrarily large inputs. */
export const PASSWORD_MAX_LENGTH = 128;

export const UserStatus = { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** A user as returned by the API. Never includes credentials. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  status: UserStatus;
  /** Platform operator (no tenant). */
  isPlatformAdmin: boolean;
  /** Roles assigned to the user (tenant users only). */
  roles: { id: string; name: string }[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Trimmed and lower-cased, so uniqueness is case-insensitive. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ message: 'Enter a valid email address' }));

/** Policy for new passwords. */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Password must be at most ${PASSWORD_MAX_LENGTH} characters`);

const nameSchema = z.string().trim().min(1, 'Name is required').max(200);

/** Login does not apply the policy (it may change), only sane bounds. */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX_LENGTH),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  email: emailSchema,
  name: nameSchema,
  password: passwordSchema,
  roleIds: z
    .array(z.uuid())
    .max(100)
    .default([])
    .transform((ids) => [...new Set(ids)]),
});
export type CreateUserRequest = z.input<typeof createUserSchema>;

export const updateUserSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    status: z.enum([UserStatus.ACTIVE, UserStatus.DISABLED]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'No fields to update' });
export type UpdateUserRequest = z.infer<typeof updateUserSchema>;

export const resetPasswordSchema = z.object({ password: passwordSchema });
export type ResetPasswordRequest = z.infer<typeof resetPasswordSchema>;

/** Filters for the user grid (combined with page/pageSize). */
export const userListFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([UserStatus.ACTIVE, UserStatus.DISABLED]).optional(),
});
export type UserListFilter = z.infer<typeof userListFilterSchema>;

/** The signed-in user and their tenant context, from GET /auth/me. */
export interface SessionInfo {
  user: UserDto;
  /** Null for platform administrators. */
  tenant: { id: string; slug: string; name: string } | null;
  /** Modules the tenant can use (core + licensed). Empty for platform admins. */
  modules: string[];
  /** What this user may do, from their roles. Empty for platform admins. */
  access: SessionAccess;
}
