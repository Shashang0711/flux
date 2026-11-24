import type { Metadata } from 'next';
import Link from 'next/link';
import type { PageMeta, UserDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Users · FLUX' };

function formatDate(value: string | null): string {
  return value
    ? new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
    : 'Never';
}

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('user.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('user.manage');

  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', params.page);
  const { data: users, meta } = await loadOrNotFound<UserDto[]>(`/users?${query}`);

  return (
    <>
      <PageHeader
        title="Users"
        description={`People who can sign in to ${session.tenant?.name ?? 'your organisation'}.`}
        actions={
          canManage && (
            <Link className="btn btn-primary" href="/admin/users/new">
              New user
            </Link>
          )
        }
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Search name or email"
            defaultValue={params.q}
            aria-label="Search users"
          />
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DISABLED">Disabled</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Users"
          rows={users}
          rowKey={(u) => u.id}
          empty="No users found."
          columns={[
            {
              header: 'Name',
              primary: true,
              cell: (u) => <Link href={`/admin/users/${u.id}`}>{u.name}</Link>,
            },
            { header: 'Email', cell: (u) => u.email },
            {
              header: 'Roles',
              cell: (u) =>
                u.roles.map((r) => r.name).join(', ') || <span className="muted">None</span>,
            },
            { header: 'Status', cell: (u) => <StatusBadge status={u.status} /> },
            {
              header: 'Last sign-in',
              cell: (u) => <span className="muted">{formatDate(u.lastLoginAt)}</span>,
            },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/admin/users" params={params} />
      </div>
    </>
  );
}
