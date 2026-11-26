import Link from 'next/link';
import type { PortalReportDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { DownloadButton } from '@/components/file-field';
import { FlagBadge } from '@/components/results';

/** Published reports (only the viewer's own samples are counted). */
export function ReportTable({
  reports,
  formatDate,
  empty = 'No reports found.',
}: {
  reports: PortalReportDto[];
  formatDate: (iso: string) => string;
  empty?: string;
}) {
  return (
    <DataTable
      label="Reports"
      rows={reports}
      rowKey={(r) => r.id}
      empty={empty}
      columns={[
        {
          header: 'Report',
          primary: true,
          cell: (r) => (
            <>
              <Link href={`/client/reports/${r.id}`}>
                <code>{r.code}</code>
              </Link>
              <span className="cell-sub">{r.serviceType.name}</span>
            </>
          ),
        },
        {
          header: 'Vessels',
          cell: (r) =>
            r.vessels.length > 0 ? r.vessels.join(', ') : <span className="muted">No vessel</span>,
        },
        { header: 'Samples', cell: (r) => r.sampleCount },
        { header: 'Published', cell: (r) => formatDate(r.publishedAt) },
        { header: 'Flag', cell: (r) => <FlagBadge flag={r.worstFlag} /> },
        {
          header: 'Actions',
          actions: true,
          cell: (r) => (
            <DownloadButton linkPath={`/portal/reports/${r.id}/download-link`} label="Download" />
          ),
        },
      ]}
    />
  );
}
