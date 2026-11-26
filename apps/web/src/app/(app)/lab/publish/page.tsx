import type { Metadata } from 'next';
import type { LabReportSummaryDto, PageMeta } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ReportTable } from '../reports/report-forms';

export const metadata: Metadata = { title: 'Publish · FLUX' };

/** Publish page (design pack §8): only reports marked ready to publish. */
export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('report.publish');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['q', 'page'] as const);
  const query = new URLSearchParams({ status: 'READY_TO_PUBLISH', pageSize: '25' });
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);
  const { data: reports, meta } = await loadOrNotFound<LabReportSummaryDto[]>(
    `/lab-reports?${query}`,
  );
  return (
    <>
      <PageHeader
        title="Publish"
        description="Reports marked ready to publish. Open one to upload the final report and publish it."
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
          <button className="btn" type="submit">
            Search
          </button>
        </form>
        <ReportTable reports={reports} empty="Nothing is ready to publish." />
        <Pagination meta={meta as PageMeta} basePath="/lab/publish" params={params} />
      </div>
    </>
  );
}
