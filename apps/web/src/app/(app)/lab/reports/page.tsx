import type { Metadata } from 'next';
import type { LabReportSummaryDto, PageMeta } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ReportTable } from './report-forms';

export const metadata: Metadata = { title: 'Lab reports · FLUX' };

export default async function LabReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('report.view');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const { data: reports, meta } = await loadOrNotFound<LabReportSummaryDto[]>(
    `/lab-reports?${query}`,
  );
  return (
    <>
      <PageHeader
        title="Lab reports"
        description="Reports uploaded by the lab. Upload them from a batch once its results are complete."
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Report, batch or sample ID"
            defaultValue={params.q}
            aria-label="Search reports"
          />
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="SUBMITTED">Awaiting review</option>
            <option value="REJECTED">Rejected</option>
            <option value="READY_TO_PUBLISH">Ready to publish</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <ReportTable reports={reports} />
        <Pagination meta={meta as PageMeta} basePath="/lab/reports" params={params} />
      </div>
    </>
  );
}
