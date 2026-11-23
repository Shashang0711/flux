import { Injectable } from '@nestjs/common';
import type { AuditLog, Prisma } from '@prisma/client';
import type {
  AuditAction,
  AuditChanges,
  AuditEntityType,
  AuditListFilter,
  AuditLogDto,
  PageQuery,
} from '@flux/shared';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { PrismaService } from '../../database/prisma.service';
import { TenantDb } from '../../database/tenant-db.service';
import type { TenantContext } from '../auth/auth.types';

/**
 * Converts a stored entry. Tenant users see platform operators as "FLUX platform", never the
 * operator's personal details.
 */
export function toAuditLogDto(entry: AuditLog, viewer: 'tenant' | 'platform'): AuditLogDto {
  const maskPlatform = viewer === 'tenant' && entry.actorType === 'PLATFORM_ADMIN';
  return {
    id: entry.id,
    occurredAt: entry.occurredAt.toISOString(),
    actor: {
      type: entry.actorType,
      id: maskPlatform ? null : entry.actorId,
      name: maskPlatform ? 'FLUX platform' : entry.actorName,
      email: maskPlatform ? null : entry.actorEmail,
    },
    action: entry.action as AuditAction,
    entity: {
      type: entry.entityType as AuditEntityType,
      id: entry.entityId,
      label: entry.entityLabel,
    },
    changes: (entry.changes as AuditChanges | null) ?? null,
    requestId: entry.requestId,
  };
}

function whereFor(filter: AuditListFilter): Prisma.AuditLogWhereInput {
  return {
    ...(filter.action ? { action: filter.action } : {}),
    ...(filter.entityType ? { entityType: filter.entityType } : {}),
    ...(filter.actorId ? { actorId: filter.actorId } : {}),
    ...(filter.entityId
      ? { OR: [{ entityId: filter.entityId }, { relatedIds: { has: filter.entityId } }] }
      : {}),
    ...(filter.from || filter.to
      ? {
          occurredAt: {
            ...(filter.from ? { gte: filter.from } : {}),
            ...(filter.to ? { lte: filter.to } : {}),
          },
        }
      : {}),
  };
}

const NEWEST_FIRST = [
  { occurredAt: 'desc' },
  { id: 'desc' },
] satisfies Prisma.AuditLogOrderByWithRelationInput[];

@Injectable()
export class AuditLogService {
  constructor(
    private readonly db: TenantDb,
    private readonly prisma: PrismaService,
  ) {}

  /** The caller's tenant's audit log (row-level security scopes it). */
  list(ctx: TenantContext, query: PageQuery & AuditListFilter): Promise<Paginated<AuditLogDto>> {
    const where = whereFor(query);
    return this.db.run(ctx.tenantId, async (tx) => {
      const [entries, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy: NEWEST_FIRST, ...toSkipTake(query) }),
        tx.auditLog.count({ where }),
      ]);
      return new Paginated(
        entries.map((e) => toAuditLogDto(e, 'tenant')),
        total,
        query,
      );
    });
  }

  /**
   * Platform view of a tenant's organisation-level history (entries about the tenant record
   * itself). Tenant-internal activity is not exposed to platform operators.
   */
  async listForTenant(tenantId: string, query: PageQuery): Promise<Paginated<AuditLogDto>> {
    const where: Prisma.AuditLogWhereInput = { tenantId, entityType: 'tenant', entityId: tenantId };
    const [entries, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({ where, orderBy: NEWEST_FIRST, ...toSkipTake(query) }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new Paginated(
      entries.map((e) => toAuditLogDto(e, 'platform')),
      total,
      query,
    );
  }
}
