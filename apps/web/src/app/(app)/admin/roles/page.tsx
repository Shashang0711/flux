import type { Metadata } from 'next';
import Link from 'next/link';
import { PORTALS, type PageMeta, type RoleSummaryDto } from '@flux/shared';
import { ActiveBadge, Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Roles · FLUX' };

export default async function RolesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('role.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('role.manage');

  const params = readParams(await searchParams, ['q', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);
  const { data: roles, meta } = await loadOrNotFound<RoleSummaryDto[]>(`/roles?${query}`);

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles decide which portals, modules and actions your users can access."
        actions={
          canManage && (
            <Link className="btn btn-primary" href="/admin/roles/new">
              New role
            </Link>
          )
        }
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Search roles"
            defaultValue={params.q}
            aria-label="Search roles"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <DataTable
          label="Roles"
          rows={roles}
          rowKey={(r) => r.id}
          empty="No roles found."
          columns={[
            {
              header: 'Role',
              primary: true,
              cell: (r) => (
                <>
                  <span className="row">
                    <Link href={`/admin/roles/${r.id}`}>{r.name}</Link>
                    {r.isSystem && <Badge tone="brand">Built-in</Badge>}
                  </span>
                  {r.description && <span className="cell-sub">{r.description}</span>}
                </>
              ),
            },
            {
              header: 'Default portal',
              cell: (r) => PORTALS.find((p) => p.key === r.defaultPortal)?.name,
            },
            { header: 'Users', cell: (r) => r.userCount },
            { header: 'Status', cell: (r) => <ActiveBadge active={r.isActive} /> },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/admin/roles" params={params} />
      </div>
    </>
  );
}
