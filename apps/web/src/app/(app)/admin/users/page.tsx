import type { Metadata } from 'next';
import Link from 'next/link';
import type { PageMeta, UserDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
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
        <form className="row" role="search">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            name="q"
            placeholder="Search name or email"
            defaultValue={params.q}
            aria-label="Search users"
          />
          <select
            className="select"
            style={{ maxWidth: 180 }}
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th>Last sign-in</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">
                    No users found.
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr key={user.id}>
                  <td>
                    <Link href={`/admin/users/${user.id}`}>{user.name}</Link>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    {user.roles.map((r) => r.name).join(', ') || (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="muted">{formatDate(user.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta as PageMeta} basePath="/admin/users" params={params} />
      </div>
    </>
  );
}
