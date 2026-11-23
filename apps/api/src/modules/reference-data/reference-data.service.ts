import { Injectable } from '@nestjs/common';
import {
  type CreateReferenceItemRequest,
  type ReferenceItemDto,
  type ReferenceListKey,
  type ReferenceListQuery,
  type UpdateReferenceItemRequest,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CODE_TAKEN, ITEM_ORDER, isUniqueViolation, toReferenceItemDto } from './reference-items';

const AUDITED = ['code', 'name', 'description', 'sortOrder', 'isActive'] as const;

/**
 * A tenant's view of reference data: FLUX defaults plus its own items. Row-level security lets
 * the tenant read defaults but write only its own items and its own "hidden" markers.
 */
@Injectable()
export class ReferenceDataService {
  constructor(private readonly db: TenantDb) {}

  list(
    ctx: TenantContext,
    list: ReferenceListKey,
    query: ReferenceListQuery,
  ): Promise<ReferenceItemDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const items = await tx.referenceItem.findMany({
        where: { listKey: list },
        include: { hiddenBy: { select: { itemId: true } } },
        orderBy: ITEM_ORDER,
      });
      const dtos = items.map((item) => toReferenceItemDto(item, item.hiddenBy.length > 0));
      return query.view === 'all' ? dtos : dtos.filter((i) => i.isActive && !i.hidden);
    });
  }

  async create(
    ctx: TenantContext,
    list: ReferenceListKey,
    input: CreateReferenceItemRequest & { sortOrder: number },
    actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        await this.assertNoDefaultWithCode(tx, list, input.code);
        const item = await tx.referenceItem.create({
          data: {
            tenantId: ctx.tenantId,
            listKey: list,
            code: input.code,
            name: input.name,
            description: input.description ?? null,
            sortOrder: input.sortOrder,
          },
        });
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
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

  /** Only the tenant's own items can be edited; FLUX defaults can be hidden instead. */
  async update(
    ctx: TenantContext,
    list: ReferenceListKey,
    id: string,
    input: UpdateReferenceItemRequest,
    actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const before = await this.find(tx, list, id);
        if (before.tenantId === null) {
          throw AppException.forbidden(
            'FLUX defaults cannot be changed. You can hide them instead.',
          );
        }
        if (input.code) await this.assertNoDefaultWithCode(tx, list, input.code);
        const updated = await tx.referenceItem.update({ where: { id }, data: input });
        const changes = fieldChanges(before, updated, AUDITED);
        if (Object.keys(changes).length > 0) {
          await recordAudit(tx, {
            tenantId: ctx.tenantId,
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

  /** Hide or show a FLUX default for this tenant. */
  setVisibility(
    ctx: TenantContext,
    list: ReferenceListKey,
    id: string,
    hidden: boolean,
    actor: AuthUser,
  ): Promise<ReferenceItemDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const item = await this.find(tx, list, id);
      if (item.tenantId !== null) {
        throw AppException.badRequest(
          'Only FLUX defaults can be hidden. Deactivate your own items instead.',
        );
      }
      const existing = await tx.referenceItemHidden.findUnique({
        where: { tenantId_itemId: { tenantId: ctx.tenantId, itemId: id } },
      });
      if (hidden && !existing) {
        await tx.referenceItemHidden.create({ data: { tenantId: ctx.tenantId, itemId: id } });
      } else if (!hidden && existing) {
        await tx.referenceItemHidden.delete({
          where: { tenantId_itemId: { tenantId: ctx.tenantId, itemId: id } },
        });
      }
      if (hidden !== Boolean(existing)) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: hidden ? 'reference.hidden' : 'reference.shown',
          entity: { type: 'reference-item', id, label: `${item.name} (${list})` },
        });
      }
      return toReferenceItemDto(item, hidden);
    });
  }

  private async find(tx: TenantTx, list: ReferenceListKey, id: string) {
    const item = await tx.referenceItem.findFirst({ where: { id, listKey: list } });
    if (!item) throw AppException.notFound('Reference item', id);
    return item;
  }

  /** A tenant item may not reuse the code of a FLUX default in the same list. */
  private async assertNoDefaultWithCode(tx: TenantTx, list: ReferenceListKey, code: string) {
    const clash = await tx.referenceItem.findFirst({
      where: { listKey: list, tenantId: null, code: { equals: code, mode: 'insensitive' } },
      select: { name: true },
    });
    if (clash) throw CODE_TAKEN(`A FLUX default already uses this code (${clash.name})`);
  }
}
