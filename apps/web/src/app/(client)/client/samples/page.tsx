import type { Metadata } from 'next';
import Link from 'next/link';
import {
  PORTAL_SAMPLE_STATUSES,
  type PageMeta,
  type PortalOptionsDto,
  type PortalSampleDto,
} from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { FlagBadge } from '@/components/results';
import { loadOrNotFound } from '@/lib/server-api';
import { PortalStatusBadge, dateFormatter } from '../portal-ui';

export const metadata: Metadata = { title: 'Samples · Client portal · FLUX' };

export default async function ClientSamplesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = readParams(await searchParams, [
    'q',
    'status',
    'vesselId',
    'serviceTypeId',
    'page',
  ] as const);
  const query = new URLSearchParams({ pageSize: '25' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const [{ data: samples, meta }, { data: options }] = await Promise.all([
    loadOrNotFound<PortalSampleDto[]>(`/portal/samples?${query}`),
    loadOrNotFound<PortalOptionsDto>('/portal/options'),
  ]);
  const formatDate = await dateFormatter();
  return (
    <>
      <PageHeader
        title="Samples"
        description="Every sample the laboratory has received for you, newest first. Results appear once the report is published."
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Sample, kit ID, serial or vessel"
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
            {PORTAL_SAMPLE_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
          {options.vessels.length > 0 && (
            <select
              className="select"
              name="vesselId"
              defaultValue={params.vesselId ?? ''}
              aria-label="Vessel"
            >
              <option value="">All vessels</option>
              {options.vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          )}
          {options.serviceTypes.length > 1 && (
            <select
              className="select"
              name="serviceTypeId"
              defaultValue={params.serviceTypeId ?? ''}
              aria-label="Service type"
            >
              <option value="">All service types</option>
              {options.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
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
                  <Link href={`/client/samples/${s.id}`}>
                    <code>{s.code}</code>
                  </Link>
                  <span className="cell-sub">
                    Kit {s.kit.code}
                    {s.kit.serialNumber && ` · Serial ${s.kit.serialNumber}`}
                  </span>
                </>
              ),
            },
            {
              header: 'Vessel',
              cell: (s) => s.vessel?.name ?? <span className="muted">No vessel</span>,
            },
            { header: 'Service type', cell: (s) => s.serviceType.name },
            { header: 'Received', cell: (s) => formatDate(s.registeredAt) },
            { header: 'Status', cell: (s) => <PortalStatusBadge status={s.status} /> },
            {
              header: 'Report',
              cell: (s) =>
                s.report ? (
                  <>
                    <Link href={`/client/reports/${s.report.id}`}>{s.report.code}</Link>{' '}
                    <FlagBadge flag={s.worstFlag} />
                  </>
                ) : (
                  <span className="muted">—</span>
                ),
            },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/client/samples" params={params} />
      </div>
    </>
  );
}
