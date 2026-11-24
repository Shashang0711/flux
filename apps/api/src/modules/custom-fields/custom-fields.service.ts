import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, type CustomFieldDefinition } from '@prisma/client';
import {
  ErrorCode,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  customFieldKeyFromLabel,
  createCustomFieldSchema,
  formatCustomFieldValue,
  validateCustomFieldValues,
  type CustomFieldDefinitionDto,
  type CustomFieldEntity,
  type CustomFieldOption,
  type CustomFieldValues,
  type FieldChange,
  type UpdateCustomFieldRequest,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';

const AUDITED = ['label', 'required', 'helpText', 'sortOrder', 'isActive'] as const;
const ORDER: Prisma.CustomFieldDefinitionOrderByWithRelationInput[] = [
  { sortOrder: 'asc' },
  { label: 'asc' },
  { id: 'asc' },
];

export function toDefinitionDto(d: CustomFieldDefinition): CustomFieldDefinitionDto {
  return {
    id: d.id,
    entity: d.entity as CustomFieldEntity,
    key: d.key,
    label: d.label,
    type: d.type,
    required: d.required,
    helpText: d.helpText,
    options: (d.options as unknown as CustomFieldOption[]) ?? [],
    sortOrder: d.sortOrder,
    isActive: d.isActive,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}

/** Tenant-defined fields and validation of their values on records. */
@Injectable()
export class CustomFieldsService {
  constructor(private readonly db: TenantDb) {}

  list(
    ctx: TenantContext,
    entity: CustomFieldEntity,
    view: 'active' | 'all',
  ): Promise<CustomFieldDefinitionDto[]> {
    return this.db.run(ctx.tenantId, async (tx) =>
      (await this.definitions(tx, entity, view === 'active')).map(toDefinitionDto),
    );
  }

  async create(
    ctx: TenantContext,
    input: z.output<typeof createCustomFieldSchema>,
    actor: AuthUser,
  ): Promise<CustomFieldDefinitionDto> {
    const key = input.key ?? customFieldKeyFromLabel(input.label);
    try {
      return await this.db.run(ctx.tenantId, async (tx) => {
        const count = await tx.customFieldDefinition.count({ where: { entity: input.entity } });
        if (count >= MAX_CUSTOM_FIELDS_PER_ENTITY) {
          throw AppException.badRequest(
            `At most ${MAX_CUSTOM_FIELDS_PER_ENTITY} custom fields per record type`,
          );
        }
        const def = await tx.customFieldDefinition.create({
          data: {
            tenantId: ctx.tenantId,
            entity: input.entity,
            key,
            label: input.label,
            type: input.type,
            required: input.required,
            helpText: input.helpText ?? null,
            options: input.options,
            sortOrder: input.sortOrder,
          },
        });
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: 'custom-field.created',
          entity: { type: 'custom-field', id: def.id, label: `${def.label} (${def.entity})` },
          changes: {
            key: { from: null, to: def.key },
            type: { from: null, to: def.type },
            ...fieldChanges(null, def, ['label', 'required', 'helpText', 'sortOrder']),
            ...(input.options.length > 0
              ? { options: { added: input.options.map((o) => o.label), removed: [] } }
              : {}),
          },
        });
        return toDefinitionDto(def);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict('A field with this key already exists', {
          fields: [{ path: input.key ? 'key' : 'label', message: `Key "${key}" is already used` }],
        });
      }
      throw error;
    }
  }

  update(
    ctx: TenantContext,
    id: string,
    input: UpdateCustomFieldRequest,
    actor: AuthUser,
  ): Promise<CustomFieldDefinitionDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.customFieldDefinition.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('Custom field', id);
      if (input.options !== undefined) {
        if (before.type !== 'SELECT' && input.options.length > 0) {
          throw AppException.badRequest('Only dropdowns have options');
        }
        if (before.type === 'SELECT' && input.options.length === 0) {
          throw AppException.badRequest('A dropdown needs at least one option');
        }
      }
      const updated = await tx.customFieldDefinition.update({
        where: { id },
        data: { ...input, ...(input.options ? { options: input.options } : {}) },
      });
      const changes: Record<string, FieldChange | { added: string[]; removed: string[] }> =
        fieldChanges(before, updated, AUDITED);
      if (input.options) {
        const was = (before.options as unknown as CustomFieldOption[]).map(
          (o) => `${o.value}=${o.label}`,
        );
        const now = input.options.map((o) => `${o.value}=${o.label}`);
        const added = now.filter((o) => !was.includes(o));
        const removed = was.filter((o) => !now.includes(o));
        if (added.length || removed.length) changes.options = { added, removed };
      }
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action:
            'isActive' in changes
              ? updated.isActive
                ? 'custom-field.activated'
                : 'custom-field.deactivated'
              : 'custom-field.updated',
          entity: { type: 'custom-field', id, label: `${updated.label} (${updated.entity})` },
          changes,
        });
      }
      return toDefinitionDto(updated);
    });
  }

  /**
   * Validates values for a record (create: required fields enforced) and returns the merged
   * values to store plus audit-ready changes labelled with the field labels.
   */
  async resolveValues(
    tx: TenantTx,
    entity: CustomFieldEntity,
    input: Record<string, unknown> | undefined,
    mode: 'create' | 'update',
    current: CustomFieldValues = {},
  ): Promise<{ values: CustomFieldValues; changes: Record<string, FieldChange> }> {
    const defs = (await this.definitions(tx, entity, false)).map(toDefinitionDto);
    const { values, issues } = validateCustomFieldValues(defs, input, mode);
    if (issues.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Request validation failed',
        issues,
      );
    }
    const merged: CustomFieldValues = { ...current };
    const changes: Record<string, FieldChange> = {};
    for (const [key, value] of Object.entries(values)) {
      const before = current[key] ?? null;
      if (value === null) delete merged[key];
      else merged[key] = value;
      if (before !== value) {
        const def = defs.find((d) => d.key === key)!;
        changes[def.label] = {
          from: before === null ? null : formatCustomFieldValue(def, before),
          to: value === null ? null : formatCustomFieldValue(def, value),
        };
      }
    }
    return { values: merged, changes };
  }

  private definitions(tx: TenantTx, entity: CustomFieldEntity, activeOnly: boolean) {
    return tx.customFieldDefinition.findMany({
      where: { entity, ...(activeOnly ? { isActive: true } : {}) },
      orderBy: ORDER,
    });
  }
}
