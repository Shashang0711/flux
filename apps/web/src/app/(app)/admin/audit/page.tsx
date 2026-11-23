import type { Metadata } from 'next';
import { AUDIT_ACTIONS, type AuditLogDto, type PageMeta } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Audit log · FLUX' };

const ENTITY_TYPES = [
  { value: 'user', label: 'Users' },
  { value: 'role', label: 'Roles' },
  { value: 'tenant', label: 'Organisation' },
];

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('audit.view');
  if (!allowed) return <Forbidden />;

  const params = readParams(await searchParams, [
    'action',
    'entityType',
    'entityId',
    'page',
  ] as const);
  const query = new URLSearchParams({ pageSize: '50' });
  Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
  const { data: entries, meta } = await loadOrNotFound<AuditLogDto[]>(`/audit-logs?${query}`);

  return (
    <>
      <PageHeader
        title="Audit log"
        description={`Every change to users, roles and ${session.tenant?.name ?? 'your organisation'}. Entries cannot be edited or deleted.`}
      />
      <div className="stack">
        <form className="row" role="search">
          <select
            className="select"
            style={{ maxWidth: 260 }}
            name="action"
            defaultValue={params.action ?? ''}
            aria-label="Action"
          >
            <option value="">All actions</option>
            {Object.entries(AUDIT_ACTIONS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            className="select"
            style={{ maxWidth: 200 }}
            name="entityType"
            defaultValue={params.entityType ?? ''}
            aria-label="Record type"
          >
            <option value="">All records</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {params.entityId && <input type="hidden" name="entityId" value={params.entityId} />}
          <button className="btn" type="submit">
            Filter
          </button>
          {params.entityId && (
            <a className="btn" href="/admin/audit">
              Show all records
            </a>
          )}
        </form>
        <AuditTable entries={entries} />
        <Pagination meta={meta as PageMeta} basePath="/admin/audit" params={params} />
      </div>
    </>
  );
}
