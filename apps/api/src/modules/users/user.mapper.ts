import type { User } from '@prisma/client';
import type { UserDto } from '@flux/shared';

/** The only way a user leaves the API: an explicit allow-list, so credentials never leak. */
export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    isPlatformAdmin: user.isPlatformAdmin,
    isTenantAdmin: user.isTenantAdmin,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
