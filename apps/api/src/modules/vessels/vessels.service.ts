import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  formatVesselCode,
  type CustomFieldValues,
  type FieldChange,
  type FieldIssue,
  type PageQuery,
  type UpdateVesselRequest,
  type VesselDto,
  type VesselListFilter,
  type VesselReferenceDto,
  type VesselSummaryDto,
  createVesselSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { nextSequence } from '../../database/sequences';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { compactChanges, fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { RelationshipsService, assertClientsModule } from './relationships.service';

const REF_SELECT = { select: { id: true, code: true, name: true } } as const;
const VESSEL_INCLUDE = {
  vesselType: REF_SELECT,
  classificationSociety: REF_SELECT,
} satisfies Prisma.VesselInclude;

type VesselRow = Prisma.VesselGetPayload<{ include: typeof VESSEL_INCLUDE }>;

const SCALAR_FIELDS = [
  'name',
  'imoNumber',
  'previousName',
  'callSign',
  'yearBuilt',
  'grossTonnage',
  'deadweight',
  'status',
] as const;

/** Reference fields and the list each must come from. */
const REFERENCES = [
  { field: 'vesselTypeId', relation: 'vesselType', list: 'vessel-type', label: 'vessel type' },
  {
    field: 'classificationSocietyId',
    relation: 'classificationSociety',
    list: 'classification-society',
    label: 'classification society',
  },
] as const;

function toSummary(v: VesselRow): VesselSummaryDto {
  return {
    id: v.id,
    code: v.code,
    name: v.name,
    imoNumber: v.imoNumber,
    vesselType: v.vesselType as VesselReferenceDto | null,
    status: v.status,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function toVesselDto(v: VesselRow): VesselDto {
  return {
    ...toSummary(v),
    previousName: v.previousName,
    callSign: v.callSign,
    classificationSociety: v.classificationSociety as VesselReferenceDto | null,
    yearBuilt: v.yearBuilt,
    grossTonnage: v.grossTonnage,
    deadweight: v.deadweight,
    customFields: (v.customFields as CustomFieldValues) ?? {},
  };
}

/**
 * Vessel master records of the caller's tenant (row-level security via TenantDb). Every change
 * is audited in the same transaction.
 */
@Injectable()
export class VesselsService {
  constructor(
    private readonly db: TenantDb,
    private readonly customFields: CustomFieldsService,
    private readonly relationships: RelationshipsService,
  ) {}

  list(
    ctx: TenantContext,
    query: PageQuery & VesselListFilter,
  ): Promise<Paginated<VesselSummaryDto>> {
    const q = query.q?.replace(/^IMO\s*/i, '');
    const where: Prisma.VesselWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.vesselTypeId ? { vesselTypeId: query.vesselTypeId } : {}),
      ...(q
        ? {
            OR: [
              { code: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { previousName: { contains: q, mode: 'insensitive' } },
              { imoNumber: { contains: q } },
              { callSign: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return this.db.run(ctx.tenantId, async (tx) => {
      const [vessels, total] = await Promise.all([
        tx.vessel.findMany({
          where,
          include: VESSEL_INCLUDE,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.vessel.count({ where }),
      ]);
      return new Paginated(vessels.map(toSummary), total, query);
    });
  }

  get(ctx: TenantContext, id: string): Promise<VesselDto> {
    return this.db.run(ctx.tenantId, async (tx) => toVesselDto(await this.find(tx, id)));
  }

  create(
    ctx: TenantContext,
    input: z.output<typeof createVesselSchema>,
    actor: AuthUser,
  ): Promise<VesselDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const { customFields: customInput, relationship, ...fields } = input;
      if (relationship) assertClientsModule(actor);
      // Validate everything before taking a number, so failed creates never touch the sequence.
      await this.assertReferencesUsable(tx, fields);
      if (fields.imoNumber) await this.assertImoAvailable(tx, fields.imoNumber);
      const custom = await this.customFields.resolveValues(tx, 'vessel', customInput, 'create');
      const code = formatVesselCode(await nextSequence(tx, ctx.tenantId, 'vessel'));
      try {
        const vessel = await tx.vessel.create({
          data: { ...fields, tenantId: ctx.tenantId, code, customFields: custom.values },
          include: VESSEL_INCLUDE,
        });
        await this.audit(tx, ctx, actor, vessel, 'vessel.created', {
          code: { from: null, to: code },
          ...fieldChanges(
            null,
            vessel,
            SCALAR_FIELDS.filter((f) => f !== 'status'),
          ),
          ...this.referenceChanges(null, vessel),
          ...custom.changes,
        });
        if (relationship) {
          // Same transaction: the vessel and its first client link are created together or not at all.
          await this.relationships.createInTx(
            tx,
            ctx,
            vessel.id,
            relationship,
            actor,
            'relationship.',
          );
        }
        return toVesselDto(vessel);
      } catch (error) {
        throw this.mapUniqueViolation(error);
      }
    });
  }

  update(
    ctx: TenantContext,
    id: string,
    input: UpdateVesselRequest,
    actor: AuthUser,
  ): Promise<VesselDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.find(tx, id);
      const { customFields: customInput, ...fields } = input;
      // Only newly chosen references must be usable; a vessel keeps a value that was hidden later.
      await this.assertReferencesUsable(tx, {
        vesselTypeId: fields.vesselTypeId !== before.vesselTypeId ? fields.vesselTypeId : undefined,
        classificationSocietyId:
          fields.classificationSocietyId !== before.classificationSocietyId
            ? fields.classificationSocietyId
            : undefined,
      });
      if (fields.imoNumber && fields.imoNumber !== before.imoNumber) {
        await this.assertImoAvailable(tx, fields.imoNumber, id);
      }
      const custom =
        customInput === undefined
          ? null
          : await this.customFields.resolveValues(
              tx,
              'vessel',
              customInput,
              'update',
              before.customFields as CustomFieldValues,
            );
      try {
        const updated = await tx.vessel.update({
          where: { id },
          data: { ...fields, ...(custom ? { customFields: custom.values } : {}) },
          include: VESSEL_INCLUDE,
        });
        const changes = compactChanges({
          ...fieldChanges(before, updated, SCALAR_FIELDS),
          ...this.referenceChanges(before, updated),
          ...custom?.changes,
        });
        if (changes) {
          await this.audit(
            tx,
            ctx,
            actor,
            updated,
            changes.status
              ? updated.status === 'ACTIVE'
                ? 'vessel.activated'
                : 'vessel.deactivated'
              : 'vessel.updated',
            changes,
          );
        }
        return toVesselDto(updated);
      } catch (error) {
        throw this.mapUniqueViolation(error);
      }
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async find(tx: TenantTx, id: string): Promise<VesselRow> {
    const vessel = await tx.vessel.findUnique({ where: { id }, include: VESSEL_INCLUDE });
    if (!vessel) throw AppException.notFound('Vessel', id);
    return vessel;
  }

  /**
   * A chosen reference must be an active, non-hidden item of the right list that this tenant can
   * see (FLUX default or its own). Row-level security limits the lookup to those items.
   */
  private async assertReferencesUsable(
    tx: TenantTx,
    values: { vesselTypeId?: string | null; classificationSocietyId?: string | null },
  ): Promise<void> {
    const issues: FieldIssue[] = [];
    for (const ref of REFERENCES) {
      const id = values[ref.field];
      if (!id) continue;
      const item = await tx.referenceItem.findFirst({
        where: { id, listKey: ref.list, isActive: true, hiddenBy: { none: {} } },
        select: { id: true },
      });
      if (!item) issues.push({ path: ref.field, message: `Choose an available ${ref.label}` });
    }
    if (issues.length > 0) {
      throw new AppException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
        'Request validation failed',
        issues,
      );
    }
  }

  /** Duplicate IMO: point the user at the existing vessel instead of creating a copy. */
  private async assertImoAvailable(
    tx: TenantTx,
    imoNumber: string,
    exceptId?: string,
  ): Promise<void> {
    const existing = await tx.vessel.findFirst({
      where: { imoNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true, code: true, name: true },
    });
    if (existing) throw this.imoTaken(existing);
  }

  private imoTaken(existing?: { id: string; code: string; name: string }): AppException {
    const message = existing
      ? `IMO already registered for ${existing.code} ${existing.name}`
      : 'This IMO number is already registered';
    return AppException.conflict(message, {
      fields: [{ path: 'imoNumber', message }],
      ...(existing ? { existingVessel: existing } : {}),
    });
  }

  private mapUniqueViolation(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002' &&
      String(error.meta?.target ?? '').includes('imo')
    ) {
      return this.imoTaken();
    }
    return error;
  }

  private referenceChanges(
    before: VesselRow | null,
    after: VesselRow,
  ): Record<string, FieldChange> {
    const changes: Record<string, FieldChange> = {};
    for (const ref of REFERENCES) {
      const from = before?.[ref.relation]?.name ?? null;
      const to = after[ref.relation]?.name ?? null;
      if (from !== to) changes[ref.relation] = { from, to };
    }
    return changes;
  }

  private audit(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    vessel: VesselRow,
    action: 'vessel.created' | 'vessel.updated' | 'vessel.activated' | 'vessel.deactivated',
    changes: Record<string, unknown> | null,
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: { type: 'vessel', id: vessel.id, label: `${vessel.code} ${vessel.name}` },
      changes: changes as never,
    });
  }
}
