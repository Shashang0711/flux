import type { Metadata } from 'next';
import Link from 'next/link';
import { PORTALS, type PageMeta, type RoleSummaryDto } from '@flux/shared';
import { ActiveBadge, Badge } from '@/components/badges';
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
        <form className="row" role="search">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            name="q"
            placeholder="Search roles"
            defaultValue={params.q}
            aria-label="Search roles"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Default portal</th>
                <th>Users</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {roles.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No roles found.
                  </td>
                </tr>
              )}
              {roles.map((role) => (
                <tr key={role.id}>
                  <td>
                    <span className="row">
                      <Link href={`/admin/roles/${role.id}`}>{role.name}</Link>
                      {role.isSystem && <Badge tone="brand">Built-in</Badge>}
                    </span>
                    {role.description && <span className="muted">{role.description}</span>}
                  </td>
                  <td>{PORTALS.find((p) => p.key === role.defaultPortal)?.name}</td>
                  <td>{role.userCount}</td>
                  <td>
                    <ActiveBadge active={role.isActive} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta as PageMeta} basePath="/admin/roles" params={params} />
      </div>
    </>
  );
}
