import type { Metadata } from 'next';
import Link from 'next/link';
import type { ClientSummaryDto, PageMeta } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
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
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Search name, client ID or email"
            defaultValue={params.q}
            aria-label="Search clients"
          />
          <select
            className="select"
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
        <DataTable
          label="Clients"
          rows={clients}
          rowKey={(c) => c.id}
          empty="No clients found."
          columns={[
            {
              header: 'Client',
              primary: true,
              cell: (c) => (
                <>
                  <Link href={`/admin/clients/${c.id}`}>{c.name}</Link>
                  <span className="cell-sub">
                    <code>{c.code}</code>
                    {c.tradingName && <> · {c.tradingName}</>}
                  </span>
                </>
              ),
            },
            {
              header: 'Primary contact',
              cell: (c) => c.primaryContact?.name ?? <span className="muted">—</span>,
            },
            { header: 'Email', cell: (c) => c.email ?? <span className="muted">—</span> },
            { header: 'Phone', cell: (c) => c.phone ?? <span className="muted">—</span> },
            { header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/admin/clients" params={params} />
      </div>
    </>
  );
}
