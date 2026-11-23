import { Injectable } from '@nestjs/common';
import type {
  CreateReferenceItemRequest,
  ReferenceItemDto,
  ReferenceListKey,
  UpdateReferenceItemRequest,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser } from '../auth/auth.types';
import { CODE_TAKEN, ITEM_ORDER, isUniqueViolation, toReferenceItemDto } from './reference-items';

const AUDITED = ['code', 'name', 'description', 'sortOrder', 'isActive'] as const;

/**
 * FLUX defaults (tenant_id NULL), managed by platform admins through the owner connection.
 * Changes are audited as platform-level entries.
 */
@Injectable()
export class PlatformReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  async list(list: ReferenceListKey): Promise<ReferenceItemDto[]> {
    const items = await this.prisma.referenceItem.findMany({
      where: { listKey: list, tenantId: null },
      orderBy: ITEM_ORDER,
    });
    return items.map((item) => toReferenceItemDto(item, false));
  }

  async create(
    list: ReferenceListKey,
    input: CreateReferenceItemRequest & { sortOrder: number },
    actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const item = await tx.referenceItem.create({
          data: {
            listKey: list,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
          },
        });
        await recordAudit(tx, {
          tenantId: null,
          actor,
          action: 'reference.created',
          entity: { type: 'reference-item', id: item.id, label: `${item.name} (${list})` },
          changes: fieldChanges(null, item, ['code', 'name', 'description', 'sortOrder']),
        });
        return toReferenceItemDto(item, false);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw CODE_TAKEN();
      throw error;
    }
  }

  async update(
    list: ReferenceListKey,
    id: string,
    input: UpdateReferenceItemRequest,
    actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const before = await tx.referenceItem.findFirst({
          where: { id, listKey: list, tenantId: null },
        });
        if (!before) throw AppException.notFound('Reference item', id);
        const updated = await tx.referenceItem.update({ where: { id }, data: input });
        const changes = fieldChanges(before, updated, AUDITED);
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, {
            tenantId: null,
            actor,
            action: changes.isActive
              ? updated.isActive
                ? 'reference.activated'
                : 'reference.deactivated'
              : 'reference.updated',
            entity: { type: 'reference-item', id, label: `${updated.name} (${list})` },
            changes,
          });
        }
        return toReferenceItemDto(updated, false);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw CODE_TAKEN();
      throw error;
    }
  }
}
