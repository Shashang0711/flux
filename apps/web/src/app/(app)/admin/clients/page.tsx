import type { Metadata } from 'next';
import Link from 'next/link';
import type { ClientSummaryDto, PageMeta } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Clients · FLUX' };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('client.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('client.manage');

  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
  const { data: clients, meta } = await loadOrNotFound<ClientSummaryDto[]>(`/clients?${query}`);

  return (
    <>
      <PageHeader
        title="Clients"
        description="Companies you test for, with their addresses, contacts and billing parties."
        actions={
          canManage && (
            <Link className="btn btn-primary" href="/admin/clients/new">
              New client
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
            placeholder="Search name, client ID or email"
            defaultValue={params.q}
            aria-label="Search clients"
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
            <option value="INACTIVE">Inactive</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Client ID</th>
                <th>Name</th>
                <th>Primary contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No clients found.
                  </td>
                </tr>
              )}
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <code>{client.code}</code>
                  </td>
                  <td>
                    <Link href={`/admin/clients/${client.id}`}>{client.name}</Link>
                    {client.tradingName && <span className="muted"> · {client.tradingName}</span>}
                  </td>
                  <td>{client.primaryContact?.name ?? <span className="muted">—</span>}</td>
                  <td>{client.email ?? <span className="muted">—</span>}</td>
                  <td>{client.phone ?? <span className="muted">—</span>}</td>
                  <td>
                    <StatusBadge status={client.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta as PageMeta} basePath="/admin/clients" params={params} />
      </div>
    </>
  );
}
