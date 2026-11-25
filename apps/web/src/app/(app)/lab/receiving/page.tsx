import type { Metadata } from 'next';
import Link from 'next/link';
import type { AirwayBillSummaryDto, PageMeta } from '@flux/shared';
import { Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Receiving · FLUX' };

export default async function ReceivingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('receiving.view');
  if (!allowed) return <Forbidden />;
  const canReceive = session.access.permissions.includes('receiving.receive');
  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const { data: bills, meta } = await loadOrNotFound<AirwayBillSummaryDto[]>(
    `/receiving/airway-bills?${query}`,
  );

  return (
    <>
      <PageHeader
        title="Receiving"
        description="Airway bills and the kits received under them. Received kits wait in the registration queue."
        actions={
          canReceive && (
            <Link className="btn btn-primary" href="/lab/receiving/new">
              New airway bill
            </Link>
          )
        }
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="AWB number, courier or origin"
            defaultValue={params.q}
            aria-label="Search airway bills"
          />
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Airway bills"
          rows={bills}
          rowKey={(b) => b.id}
          empty="No airway bills yet."
          columns={[
            {
              header: 'AWB',
              primary: true,
              cell: (b) => (
                <>
                  <Link href={`/lab/receiving/${b.id}`}>{b.number}</Link>
                  {(b.courier || b.origin) && (
                    <span className="cell-sub">
                      {[b.courier, b.origin].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </>
              ),
            },
            { header: 'Received', cell: (b) => b.receivedOn },
            {
              header: 'Kits',
              cell: (b) => (
                <>
                  {b.kitCount}
                  {b.pendingCount > 0 && (
                    <span className="cell-sub">{b.pendingCount} awaiting registration</span>
                  )}
                </>
              ),
            },
            {
              header: 'Status',
              cell: (b) =>
                b.status === 'OPEN' ? <Badge tone="brand">Open</Badge> : <Badge>Closed</Badge>,
            },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/lab/receiving" params={params} />
      </div>
    </>
  );
}
