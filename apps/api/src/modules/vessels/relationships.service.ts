import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  MODULES,
  type FieldChange,
  type VesselRelationshipDto,
  createRelationshipSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { recordAudit, type AuditEntry } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';

const REF = { select: { id: true, code: true, name: true } } as const;
export const RELATIONSHIP_INCLUDE = {
  vessel: REF,
  client: REF,
  relationshipType: REF,
  fleetMemberships: { where: { removedAt: null }, include: { fleet: REF } },
} satisfies Prisma.VesselClientRelationshipInclude;

type RelationshipRow = Prisma.VesselClientRelationshipGetPayload<{
  include: typeof RELATIONSHIP_INCLUDE;
}>;

const toDate = (value: string | null | undefined) =>
  value ? new Date(`${value}T00:00:00Z`) : null;
const fromDate = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
const today = () => new Date().toISOString().slice(0, 10);
const label = (r: { code: string; name: string }) => `${r.code} ${r.name}`;

export function toRelationshipDto(r: RelationshipRow): VesselRelationshipDto {
  return {
    id: r.id,
    vessel: r.vessel,
    client: r.client,
    relationshipType: r.relationshipType,
    isPrimary: r.isPrimary,
    status: r.status,
    startDate: fromDate(r.startDate),
    endDate: fromDate(r.endDate),
    fleet: r.fleetMemberships[0]?.fleet ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Linking vessels to clients needs both the Vessels and the Clients modules. */
export function assertClientsModule(user: AuthUser): void {
  if (!user.modules.includes('clients')) {
    const name = MODULES.find((m) => m.key === 'clients')!.name;
    throw new AppException(
      HttpStatus.FORBIDDEN,
      ErrorCode.MODULE_NOT_ENABLED,
      `Your organisation does not have the ${name} module`,
    );
  }
}

function validationError(path: string, message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Request validation failed',
    [{ path, message }],
  );
}

/**
 * Vessel–client relationships (design pack §14) and fleet membership. Every change is audited
 * on the vessel's history, with the client and fleet as related records so it also shows in
 * theirs.
 */
@Injectable()
export class RelationshipsService {
  constructor(private readonly db: TenantDb) {}

  list(
    ctx: TenantContext,
    by: { vesselId: string } | { clientId: string },
    status: 'ACTIVE' | 'ENDED' | 'ALL',
  ): Promise<VesselRelationshipDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      if ('vesselId' in by) {
        if (!(await tx.vessel.findUnique({ where: { id: by.vesselId }, select: { id: true } }))) {
          throw AppException.notFound('Vessel', by.vesselId);
        }
      } else if (
        !(await tx.client.findUnique({ where: { id: by.clientId }, select: { id: true } }))
      ) {
        throw AppException.notFound('Client', by.clientId);
      }
      const rows = await tx.vesselClientRelationship.findMany({
        where: { ...by, ...(status === 'ALL' ? {} : { status }) },
        include: RELATIONSHIP_INCLUDE,
        orderBy: [{ status: 'asc' }, { isPrimary: 'desc' }, { createdAt: 'asc' }],
      });
      return rows.map(toRelationshipDto);
    });
  }

  create(
    ctx: TenantContext,
    vesselId: string,
    input: z.output<typeof createRelationshipSchema>,
    actor: AuthUser,
  ): Promise<VesselRelationshipDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const vessel = await tx.vessel.findUnique({ where: { id: vesselId }, select: { id: true } });
      if (!vessel) throw AppException.notFound('Vessel', vesselId);
      return toRelationshipDto(await this.createInTx(tx, ctx, vesselId, input, actor));
    });
  }

  /** Also used when creating a vessel together with its first relationship. */
  async createInTx(
    tx: TenantTx,
    ctx: TenantContext,
    vesselId: string,
    input: z.output<typeof createRelationshipSchema>,
    actor: AuthUser,
    /** Prefix for error paths, e.g. "relationship." when nested in the vessel form. */
    prefix = '',
  ): Promise<RelationshipRow> {
    const client = await tx.client.findUnique({
      where: { id: input.clientId },
      select: { status: true },
    });
    if (!client) throw validationError(`${prefix}clientId`, 'Choose an existing client');
    if (client.status !== 'ACTIVE')
      throw validationError(`${prefix}clientId`, 'This client is inactive');
    const type = await tx.referenceItem.findFirst({
      where: {
        id: input.relationshipTypeId,
        listKey: 'vessel-relationship-type',
        isActive: true,
        hiddenBy: { none: {} },
      },
      select: { id: true },
    });
    if (!type)
      throw validationError(`${prefix}relationshipTypeId`, 'Choose an available relationship type');

    if (input.isPrimary) await this.clearPrimary(tx, vesselId);
    let created: RelationshipRow;
    try {
      created = await tx.vesselClientRelationship.create({
        data: {
          tenantId: ctx.tenantId,
          vesselId,
          clientId: input.clientId,
          relationshipTypeId: input.relationshipTypeId,
          isPrimary: input.isPrimary,
          startDate: toDate(input.startDate),
        },
        include: RELATIONSHIP_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw AppException.conflict(
          'This vessel already has an active relationship of this type with this client',
        );
      }
      throw error;
    }
    let fleetName: string | null = null;
    if (input.fleetId) {
      fleetName = await this.assignFleet(tx, ctx, created, input.fleetId, `${prefix}fleetId`);
    }
    await this.audit(
      tx,
      ctx,
      actor,
      created,
      'vessel.client_linked',
      {
        client: { from: null, to: label(created.client) },
        relationshipType: { from: null, to: created.relationshipType.name },
        ...(created.isPrimary ? { isPrimary: { from: null, to: true } } : {}),
        ...(created.startDate
          ? { startDate: { from: null, to: fromDate(created.startDate) } }
          : {}),
        ...(fleetName ? { fleet: { from: null, to: fleetName } } : {}),
      },
      input.fleetId ? [input.fleetId] : [],
    );
    return await tx.vesselClientRelationship.findUniqueOrThrow({
      where: { id: created.id },
      include: RELATIONSHIP_INCLUDE,
    });
  }

  update(
    ctx: TenantContext,
    id: string,
    input: { isPrimary?: boolean; startDate?: string | null },
    actor: AuthUser,
  ): Promise<VesselRelationshipDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.findActive(tx, id);
      if (input.isPrimary && !before.isPrimary) await this.clearPrimary(tx, before.vesselId);
      const updated = await this.runChecked(() =>
        tx.vesselClientRelationship.update({
          where: { id },
          data: {
            ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
            ...(input.startDate !== undefined ? { startDate: toDate(input.startDate) } : {}),
          },
          include: RELATIONSHIP_INCLUDE,
        }),
      );
      const changes: Record<string, FieldChange> = {};
      if (before.isPrimary !== updated.isPrimary)
        changes.isPrimary = { from: before.isPrimary, to: updated.isPrimary };
      if (fromDate(before.startDate) !== fromDate(updated.startDate)) {
        changes.startDate = { from: fromDate(before.startDate), to: fromDate(updated.startDate) };
      }
      if (Object.keys(changes).length > 0) {
        await this.audit(tx, ctx, actor, updated, 'vessel.relationship_updated', {
          client: { from: null, to: label(updated.client) },
          ...changes,
        });
      }
      return toRelationshipDto(updated);
    });
  }

  /** Ends the relationship (history is kept) and takes the vessel out of the client's fleet. */
  end(
    ctx: TenantContext,
    id: string,
    endDate: string | null | undefined,
    actor: AuthUser,
  ): Promise<VesselRelationshipDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.findActive(tx, id);
      const fleet = before.fleetMemberships[0]?.fleet ?? null;
      await tx.fleetVessel.updateMany({
        where: { relationshipId: id, removedAt: null },
        data: { removedAt: new Date() },
      });
      const ended = await this.runChecked(() =>
        tx.vesselClientRelationship.update({
          where: { id },
          data: { status: 'ENDED', isPrimary: false, endDate: toDate(endDate ?? today()) },
          include: RELATIONSHIP_INCLUDE,
        }),
      );
      await this.audit(
        tx,
        ctx,
        actor,
        ended,
        'vessel.relationship_ended',
        {
          client: { from: label(ended.client), to: null },
          relationshipType: { from: ended.relationshipType.name, to: null },
          endDate: { from: null, to: fromDate(ended.endDate) },
          ...(fleet ? { fleet: { from: label(fleet), to: null } } : {}),
        },
        fleet ? [fleet.id] : [],
      );
      return toRelationshipDto(ended);
    });
  }

  /** Puts the vessel in one of the client's fleets (moving it if needed), or removes it (null). */
  setFleet(
    ctx: TenantContext,
    id: string,
    fleetId: string | null,
    actor: AuthUser,
  ): Promise<VesselRelationshipDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const rel = await this.findActive(tx, id);
      const current = rel.fleetMemberships[0]?.fleet ?? null;
      if ((current?.id ?? null) === fleetId) return toRelationshipDto(rel);
      const toName = fleetId ? await this.assignFleet(tx, ctx, rel, fleetId) : null;
      if (!fleetId) {
        await tx.fleetVessel.updateMany({
          where: { clientId: rel.clientId, vesselId: rel.vesselId, removedAt: null },
          data: { removedAt: new Date() },
        });
      }
      const updated = await tx.vesselClientRelationship.findUniqueOrThrow({
        where: { id },
        include: RELATIONSHIP_INCLUDE,
      });
      await this.audit(
        tx,
        ctx,
        actor,
        updated,
        'vessel.fleet_changed',
        {
          client: { from: null, to: label(updated.client) },
          fleet: { from: current ? label(current) : null, to: toName },
        },
        [current?.id, fleetId].filter((x): x is string => Boolean(x)),
      );
      return toRelationshipDto(updated);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Moves the vessel into the fleet (one fleet per client at a time). Returns "FL-… Name". */
  private async assignFleet(
    tx: TenantTx,
    ctx: TenantContext,
    rel: RelationshipRow,
    fleetId: string,
    path = 'fleetId',
  ): Promise<string> {
    const fleet = await tx.fleet.findUnique({ where: { id: fleetId } });
    if (!fleet || fleet.clientId !== rel.clientId) {
      throw validationError(path, "Choose one of this client's fleets");
    }
    if (fleet.status !== 'ACTIVE') throw validationError(path, 'This fleet is inactive');
    await tx.fleetVessel.updateMany({
      where: { clientId: rel.clientId, vesselId: rel.vesselId, removedAt: null },
      data: { removedAt: new Date() },
    });
    await tx.fleetVessel.create({
      data: {
        tenantId: ctx.tenantId,
        fleetId,
        clientId: rel.clientId,
        vesselId: rel.vesselId,
        relationshipId: rel.id,
      },
    });
    return label(fleet);
  }

  private async findActive(tx: TenantTx, id: string): Promise<RelationshipRow> {
    const rel = await tx.vesselClientRelationship.findUnique({
      where: { id },
      include: RELATIONSHIP_INCLUDE,
    });
    if (!rel) throw AppException.notFound('Relationship', id);
    if (rel.status !== 'ACTIVE') throw AppException.badRequest('This relationship has ended');
    return rel;
  }

  private async clearPrimary(tx: TenantTx, vesselId: string): Promise<void> {
    await tx.vesselClientRelationship.updateMany({
      where: { vesselId, status: 'ACTIVE', isPrimary: true },
      data: { isPrimary: false },
    });
  }

  /** Database date rules (end ≥ start) surface as a field error. */
  private async runChecked<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientUnknownRequestError ||
        error instanceof Prisma.PrismaClientKnownRequestError
      ) {
        if (String(error.message).includes('vcr_dates_chk')) {
          throw validationError('endDate', 'The end date cannot be before the start date');
        }
      }
      throw error;
    }
  }

  private audit(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    rel: RelationshipRow,
    action: AuditEntry['action'],
    changes: AuditEntry['changes'],
    extraRelated: string[] = [],
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: { type: 'vessel', id: rel.vesselId, label: label(rel.vessel) },
      relatedIds: [rel.clientId, rel.id, ...extraRelated],
      changes,
    });
  }
}
