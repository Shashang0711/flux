import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatFleetCode, type FleetDto } from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import { nextSequence } from '../../database/sequences';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { fieldChanges, recordAudit } from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';

const REF = { select: { id: true, code: true, name: true } } as const;
const FLEET_INCLUDE = {
  client: REF,
  members: {
    where: { removedAt: null },
    include: { relationship: { select: { id: true, vessel: REF } } },
    orderBy: { assignedAt: 'asc' },
  },
} satisfies Prisma.FleetInclude;

type FleetRow = Prisma.FleetGetPayload<{ include: typeof FLEET_INCLUDE }>;

function toFleetDto(f: FleetRow): FleetDto {
  return {
    id: f.id,
    code: f.code,
    name: f.name,
    client: f.client,
    status: f.status,
    vessels: f.members.map((m) => ({
      ...m.relationship.vessel,
      relationshipId: m.relationship.id,
    })),
    createdAt: f.createdAt.toISOString(),
  };
}

const NAME_TAKEN = () =>
  AppException.conflict('This client already has a fleet with this name', {
    fields: [{ path: 'name', message: 'Name is already in use for this client' }],
  });

/** Fleets belong to a client (design pack §14); vessels join through their relationship. */
@Injectable()
export class FleetsService {
  constructor(private readonly db: TenantDb) {}

  listForClient(ctx: TenantContext, clientId: string): Promise<FleetDto[]> {
    return this.db.run(ctx.tenantId, async (tx) => {
      if (!(await tx.client.findUnique({ where: { id: clientId }, select: { id: true } }))) {
        throw AppException.notFound('Client', clientId);
      }
      const fleets = await tx.fleet.findMany({
        where: { clientId },
        include: FLEET_INCLUDE,
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
      });
      return fleets.map(toFleetDto);
    });
  }

  get(ctx: TenantContext, id: string): Promise<FleetDto> {
    return this.db.run(ctx.tenantId, async (tx) => toFleetDto(await this.find(tx, id)));
  }

  create(
    ctx: TenantContext,
    input: { clientId: string; name: string },
    actor: AuthUser,
  ): Promise<FleetDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: input.clientId } });
      if (!client) throw AppException.notFound('Client', input.clientId);
      await this.assertNameFree(tx, input.clientId, input.name);
      const code = formatFleetCode(await nextSequence(tx, ctx.tenantId, 'fleet'));
      const fleet = await tx.fleet.create({
        data: { tenantId: ctx.tenantId, clientId: input.clientId, code, name: input.name },
        include: FLEET_INCLUDE,
      });
      await recordAudit(tx, {
        tenantId: ctx.tenantId,
        actor,
        action: 'fleet.created',
        entity: { type: 'fleet', id: fleet.id, label: `${code} ${fleet.name}` },
        relatedIds: [client.id],
        changes: {
          code: { from: null, to: code },
          name: { from: null, to: fleet.name },
          client: { from: null, to: `${client.code} ${client.name}` },
        },
      });
      return toFleetDto(fleet);
    });
  }

  update(
    ctx: TenantContext,
    id: string,
    input: { name?: string; status?: 'ACTIVE' | 'INACTIVE' },
    actor: AuthUser,
  ): Promise<FleetDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.find(tx, id);
      if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
        await this.assertNameFree(tx, before.clientId, input.name);
      }
      if (input.status === 'INACTIVE' && before.members.length > 0) {
        throw AppException.badRequest(
          'Move or remove the vessels in this fleet before deactivating it',
        );
      }
      const updated = await tx.fleet.update({ where: { id }, data: input, include: FLEET_INCLUDE });
      const changes = fieldChanges(before, updated, ['name', 'status']);
      if (Object.keys(changes).length > 0) {
        await recordAudit(tx, {
          tenantId: ctx.tenantId,
          actor,
          action: changes.status
            ? updated.status === 'ACTIVE'
              ? 'fleet.activated'
              : 'fleet.deactivated'
            : 'fleet.updated',
          entity: { type: 'fleet', id, label: `${updated.code} ${updated.name}` },
          relatedIds: [updated.clientId],
          changes,
        });
      }
      return toFleetDto(updated);
    });
  }

  private async find(tx: TenantTx, id: string): Promise<FleetRow> {
    const fleet = await tx.fleet.findUnique({ where: { id }, include: FLEET_INCLUDE });
    if (!fleet) throw AppException.notFound('Fleet', id);
    return fleet;
  }

  private async assertNameFree(tx: TenantTx, clientId: string, name: string): Promise<void> {
    const clash = await tx.fleet.findFirst({
      where: { clientId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true },
    });
    if (clash) throw NAME_TAKEN();
  }
}
