import type { Metadata } from 'next';
import Link from 'next/link';
import type { BatchSummaryDto, PageMeta, SampleSummaryDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { FlagBadge } from '@/components/results';
import { SampleStatusBadge } from '@/components/sample-status';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Under testing · FLUX' };

/** Under Testing (design pack §8): Batch View and Individual Sample View of open work. */
export default async function TestingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['view', 'q', 'page'] as const);
  const view = params.view === 'samples' ? 'samples' : 'batches';
  const query = new URLSearchParams({ open: 'true', pageSize: '25' });
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);

  return (
    <>
      <PageHeader
        title="Under testing"
        description="Registered samples whose results are not complete yet."
      />
      <ListTabs
        basePath="/lab/testing"
        param="view"
        active={view}
        tabs={[
          { key: 'batches', name: 'Batch view' },
          { key: 'samples', name: 'Sample view' },
        ]}
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input type="hidden" name="view" value={view} />
          <input
            className="input"
            name="q"
            placeholder={view === 'batches' ? 'Batch ID' : 'Sample, batch, kit, serial or vessel'}
            defaultValue={params.q}
            aria-label="Search"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        {view === 'batches' ? (
          <BatchView query={query} params={params} />
        ) : (
          <SampleView query={query} params={params} />
        )}
      </div>
    </>
  );
}

async function BatchView({
  query,
  params,
}: {
  query: URLSearchParams;
  params: Record<string, string | undefined>;
}) {
  const { data: batches, meta } = await loadOrNotFound<BatchSummaryDto[]>(
    `/samples/batches?${query}`,
  );
  return (
    <>
      <DataTable
        label="Batches under testing"
        rows={batches}
        rowKey={(b) => b.id}
        empty="No batches are waiting for results."
        columns={[
          {
            header: 'Batch',
            primary: true,
            cell: (b) => (
              <>
                <Link href={`/lab/batches/${b.id}/results`}>
                  <code>{b.code}</code>
                </Link>
                <span className="cell-sub">{b.serviceType.name}</span>
              </>
            ),
          },
          { header: 'Registered', cell: (b) => b.statusCounts.REGISTERED },
          { header: 'Under testing', cell: (b) => b.statusCounts.UNDER_TESTING },
          {
            header: 'Results entered',
            cell: (b) => `${b.statusCounts.RESULTS_ENTERED} of ${b.sampleCount}`,
          },
          {
            header: 'Actions',
            actions: true,
            cell: (b) => (
              <Link className="btn" href={`/lab/batches/${b.id}/results`}>
                Enter results
              </Link>
            ),
          },
        ]}
      />
      <Pagination
        meta={meta as PageMeta}
        basePath="/lab/testing"
        params={{ ...params, view: 'batches' }}
      />
    </>
  );
}

async function SampleView({
  query,
  params,
}: {
  query: URLSearchParams;
  params: Record<string, string | undefined>;
}) {
  const { data: samples, meta } = await loadOrNotFound<SampleSummaryDto[]>(`/samples?${query}`);
  return (
    <>
      <DataTable
        label="Samples under testing"
        rows={samples}
        rowKey={(s) => s.id}
        empty="No samples are waiting for results."
        columns={[
          {
            header: 'Sample',
            primary: true,
            cell: (s) => (
              <>
                <Link href={`/lab/samples/${s.id}#results`}>
                  <code>{s.code}</code>
                </Link>
                <span className="cell-sub">Batch {s.batch.code}</span>
              </>
            ),
          },
          { header: 'Service type', cell: (s) => s.serviceType.name },
          {
            header: 'Vessel',
            cell: (s) => s.vessel?.name ?? <span className="muted">No vessel</span>,
          },
          {
            header: 'Status',
            cell: (s) => <SampleStatusBadge status={s.status} colour={s.colour} />,
          },
          { header: 'Flag', cell: (s) => <FlagBadge flag={s.worstFlag} /> },
        ]}
      />
      <Pagination
        meta={meta as PageMeta}
        basePath="/lab/testing"
        params={{ ...params, view: 'samples' }}
      />
    </>
  );
}
