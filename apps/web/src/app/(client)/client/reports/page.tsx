import type { Metadata } from 'next';
import type { PageMeta, PortalOptionsDto, PortalReportDto } from '@flux/shared';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound } from '@/lib/server-api';
import { dateFormatter } from '../portal-ui';
import { ReportTable } from '../report-table';

export const metadata: Metadata = { title: 'Reports · Client portal · FLUX' };

export default async function ClientReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = readParams(await searchParams, ['q', 'vesselId', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '25' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const [{ data: reports, meta }, { data: options }] = await Promise.all([
    loadOrNotFound<PortalReportDto[]>(`/portal/reports?${query}`),
    loadOrNotFound<PortalOptionsDto>('/portal/options'),
  ]);
  const formatDate = await dateFormatter();
  return (
    <>
      <PageHeader title="Reports" description="Published reports, newest first." />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Report number"
            defaultValue={params.q}
            aria-label="Search reports"
          />
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
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <ReportTable reports={reports} formatDate={formatDate} />
        <Pagination meta={meta as PageMeta} basePath="/client/reports" params={params} />
      </div>
    </>
  );
}
