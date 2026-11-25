import type { Metadata } from 'next';
import Link from 'next/link';
import type { PageMeta, SampleSummaryDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { FlagBadge } from '@/components/results';
import { SampleStatusBadge } from '@/components/sample-status';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Samples · FLUX' };

export default async function SamplesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '25' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const { data: samples, meta } = await loadOrNotFound<SampleSummaryDto[]>(`/samples?${query}`);
  return (
    <>
      <PageHeader title="Samples" description="Every registered sample, newest first." />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Sample, batch, kit ID, serial or vessel"
            defaultValue={params.q}
            aria-label="Search samples"
          />
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="REGISTERED">Registered</option>
            <option value="UNDER_TESTING">Under testing</option>
            <option value="RESULTS_ENTERED">Results entered</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Samples"
          rows={samples}
          rowKey={(s) => s.id}
          empty="No samples found."
          columns={[
            {
              header: 'Sample',
              primary: true,
              cell: (s) => (
                <>
                  <Link href={`/lab/samples/${s.id}`}>
                    <code>{s.code}</code>
                  </Link>
                  <span className="cell-sub">
                    Batch <Link href={`/lab/batches/${s.batch.id}`}>{s.batch.code}</Link>
                  </span>
                </>
              ),
            },
            { header: 'Service type', cell: (s) => s.serviceType.name },
            {
              header: 'Vessel / client',
              cell: (s) => (
                <>
                  {s.vessel?.name ?? <span className="muted">No vessel</span>}
                  <span className="cell-sub">{s.client.name}</span>
                </>
              ),
            },
            {
              header: 'Kit',
              cell: (s) => (
                <>
                  {s.kit.code}
                  {s.kit.serialNumber && (
                    <span className="cell-sub">Serial {s.kit.serialNumber}</span>
                  )}
                </>
              ),
            },
            {
              header: 'Status',
              cell: (s) => <SampleStatusBadge status={s.status} colour={s.colour} />,
            },
            { header: 'Flag', cell: (s) => <FlagBadge flag={s.worstFlag} /> },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/lab/samples" params={params} />
      </div>
    </>
  );
}
