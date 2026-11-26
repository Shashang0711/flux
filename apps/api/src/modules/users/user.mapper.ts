import type { User } from '@prisma/client';
import type { UserDto } from '@flux/shared';

/** Include this when loading users so their roles appear in the DTO. */
export const USER_ROLES_INCLUDE = {
  userRoles: {
    orderBy: { assignedAt: 'asc' },
    select: { role: { select: { id: true, name: true } } },
  },
} as const;

type UserWithRoles = User & { userRoles?: { role: { id: string; name: string } }[] };

/** The only way a user leaves the API: an explicit allow-list, so credentials never leak. */
export function toUserDto(user: UserWithRoles): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    isPlatformAdmin: user.isPlatformAdmin,
    roles: (user.userRoles ?? []).map((ur) => ur.role),
    clientId: user.clientId,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
