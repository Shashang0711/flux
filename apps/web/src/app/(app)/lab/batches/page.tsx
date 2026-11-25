import type { Metadata } from 'next';
import Link from 'next/link';
import type { BatchSummaryDto, PageMeta } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Batches · FLUX' };

export default async function BatchesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['q', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const { data: batches, meta } = await loadOrNotFound<BatchSummaryDto[]>(
    `/samples/batches?${query}`,
  );
  return (
    <>
      <PageHeader
        title="Batches"
        description="Registered batches. Register new ones from the registration queue."
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Batch ID"
            defaultValue={params.q}
            aria-label="Search batches"
          />
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <DataTable
          label="Batches"
          rows={batches}
          rowKey={(b) => b.id}
          empty="No batches registered yet."
          columns={[
            {
              header: 'Batch',
              primary: true,
              cell: (b) => (
                <Link href={`/lab/batches/${b.id}`}>
                  <code>{b.code}</code>
                </Link>
              ),
            },
            { header: 'Service type', cell: (b) => b.serviceType.name },
            { header: 'Samples', cell: (b) => b.sampleCount },
            {
              header: 'Registered',
              cell: (b) => (
                <>
                  {new Date(b.registeredAt).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {b.registeredBy && <span className="cell-sub">by {b.registeredBy}</span>}
                </>
              ),
            },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/lab/batches" params={params} />
      </div>
    </>
  );
}
