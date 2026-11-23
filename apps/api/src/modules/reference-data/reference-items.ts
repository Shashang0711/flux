import { HttpStatus } from '@nestjs/common';
import { Prisma, type ReferenceItem } from '@prisma/client';
import {
  ErrorCode,
  MODULES,
  referenceList,
  type ReferenceItemDto,
  type ReferenceListKey,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { AuthUser } from '../auth/auth.types';

export const ITEM_ORDER = [
  { sortOrder: 'asc' },
  { name: 'asc' },
  { id: 'asc' },
] satisfies Prisma.ReferenceItemOrderByWithRelationInput[];

export function toReferenceItemDto(item: ReferenceItem, hidden: boolean): ReferenceItemDto {
  return {
    id: item.id,
    list: item.listKey as ReferenceListKey,
    code: item.code,
    name: item.name,
    description: item.description,
    sortOrder: item.sortOrder,
    isActive: item.isActive,
    source: item.tenantId === null ? 'PLATFORM' : 'TENANT',
    hidden,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

export const CODE_TAKEN = (message = 'This code is already used in this list') =>
  AppException.conflict(message, { fields: [{ path: 'code', message }] });

/** A tenant may only use lists whose module it is licensed for. */
export function assertListAvailable(user: AuthUser, list: ReferenceListKey): void {
  const { module } = referenceList(list);
  if (!user.modules.includes(module)) {
    const name = MODULES.find((m) => m.key === module)?.name ?? module;
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.MODULE_NOT_ENABLED,
      `Your organisation does not have the ${name} module`,
    );
  }
}
