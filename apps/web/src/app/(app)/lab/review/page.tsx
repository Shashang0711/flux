import type { Metadata } from 'next';
import type { LabReportSummaryDto, PageMeta } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ReportTable } from '../reports/report-forms';

export const metadata: Metadata = { title: 'Report review · FLUX' };

/** Admin Review (design pack §8): lab reports awaiting a decision, oldest first. */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('report.review');
  if (!allowed) return <Forbidden />;
  const params = readParams(await searchParams, ['q', 'page'] as const);
  const query = new URLSearchParams({ status: 'SUBMITTED', pageSize: '25' });
  if (params.q) query.set('q', params.q);
  if (params.page) query.set('page', params.page);
  const { data: reports, meta } = await loadOrNotFound<LabReportSummaryDto[]>(
    `/lab-reports?${query}`,
  );
  return (
    <>
      <PageHeader
        title="Report review"
        description="Lab reports awaiting review. Open one to download it, reject it with a comment or mark it ready to publish."
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
        <ReportTable reports={reports} empty="Nothing to review." />
        <Pagination meta={meta as PageMeta} basePath="/lab/review" params={params} />
      </div>
    </>
  );
}
