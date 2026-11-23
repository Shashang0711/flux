import { z } from 'zod';

/** Every audited action and its label. Keys are stored: add or retire, never rename. */
export const AUDIT_ACTIONS = {
  'tenant.created': 'Organisation created',
  'tenant.updated': 'Organisation updated',
  'tenant.suspended': 'Organisation suspended',
  'tenant.reactivated': 'Organisation reactivated',
  'tenant.modules_changed': 'Licensed modules changed',
  'user.created': 'User created',
  'user.updated': 'User updated',
  'user.disabled': 'User disabled',
  'user.enabled': 'User enabled',
  'user.roles_changed': 'User roles changed',
  'user.password_reset': 'Password reset by administrator',
  'user.password_changed': 'Password changed',
  'role.created': 'Role created',
  'role.cloned': 'Role cloned',
  'role.updated': 'Role updated',
  'role.activated': 'Role activated',
  'role.deactivated': 'Role deactivated',
  'role.portals_changed': 'Portal access changed',
  'role.modules_changed': 'Module access changed',
  'role.permissions_changed': 'Role permissions changed',
  'role.users_assigned': 'Users assigned to role',
  'role.user_unassigned': 'User removed from role',
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;
export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTIONS) as [AuditAction, ...AuditAction[]];

export const AUDIT_ENTITY_TYPES = ['tenant', 'user', 'role'] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/** A scalar field that changed (from is null on creation). */
export interface FieldChange {
  from: unknown;
  to: unknown;
}

/** Items added to or removed from a list (roles, permissions, modules, users…). */
export interface ListChange {
  added: string[];
  removed: string[];
}

/** What changed, per field: e.g. { name: {from, to}, permissions: {added, removed} }. */
export type AuditChanges = Record<string, FieldChange | ListChange>;

export function isListChange(change: FieldChange | ListChange): change is ListChange {
  return 'added' in change;
}

export interface AuditLogDto {
  id: string;
  occurredAt: string;
  actor: {
    type: 'USER' | 'PLATFORM_ADMIN' | 'SYSTEM';
    id: string | null;
    /** For platform actions seen by a tenant this is "FLUX platform". */
    name: string | null;
    email: string | null;
  };
  action: AuditAction;
  entity: { type: AuditEntityType; id: string; label: string | null };
  changes: AuditChanges | null;
  requestId: string | null;
}

export const auditListFilterSchema = z.object({
  action: z.enum(AUDIT_ACTION_KEYS).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  /** History of one record: entries about it or affecting it. */
  entityId: z.uuid().optional(),
  actorId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type AuditListFilter = z.infer<typeof auditListFilterSchema>;

export function auditActionLabel(action: string): string {
  return (AUDIT_ACTIONS as Record<string, string>)[action] ?? action;
}
