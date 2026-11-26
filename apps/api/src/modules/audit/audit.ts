import type { Prisma } from '@prisma/client';
import type {
  AuditAction,
  AuditChanges,
  AuditEntityType,
  FieldChange,
  ListChange,
} from '@flux/shared';
import type { AuthUser } from '../auth/auth.types';

/** Any Prisma transaction client: tenant-scoped (TenantDb) or system. */
type Tx = Prisma.TransactionClient;

export interface AuditEntry {
  /** Null for platform-level entries (invisible to tenants). */
  tenantId: string | null;
  /** Null for automated/system actions. */
  actor: AuthUser | null;
  action: AuditAction;
  entity: { type: AuditEntityType; id: string; label?: string | null };
  /** Other records affected, so they show this entry in their history too. */
  relatedIds?: string[];
  changes?: AuditChanges | null;
  /** Request details when there is no signed-in actor (e.g. a failed sign-in). */
  request?: { id?: string; ip?: string };
}

/**
 * Appends an audit entry using the caller's transaction, so the entry is committed if and
 * only if the change is. Never pass secrets (passwords, tokens, hashes) in `changes`.
 */
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  const { actor } = entry;
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      actorType: actor === null ? 'SYSTEM' : actor.isPlatformAdmin ? 'PLATFORM_ADMIN' : 'USER',
      actorId: actor?.id ?? null,
      actorName: actor?.name ?? null,
      actorEmail: actor?.email ?? null,
      action: entry.action,
      entityType: entry.entity.type,
      entityId: entry.entity.id,
      entityLabel: entry.entity.label ?? null,
      relatedIds: [...new Set(entry.relatedIds ?? [])].filter((id) => id !== entry.entity.id),
      changes: (entry.changes ?? undefined) as Prisma.InputJsonValue | undefined,
      requestId: (actor?.request ?? entry.request)?.id ?? null,
      ipAddress: (actor?.request ?? entry.request)?.ip ?? null,
    },
  });
}

function normalise(value: unknown): unknown {
  return value instanceof Date ? value.toISOString() : (value ?? null);
}

/** { field: {from, to} } for the listed fields whose values differ. */
export function fieldChanges<T extends object>(
  before: T | null,
  after: T,
  fields: readonly (keyof T & string)[],
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const field of fields) {
    const from = normalise(before?.[field]);
    const to = normalise(after[field]);
    if (from !== to) changes[field] = { from, to };
  }
  return changes;
}

/** {added, removed} between two lists, or undefined if they hold the same items. */
export function listChange(
  before: readonly string[],
  after: readonly string[],
): ListChange | undefined {
  const added = after.filter((v) => !before.includes(v));
  const removed = before.filter((v) => !after.includes(v));
  return added.length || removed.length ? { added, removed } : undefined;
}

/** Drops undefined entries; returns null when nothing changed. */
export function compactChanges(
  changes: Record<string, FieldChange | ListChange | undefined>,
): AuditChanges | null {
  const result: AuditChanges = {};
  for (const [key, value] of Object.entries(changes)) if (value) result[key] = value;
  return Object.keys(result).length > 0 ? result : null;
}
