import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ErrorCode,
  MAX_REGISTRATION_FIELDS,
  validateCustomFieldValues,
  type LabCategoryDto,
  type LabListQuery,
  type RegistrationCheckResultDto,
  type RegistrationFieldDto,
  type ServiceTypeDto,
  type ServiceTypeSummaryDto,
  type createLabCategorySchema,
  type createRegistrationFieldSchema,
  type createServiceTypeSchema,
  type registrationCheckSchema,
  type updateLabCategorySchema,
  type updateRegistrationFieldSchema,
  type updateServiceTypeSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { fieldChanges, recordAudit, type AuditEntry } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import {
  FIELD_ORDER,
  SERVICE_TYPE_DETAIL_INCLUDE,
  SERVICE_TYPE_SUMMARY_INCLUDE,
  fieldError,
  toFieldDto,
  toServiceTypeDto,
  toServiceTypeSummaryDto,
  uniqueCode,
} from './lab.mapper';

const CATEGORY_FIELDS = ['code', 'name', 'description', 'sortOrder', 'isActive'] as const;
const SERVICE_TYPE_FIELDS = [
  'code',
  'name',
  'description',
  'sortOrder',
  'isActive',
  'vesselRequired',
] as const;
const FIELD_FIELDS = ['label', 'required', 'helpText', 'sortOrder', 'isActive'] as const;

type Out<T extends z.ZodType> = z.output<T>;

export function labAudit(
  tx: TenantTx,
  ctx: TenantContext,
  actor: AuthUser,
  action: AuditEntry['action'],
  entity: AuditEntry['entity'],
  changes: AuditEntry['changes'],
  relatedIds: string[] = [],
): Promise<void> {
  return recordAudit(tx, { tenantId: ctx.tenantId, actor, action, entity, changes, relatedIds });
}

const label = (r: { code: string; name: string }) => `${r.code} ${r.name}`;

/**
 * Categories, service types and their registration fields (design pack §7). A service type's
 * fields are the form shown when registering its samples (batch fields once, sample fields per
 * sample); `checkRegistration` validates values exactly as registration will (M11).
 */
@Injectable()
export class CatalogueService {
  constructor(private readonly db: TenantDb) {}

  // ─── Categories ───────────────────────────────────────────────────────────

  listCategories(ctx: TenantContext, query: LabListQuery): Promise<LabCategoryDto[]> {
    return this.db.run(ctx.tenantId, (tx) => this.listCategoriesTx(tx, query.view === 'active'));
  }

  createCategory(
    ctx: TenantContext,
    input: Out<typeof createLabCategorySchema>,
    actor: AuthUser,
  ): Promise<LabCategoryDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const created = await uniqueCode(() =>
        tx.labCategory.create({
          data: { tenantId: ctx.tenantId, ...input, description: input.description ?? null },
        }),
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.category_created',
        { type: 'lab-category', id: created.id, label: label(created) },
        fieldChanges(null, created, CATEGORY_FIELDS),
      );
      return this.listCategoriesTx(tx);
    });
  }

  updateCategory(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateLabCategorySchema>,
    actor: AuthUser,
  ): Promise<LabCategoryDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.labCategory.findUnique({ where: { id } });
      if (!before) throw AppException.notFound('Category', id);
      const after = await uniqueCode(() => tx.labCategory.update({ where: { id }, data: input }));
      const changes = fieldChanges(before, after, CATEGORY_FIELDS);
      if (Object.keys(changes).length > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.category_updated',
          { type: 'lab-category', id, label: label(after) },
          changes,
        );
      }
      return this.listCategoriesTx(tx);
    });
  }

  private listCategoriesTx(tx: TenantTx, activeOnly = false): Promise<LabCategoryDto[]> {
    return tx.labCategory
      .findMany({
        where: activeOnly ? { isActive: true } : {},
        include: { _count: { select: { serviceTypes: true } } },
        orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      })
      .then((rows) =>
        rows.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          description: c.description,
          sortOrder: c.sortOrder,
          isActive: c.isActive,
          serviceTypeCount: c._count.serviceTypes,
        })),
      );
  }

  // ─── Service types ────────────────────────────────────────────────────────

  listServiceTypes(ctx: TenantContext, query: LabListQuery): Promise<ServiceTypeSummaryDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.ServiceTypeWhereInput = {
        ...(query.view === 'active' ? { isActive: true, category: { isActive: true } } : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { code: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const rows = await tx.serviceType.findMany({
        where,
        include: SERVICE_TYPE_SUMMARY_INCLUDE,
        orderBy: [
          { category: { sortOrder: 'asc' } },
          { category: { name: 'asc' } },
          { sortOrder: 'asc' },
          { name: 'asc' },
        ],
      });
      return rows.map(toServiceTypeSummaryDto);
    });
  }

  getServiceType(ctx: TenantContext, id: string): Promise<ServiceTypeDto> {
    return this.db.run(ctx.tenantId, (tx) => this.serviceTypeDetail(tx, id));
  }

  createServiceType(
    ctx: TenantContext,
    input: Out<typeof createServiceTypeSchema>,
    actor: AuthUser,
  ): Promise<ServiceTypeDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.assertCategory(tx, input.categoryId);
      const created = await uniqueCode(() =>
        tx.serviceType.create({
          data: { tenantId: ctx.tenantId, ...input, description: input.description ?? null },
          include: { category: true },
        }),
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.service_type_created',
        { type: 'service-type', id: created.id, label: label(created) },
        {
          ...fieldChanges(null, created, SERVICE_TYPE_FIELDS),
          category: { from: null, to: created.category.name },
        },
        [created.categoryId],
      );
      return this.serviceTypeDetail(tx, created.id);
    });
  }

  updateServiceType(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateServiceTypeSchema>,
    actor: AuthUser,
  ): Promise<ServiceTypeDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.serviceType.findUnique({
        where: { id },
        include: { category: true },
      });
      if (!before) throw AppException.notFound('Service type', id);
      if (input.categoryId && input.categoryId !== before.categoryId) {
        await this.assertCategory(tx, input.categoryId);
      }
      const after = await uniqueCode(() =>
        tx.serviceType.update({ where: { id }, data: input, include: { category: true } }),
      );
      const changes = {
        ...fieldChanges(before, after, SERVICE_TYPE_FIELDS),
        ...(before.categoryId !== after.categoryId
          ? { category: { from: before.category.name, to: after.category.name } }
          : {}),
      };
      if (Object.keys(changes).length > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.service_type_updated',
          { type: 'service-type', id, label: label(after) },
          changes,
          [after.categoryId],
        );
      }
      return this.serviceTypeDetail(tx, id);
    });
  }

  // ─── Registration fields ──────────────────────────────────────────────────

  addField(
    ctx: TenantContext,
    serviceTypeId: string,
    input: Out<typeof createRegistrationFieldSchema>,
    actor: AuthUser,
  ): Promise<ServiceTypeDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const st = await tx.serviceType.findUnique({ where: { id: serviceTypeId } });
      if (!st) throw AppException.notFound('Service type', serviceTypeId);
      const count = await tx.registrationField.count({ where: { serviceTypeId } });
      if (count >= MAX_REGISTRATION_FIELDS) {
        throw AppException.badRequest(
          `At most ${MAX_REGISTRATION_FIELDS} registration fields per service type`,
        );
      }
      const field = await uniqueCode(
        () =>
          tx.registrationField.create({
            data: {
              tenantId: ctx.tenantId,
              serviceTypeId,
              key: input.key,
              label: input.label,
              type: input.type,
              scope: input.scope,
              required: input.required,
              helpText: input.helpText ?? null,
              options: input.options,
              sortOrder: input.sortOrder,
            },
          }),
        'A field with this key already exists; change the label or give it another key',
        'label',
      );
      await labAudit(
        tx,
        ctx,
        actor,
        'lab.field_added',
        { type: 'service-type', id: st.id, label: label(st) },
        {
          field: { from: null, to: field.label },
          key: { from: null, to: field.key },
          type: { from: null, to: field.type },
          scope: { from: null, to: field.scope },
          ...(field.required ? { required: { from: null, to: true } } : {}),
        },
        [field.id],
      );
      return this.serviceTypeDetail(tx, serviceTypeId);
    });
  }

  updateField(
    ctx: TenantContext,
    fieldId: string,
    input: Out<typeof updateRegistrationFieldSchema>,
    actor: AuthUser,
  ): Promise<ServiceTypeDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await tx.registrationField.findUnique({
        where: { id: fieldId },
        include: { serviceType: true },
      });
      if (!before) throw AppException.notFound('Registration field', fieldId);
      if (input.options !== undefined) {
        if (before.type !== 'SELECT' && input.options.length > 0) {
          throw fieldError('options', 'Only dropdowns have options');
        }
        if (before.type === 'SELECT' && input.options.length === 0) {
          throw fieldError('options', 'A dropdown needs at least one option');
        }
      }
      const after = await tx.registrationField.update({ where: { id: fieldId }, data: input });
      const changes = {
        ...fieldChanges(before, after, FIELD_FIELDS),
        ...(JSON.stringify(before.options) !== JSON.stringify(after.options)
          ? { options: { from: before.options, to: after.options } }
          : {}),
      };
      if (Object.keys(changes).length > 0) {
        await labAudit(
          tx,
          ctx,
          actor,
          'lab.field_updated',
          { type: 'service-type', id: before.serviceTypeId, label: label(before.serviceType) },
          { field: { from: null, to: after.label }, ...changes },
          [fieldId],
        );
      }
      return this.serviceTypeDetail(tx, before.serviceTypeId);
    });
  }

  /**
   * Validates values for one registration of this service type: batch fields once, sample
   * fields for each sample. Error paths: batch.<key>, samples.<n>.<key>.
   */
  checkRegistration(
    ctx: TenantContext,
    serviceTypeId: string,
    input: Out<typeof registrationCheckSchema>,
  ): Promise<RegistrationCheckResultDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const st = await tx.serviceType.findUnique({
        where: { id: serviceTypeId },
        include: { category: true, fields: { orderBy: FIELD_ORDER } },
      });
      if (!st) throw AppException.notFound('Service type', serviceTypeId);
      return validateRegistration(st.fields.map(toFieldDto), input);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async serviceTypeDetail(tx: TenantTx, id: string): Promise<ServiceTypeDto> {
    const row = await tx.serviceType.findUnique({
      where: { id },
      include: SERVICE_TYPE_DETAIL_INCLUDE,
    });
    if (!row) throw AppException.notFound('Service type', id);
    return toServiceTypeDto(row);
  }

  private async assertCategory(tx: TenantTx, id: string): Promise<void> {
    const category = await tx.labCategory.findUnique({ where: { id } });
    if (!category) throw fieldError('categoryId', 'Choose an existing category');
    if (!category.isActive) throw fieldError('categoryId', 'This category is inactive');
  }
}

/** Shared with sample registration (M11). Throws a 400 listing every problem. */
export function validateRegistration(
  fields: RegistrationFieldDto[],
  input: { batch: Record<string, unknown>; samples: Record<string, unknown>[] },
): RegistrationCheckResultDto {
  const batchFields = fields.filter((f) => f.scope === 'BATCH');
  const sampleFields = fields.filter((f) => f.scope === 'SAMPLE');
  const batch = validateCustomFieldValues(batchFields, input.batch, 'create', 'batch');
  const samples = input.samples.map((values, i) =>
    validateCustomFieldValues(sampleFields, values, 'create', `samples.${i}`),
  );
  const issues = [...batch.issues, ...samples.flatMap((s) => s.issues)];
  if (issues.length > 0) {
    throw new AppException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
      'Some registration values are missing or invalid',
      issues,
    );
  }
  return { batch: batch.values, samples: samples.map((s) => s.values) };
}
