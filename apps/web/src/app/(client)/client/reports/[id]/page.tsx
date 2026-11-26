import type { Metadata } from 'next';
import Link from 'next/link';
import type { PortalReportDetailDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { DownloadButton } from '@/components/file-field';
import { PageHeader } from '@/components/page-header';
import { FlagBadge } from '@/components/results';
import { loadOrNotFound } from '@/lib/server-api';
import { dateFormatter } from '../../portal-ui';

export const metadata: Metadata = { title: 'Report · Client portal · FLUX' };

export default async function ClientReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: report } = await loadOrNotFound<PortalReportDetailDto>(`/portal/reports/${id}`);
  const formatDate = await dateFormatter();
  return (
    <>
      <PageHeader
        title={report.code}
        description={`${report.serviceType.name} · published ${formatDate(report.publishedAt)}`}
        back={{ href: '/client/reports', label: 'Reports' }}
        actions={
          <DownloadButton
            linkPath={`/portal/reports/${report.id}/download-link`}
            label="Download report (PDF)"
          />
        }
      />
      <DataTable
        label="Samples in this report"
        rows={report.samples}
        rowKey={(s) => s.id}
        empty="No samples."
        columns={[
          {
            header: 'Sample',
            primary: true,
            cell: (s) => (
              <>
                <Link href={`/client/samples/${s.id}`}>
                  <code>{s.code}</code>
                </Link>
                <span className="cell-sub">Kit {s.kit.code}</span>
              </>
            ),
          },
          {
            header: 'Vessel',
            cell: (s) => s.vessel?.name ?? <span className="muted">No vessel</span>,
          },
          { header: 'Received', cell: (s) => formatDate(s.registeredAt) },
          { header: 'Flag', cell: (s) => <FlagBadge flag={s.worstFlag} /> },
        ]}
      />
    </>
  );
}
