import Link from 'next/link';
import { auditActionLabel, isListChange, type AuditLogDto } from '@flux/shared';
import styles from './audit-table.module.css';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  status: 'Status',
  slug: 'Slug',
  description: 'Description',
  defaultPortal: 'Default portal',
  isActive: 'Active',
  roles: 'Roles',
  users: 'Users',
  portals: 'Portals',
  modules: 'Modules',
  permissions: 'Permissions',
  clonedFrom: 'Cloned from',
  code: 'Code',
  sortOrder: 'Sort order',
  tradingName: 'Trading name',
  phone: 'Phone',
  website: 'Website',
  taxNumber: 'Tax number',
  notes: 'Notes',
  type: 'Type',
  label: 'Label',
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  region: 'Region',
  postalCode: 'Postal code',
  country: 'Country',
  jobTitle: 'Job title',
  isPrimary: 'Primary',
  isDefault: 'Default',
  contact: 'Contact',
  address: 'Address',
  billingParty: 'Billing party',
  key: 'Key',
  required: 'Required',
  helpText: 'Help text',
  options: 'Options',
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function Changes({ entry }: { entry: AuditLogDto }) {
  if (!entry.changes) return <span className="muted">—</span>;
  return (
    <ul className={styles.changes}>
      {Object.entries(entry.changes).map(([field, change]) => (
        <li key={field}>
          <span className={styles.field}>{FIELD_LABELS[field] ?? field}:</span>{' '}
          {isListChange(change) ? (
            <>
              {change.added.length > 0 && (
                <span className={styles.added}>+ {change.added.join(', ')}</span>
              )}
              {change.added.length > 0 && change.removed.length > 0 && ' '}
              {change.removed.length > 0 && (
                <span className={styles.removed}>− {change.removed.join(', ')}</span>
              )}
            </>
          ) : change.from === null ? (
            show(change.to)
          ) : (
            <>
              {show(change.from)} → {show(change.to)}
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Where an entity lives in the tenant admin UI, if it has a page. */
function entityHref(entry: AuditLogDto): string | null {
  if (entry.entity.type === 'user') return `/admin/users/${entry.entity.id}`;
  if (entry.entity.type === 'role') return `/admin/roles/${entry.entity.id}`;
  if (entry.entity.type === 'client') return `/admin/clients/${entry.entity.id}`;
  return null;
}

export function AuditTable({
  entries,
  showEntity = true,
  linkEntities = true,
}: {
  entries: AuditLogDto[];
  showEntity?: boolean;
  linkEntities?: boolean;
}) {
  if (entries.length === 0) return <p className="muted">No activity recorded yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>What</th>
            {showEntity && <th>Record</th>}
            <th>Changes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const href = linkEntities ? entityHref(entry) : null;
            return (
              <tr key={entry.id}>
                <td className={styles.when}>
                  <time dateTime={entry.occurredAt}>
                    {new Date(entry.occurredAt).toLocaleString('en-GB', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </time>
                </td>
                <td>
                  {entry.actor.name ?? 'System'}
                  {entry.actor.email && <span className={styles.sub}>{entry.actor.email}</span>}
                </td>
                <td>{auditActionLabel(entry.action)}</td>
                {showEntity && (
                  <td>
                    {href ? (
                      <Link href={href}>{entry.entity.label ?? 'Open'}</Link>
                    ) : (
                      (entry.entity.label ?? '—')
                    )}
                    <span className={styles.sub}>{entry.entity.type}</span>
                  </td>
                )}
                <td>
                  <Changes entry={entry} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
