import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ErrorCode,
  formatReceivedKitCode,
  type AirwayBillDto,
  type AirwayBillSummaryDto,
  type PageQuery,
  type ReceivedKitDto,
  type ReceivingOptionsDto,
  type RegistrationQueueQuery,
  type airwayBillListQuerySchema,
  type createAirwayBillSchema,
  type receiveKitSchema,
  type updateAirwayBillSchema,
  type updateReceivedKitSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { nextSequence } from '../../database/sequences';
import { fieldChanges, recordAudit, type AuditEntry } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import {
  KIT_INCLUDE,
  kitAuditValues,
  toAwbSummaryDto,
  toKitDto,
  type KitRow,
} from './receiving.mapper';

type Out<T extends z.ZodType> = z.output<T>;
type KitInput = Partial<Out<typeof receiveKitSchema>>;

const AWB_FIELDS = ['number', 'courier', 'origin', 'receivedOn', 'notes'] as const;
const KIT_AUDIT_FIELDS = [
  'serialNumber',
  'kit',
  'variant',
  'serviceType',
  'client',
  'vessel',
  'condition',
  'conditionNotes',
] as const;

const toDate = (v: string) => new Date(`${v}T00:00:00Z`);
const today = () => new Date().toISOString().slice(0, 10);

function fieldError(path: string, message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Request validation failed',
    [{ path, message }],
  );
}

/**
 * Bulk Receiving (design pack §8): Airway Bills and the kits received under them. Receiving is a
 * separate business event from registration; kits wait in the registration queue (status
 * PENDING_REGISTRATION) with vessel, client and service type completed whenever they are known.
 */
@Injectable()
export class ReceivingService {
  constructor(private readonly db: TenantDb) {}

  // ─── Form options ─────────────────────────────────────────────────────────

  options(ctx: TenantContext, user: AuthUser): Promise<ReceivingOptionsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const REF = { id: true, code: true, name: true } as const;
      const products = await tx.product.findMany({
        where: { isActive: true },
        select: {
          ...REF,
          variants: { where: { isActive: true }, select: REF, orderBy: { name: 'asc' } },
          serviceTypes: {
            where: { serviceType: { isActive: true, category: { isActive: true } } },
            select: { serviceType: { select: REF } },
            orderBy: { serviceType: { name: 'asc' } },
          },
        },
        orderBy: { name: 'asc' },
      });
      const clients = user.modules.includes('clients')
        ? await tx.client.findMany({
            where: { status: 'ACTIVE' },
            select: REF,
            orderBy: { name: 'asc' },
          })
        : [];
      const vessels = user.modules.includes('vessels')
        ? await tx.vessel.findMany({
            where: { status: 'ACTIVE' },
            select: {
              ...REF,
              imoNumber: true,
              relationships: {
                where: { status: 'ACTIVE', client: { status: 'ACTIVE' } },
                select: { clientId: true, isPrimary: true },
                orderBy: { isPrimary: 'desc' },
              },
            },
            orderBy: { name: 'asc' },
          })
        : [];
      return {
        kits: products.map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          variants: p.variants,
          serviceTypes: p.serviceTypes.map((s) => s.serviceType),
        })),
        clients,
        vessels: vessels.map((v) => ({
          id: v.id,
          code: v.code,
          name: v.name,
          imoNumber: v.imoNumber,
          clientIds: [...new Set(v.relationships.map((r) => r.clientId))],
          primaryClientId: v.relationships.find((r) => r.isPrimary)?.clientId ?? null,
        })),
      };
    });
  }

  // ─── Airway bills ─────────────────────────────────────────────────────────

  listAirwayBills(
    ctx: TenantContext,
    query: Out<typeof airwayBillListQuerySchema>,
    page: PageQuery,
  ): Promise<Paginated<AirwayBillSummaryDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.AirwayBillWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.q
          ? {
              OR: [
                { number: { contains: query.q.replace(/\s+/g, ''), mode: 'insensitive' } },
                { courier: { contains: query.q, mode: 'insensitive' } },
                { origin: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.airwayBill.findMany({
          where,
          orderBy: [{ status: 'asc' }, { receivedOn: 'desc' }, { createdAt: 'desc' }],
          ...toSkipTake(page),
        }),
        tx.airwayBill.count({ where }),
      ]);
      const counts = await this.kitCounts(
        tx,
        rows.map((r) => r.id),
      );
      return new Paginated(
        rows.map((r) =>
          toAwbSummaryDto({ ...r, ...(counts.get(r.id) ?? { kitCount: 0, pendingCount: 0 }) }),
        ),
        total,
        page,
      );
    });
  }

  getAirwayBill(ctx: TenantContext, id: string): Promise<AirwayBillDto> {
    return this.db.run(ctx.tenantId, (tx) => this.airwayBill(tx, id));
  }

  createAirwayBill(
    ctx: TenantContext,
    input: Out<typeof createAirwayBillSchema>,
    actor: AuthUser,
  ): Promise<AirwayBillDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const created = await this.uniqueNumber(() =>
        tx.airwayBill.create({
          data: {
            tenantId: ctx.tenantId,
            number: input.number,
            courier: input.courier ?? null,
            origin: input.origin ?? null,
            receivedOn: toDate(input.receivedOn ?? today()),
            notes: input.notes ?? null,
          },
        }),
      );
      await this.auditAwb(
        tx,
        ctx,
        actor,
        created,
        'receiving.awb_created',
        fieldChanges(null, created, AWB_FIELDS),
      );
      return this.airwayBill(tx, created.id);
    });
  }

  updateAirwayBill(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateAirwayBillSchema>,
    actor: AuthUser,
  ): Promise<AirwayBillDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.findAwb(tx, id);
      const after = await this.uniqueNumber(() =>
        tx.airwayBill.update({
          where: { id },
          data: {
            ...(input.number !== undefined ? { number: input.number } : {}),
            ...(input.courier !== undefined ? { courier: input.courier } : {}),
            ...(input.origin !== undefined ? { origin: input.origin } : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.receivedOn ? { receivedOn: toDate(input.receivedOn) } : {}),
          },
        }),
      );
      const changes = fieldChanges(before, after, AWB_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.auditAwb(tx, ctx, actor, after, 'receiving.awb_updated', changes);
      }
      return this.airwayBill(tx, id);
    });
  }

  /** CLOSED: no more kits can be received under it. Reopening is allowed. */
  setAirwayBillOpen(
    ctx: TenantContext,
    id: string,
    open: boolean,
    actor: AuthUser,
  ): Promise<AirwayBillDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const awb = await this.findAwb(tx, id);
      if ((awb.status === 'OPEN') === open) return this.airwayBill(tx, id);
      const updated = await tx.airwayBill.update({
        where: { id },
        data: open
          ? { status: 'OPEN', closedAt: null }
          : { status: 'CLOSED', closedAt: new Date() },
      });
      await this.auditAwb(
        tx,
        ctx,
        actor,
        updated,
        open ? 'receiving.awb_reopened' : 'receiving.awb_closed',
        {
          status: { from: awb.status, to: updated.status },
        },
      );
      return this.airwayBill(tx, id);
    });
  }

  // ─── Kits ─────────────────────────────────────────────────────────────────

  receiveKit(
    ctx: TenantContext,
    airwayBillId: string,
    input: Out<typeof receiveKitSchema>,
    actor: AuthUser,
  ): Promise<ReceivedKitDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const awb = await this.findAwb(tx, airwayBillId);
      if (awb.status !== 'OPEN') {
        throw AppException.badRequest('This airway bill is closed; reopen it to receive more kits');
      }
      const links = await this.resolveLinks(tx, actor, input, null);
      const code = formatReceivedKitCode(await nextSequence(tx, ctx.tenantId, 'received-kit'));
      const kit = await this.uniqueSerial(tx, input.serialNumber, () =>
        tx.receivedKit.create({
          data: {
            tenantId: ctx.tenantId,
            code,
            airwayBillId,
            ...links,
            serialNumber: input.serialNumber ?? null,
            condition: input.condition,
            conditionNotes: input.conditionNotes ?? null,
            receivedById: actor.id,
          },
          include: KIT_INCLUDE,
        }),
      );
      await this.auditKit(
        tx,
        ctx,
        actor,
        kit,
        'receiving.kit_received',
        fieldChanges(null, kitAuditValues(kit), KIT_AUDIT_FIELDS),
      );
      return toKitDto(kit);
    });
  }

  getKit(ctx: TenantContext, id: string): Promise<ReceivedKitDto> {
    return this.db.run(ctx.tenantId, async (tx) => toKitDto(await this.findKit(tx, id)));
  }

  /** Completes or corrects a kit while it waits for registration. */
  updateKit(
    ctx: TenantContext,
    id: string,
    input: Out<typeof updateReceivedKitSchema>,
    actor: AuthUser,
  ): Promise<ReceivedKitDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.findPending(tx, id);
      const merged: KitInput = {
        productId: input.productId ?? before.productId,
        variantId: input.variantId !== undefined ? input.variantId : before.variantId,
        serviceTypeId:
          input.serviceTypeId !== undefined ? input.serviceTypeId : before.serviceTypeId,
        clientId: input.clientId !== undefined ? input.clientId : before.clientId,
        vesselId: input.vesselId !== undefined ? input.vesselId : before.vesselId,
      };
      // Linking a vessel to a kit without a client fills in the vessel's primary client.
      if (input.clientId === undefined && before.clientId === null) merged.clientId = undefined;
      // A different kit type starts its variant and service type afresh unless given.
      if (input.productId && input.productId !== before.productId) {
        if (input.variantId === undefined) merged.variantId = null;
        if (input.serviceTypeId === undefined) merged.serviceTypeId = null;
      }
      const links = await this.resolveLinks(tx, actor, merged, before);
      const after = await this.uniqueSerial(
        tx,
        input.serialNumber,
        () =>
          tx.receivedKit.update({
            where: { id },
            data: {
              ...links,
              ...(input.serialNumber !== undefined ? { serialNumber: input.serialNumber } : {}),
              ...(input.condition !== undefined ? { condition: input.condition } : {}),
              ...(input.conditionNotes !== undefined
                ? { conditionNotes: input.conditionNotes }
                : {}),
            },
            include: KIT_INCLUDE,
          }),
        id,
      );
      const changes = fieldChanges(kitAuditValues(before), kitAuditValues(after), KIT_AUDIT_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.auditKit(tx, ctx, actor, after, 'receiving.kit_updated', changes, [
          before.clientId,
          before.vesselId,
        ]);
      }
      return toKitDto(after);
    });
  }

  cancelKit(
    ctx: TenantContext,
    id: string,
    reason: string,
    actor: AuthUser,
  ): Promise<ReceivedKitDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      await this.findPending(tx, id);
      const kit = await tx.receivedKit.update({
        where: { id },
        data: { status: 'CANCELLED', cancelReason: reason },
        include: KIT_INCLUDE,
      });
      await this.auditKit(tx, ctx, actor, kit, 'receiving.kit_cancelled', {
        status: { from: 'PENDING_REGISTRATION', to: 'CANCELLED' },
        reason: { from: null, to: reason },
      });
      return toKitDto(kit);
    });
  }

  // ─── Registration queue ───────────────────────────────────────────────────

  queue(
    ctx: TenantContext,
    query: RegistrationQueueQuery,
    page: PageQuery,
  ): Promise<Paginated<ReceivedKitDto>> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const where: Prisma.ReceivedKitWhereInput = {
        status: 'PENDING_REGISTRATION',
        ...(query.link === 'linked' ? { vesselId: { not: null } } : {}),
        ...(query.link === 'unlinked' ? { vesselId: null } : {}),
        ...(query.serviceTypeId ? { serviceTypeId: query.serviceTypeId } : {}),
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.airwayBillId ? { airwayBillId: query.airwayBillId } : {}),
        ...(query.flagged ? { condition: { not: 'OK' } } : {}),
        ...(query.q
          ? {
              OR: [
                { code: { contains: query.q, mode: 'insensitive' } },
                { serialNumber: { contains: query.q, mode: 'insensitive' } },
                { vessel: { name: { contains: query.q, mode: 'insensitive' } } },
                {
                  airwayBill: {
                    number: { contains: query.q.replace(/\s+/g, ''), mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.receivedKit.findMany({
          where,
          include: KIT_INCLUDE,
          orderBy: [{ receivedAt: 'asc' }, { code: 'asc' }],
          ...toSkipTake(page),
        }),
        tx.receivedKit.count({ where }),
      ]);
      return new Paginated(rows.map(toKitDto), total, page);
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Validates the kit type and links and fills defaults: a kit used for one service type gets
   * it; a vessel without a client gets its primary client. Newly chosen items must be active;
   * unchanged ones may have become inactive since.
   */
  private async resolveLinks(
    tx: TenantTx,
    user: AuthUser,
    input: KitInput,
    before: KitRow | null,
  ): Promise<{
    productId: string;
    variantId: string | null;
    serviceTypeId: string | null;
    clientId: string | null;
    vesselId: string | null;
  }> {
    const changed = (key: 'productId' | 'variantId' | 'serviceTypeId' | 'clientId' | 'vesselId') =>
      !before || before[key] !== (input[key] ?? null);

    const product = await tx.product.findUnique({
      where: { id: input.productId! },
      include: {
        variants: true,
        serviceTypes: { include: { serviceType: { include: { category: true } } } },
      },
    });
    if (!product) throw fieldError('productId', 'Choose an existing kit');
    if (!product.isActive && changed('productId'))
      throw fieldError('productId', 'This kit is inactive');

    const variantId = input.variantId ?? null;
    const activeVariants = product.variants
      .filter((v) => v.isActive)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (variantId) {
      const variant = product.variants.find((v) => v.id === variantId);
      if (!variant) throw fieldError('variantId', 'Choose a variant of this kit');
      if (!variant.isActive && changed('variantId'))
        throw fieldError('variantId', 'This variant is inactive');
    } else if (activeVariants.length > 0) {
      throw fieldError(
        'variantId',
        `Choose the variant (${activeVariants.map((v) => v.name).join(', ')})`,
      );
    }

    let serviceTypeId = input.serviceTypeId ?? null;
    const usable = product.serviceTypes
      .map((s) => s.serviceType)
      .filter((s) => s.isActive && s.category.isActive);
    if (serviceTypeId) {
      const st = product.serviceTypes.find((s) => s.serviceTypeId === serviceTypeId)?.serviceType;
      if (!st) throw fieldError('serviceTypeId', 'This kit is not used for that service type');
      if (!usable.includes(st) && changed('serviceTypeId')) {
        throw fieldError('serviceTypeId', 'This service type is inactive');
      }
    } else if (usable.length === 1) {
      serviceTypeId = usable[0]!.id;
    }

    let clientId = input.clientId ?? null;
    const vesselId = input.vesselId ?? null;
    if (vesselId) {
      if (!user.modules.includes('vessels'))
        throw fieldError('vesselId', 'Vessels are not enabled');
      const vessel = await tx.vessel.findUnique({
        where: { id: vesselId },
        include: { relationships: { where: { status: 'ACTIVE' } } },
      });
      if (!vessel) throw fieldError('vesselId', 'Choose an existing vessel');
      if (vessel.status !== 'ACTIVE' && changed('vesselId'))
        throw fieldError('vesselId', 'This vessel is inactive');
      if (clientId && !vessel.relationships.some((r) => r.clientId === clientId)) {
        throw fieldError('clientId', 'This vessel is not linked to that client');
      }
      if (!clientId && input.clientId === undefined) {
        clientId = vessel.relationships.find((r) => r.isPrimary)?.clientId ?? null;
      }
    }
    if (clientId) {
      if (!user.modules.includes('clients'))
        throw fieldError('clientId', 'Clients are not enabled');
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) throw fieldError('clientId', 'Choose an existing client');
      if (client.status !== 'ACTIVE' && changed('clientId'))
        throw fieldError('clientId', 'This client is inactive');
    }
    return { productId: product.id, variantId, serviceTypeId, clientId, vesselId };
  }

  /** A duplicate live serial becomes a field error naming the kit that has it. */
  private async uniqueSerial<T>(
    tx: TenantTx,
    serial: string | null | undefined,
    fn: () => Promise<T>,
    selfId?: string,
  ): Promise<T> {
    if (serial) {
      const other = await tx.receivedKit.findFirst({
        where: {
          serialNumber: serial,
          status: { not: 'CANCELLED' },
          ...(selfId ? { id: { not: selfId } } : {}),
        },
        select: { code: true },
      });
      if (other)
        throw fieldError('serialNumber', `Serial ${serial} is already received as ${other.code}`);
    }
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw fieldError('serialNumber', `Serial ${serial} is already received`);
      }
      throw error;
    }
  }

  private async uniqueNumber<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw fieldError('number', 'An airway bill with this number already exists');
      }
      throw error;
    }
  }

  private async findAwb(tx: TenantTx, id: string) {
    const awb = await tx.airwayBill.findUnique({ where: { id } });
    if (!awb) throw AppException.notFound('Airway bill', id);
    return awb;
  }

  private async airwayBill(tx: TenantTx, id: string): Promise<AirwayBillDto> {
    const awb = await this.findAwb(tx, id);
    const kits = await tx.receivedKit.findMany({
      where: { airwayBillId: id },
      include: KIT_INCLUDE,
      orderBy: [{ receivedAt: 'desc' }, { code: 'desc' }],
    });
    return {
      ...toAwbSummaryDto({
        ...awb,
        kitCount: kits.filter((k) => k.status !== 'CANCELLED').length,
        pendingCount: kits.filter((k) => k.status === 'PENDING_REGISTRATION').length,
      }),
      notes: awb.notes,
      closedAt: awb.closedAt?.toISOString() ?? null,
      kits: kits.map(toKitDto),
    };
  }

  private async kitCounts(tx: TenantTx, ids: string[]) {
    const groups = await tx.receivedKit.groupBy({
      by: ['airwayBillId', 'status'],
      where: { airwayBillId: { in: ids }, status: { not: 'CANCELLED' } },
      _count: { _all: true },
    });
    const result = new Map<string, { kitCount: number; pendingCount: number }>();
    for (const g of groups) {
      const c = result.get(g.airwayBillId) ?? { kitCount: 0, pendingCount: 0 };
      c.kitCount += g._count._all;
      if (g.status === 'PENDING_REGISTRATION') c.pendingCount += g._count._all;
      result.set(g.airwayBillId, c);
    }
    return result;
  }

  private async findKit(tx: TenantTx, id: string): Promise<KitRow> {
    const kit = await tx.receivedKit.findUnique({ where: { id }, include: KIT_INCLUDE });
    if (!kit) throw AppException.notFound('Received kit', id);
    return kit;
  }

  private async findPending(tx: TenantTx, id: string): Promise<KitRow> {
    const kit = await this.findKit(tx, id);
    if (kit.status !== 'PENDING_REGISTRATION') {
      throw AppException.badRequest(
        kit.status === 'REGISTERED' ? 'This kit is already registered' : 'This kit was cancelled',
      );
    }
    return kit;
  }

  private auditAwb(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    awb: { id: string; number: string },
    action: AuditEntry['action'],
    changes: AuditEntry['changes'],
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: { type: 'airway-bill', id: awb.id, label: `AWB ${awb.number}` },
      changes,
    });
  }

  /** Kit entries also show in the AWB's, client's and vessel's history. */
  private auditKit(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    kit: KitRow,
    action: AuditEntry['action'],
    changes: AuditEntry['changes'],
    extraRelated: (string | null)[] = [],
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: {
        type: 'received-kit',
        id: kit.id,
        label: kit.serialNumber ? `${kit.code} (${kit.serialNumber})` : kit.code,
      },
      relatedIds: [kit.airwayBillId, kit.clientId, kit.vesselId, ...extraRelated].filter(
        (x): x is string => Boolean(x),
      ),
      changes,
    });
  }
}
