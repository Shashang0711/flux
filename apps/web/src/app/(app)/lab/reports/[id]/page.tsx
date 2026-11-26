import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuditLogDto, LabReportDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { DataTable } from '@/components/data-table';
import { EditDialog } from '@/components/edit-dialog';
import { DownloadButton } from '@/components/file-field';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { formatBytes } from '@/lib/files';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ReplaceFileForm, ReportStatusBadge } from '../report-forms';

export const metadata: Metadata = { title: 'Lab report · FLUX' };

export default async function LabReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('report.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const { data: report } = await loadOrNotFound<LabReportDto>(`/lab-reports/${id}`);
  const permissions = session.access.permissions;
  const canUpload = permissions.includes('report.upload') && report.status !== 'READY_TO_PUBLISH';
  const history = permissions.includes('audit.view')
    ? (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=20`)).data
    : null;

  return (
    <>
      <PageHeader
        title={`Lab report ${report.code}`}
        description={
          <span className="row">
            <ReportStatusBadge status={report.status} />
            <span>
              Batch <Link href={`/lab/batches/${report.batch.id}`}>{report.batch.code}</Link> ·{' '}
              {report.serviceType.name}
            </span>
          </span>
        }
        back={{ href: '/lab/reports', label: 'Lab reports' }}
        actions={
          <>
            <DownloadButton linkPath={`/lab-reports/${id}/download-link`} label="Download latest" />
            {canUpload && (
              <EditDialog title={`Replace ${report.code}`} label="Replace file">
                <ReplaceFileForm report={report} />
              </EditDialog>
            )}
          </>
        }
      />
      <div className="stack">
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
                <Link href={`/lab/samples/${s.id}`}>
                  <code>{s.code}</code>
                </Link>
              ),
            },
            { header: 'Vessel', cell: (s) => s.vessel ?? <span className="muted">No vessel</span> },
            { header: 'Client', cell: (s) => s.client },
          ]}
        />
        <DataTable
          label="Versions"
          rows={report.versions}
          rowKey={(v) => String(v.version)}
          empty="No versions."
          columns={[
            {
              header: 'Version',
              primary: true,
              cell: (v) => (
                <>
                  Version {v.version}
                  {v.version === report.currentVersion && <span className="cell-sub">Current</span>}
                </>
              ),
            },
            {
              header: 'File',
              cell: (v) => (
                <>
                  {v.file.name}
                  <span className="cell-sub">{formatBytes(v.file.size)}</span>
                </>
              ),
            },
            { header: 'Note', cell: (v) => v.note ?? '—' },
            {
              header: 'Uploaded',
              cell: (v) => (
                <>
                  {new Date(v.uploadedAt).toLocaleString('en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                  {v.uploadedBy && <span className="cell-sub">by {v.uploadedBy}</span>}
                </>
              ),
            },
            {
              header: 'Actions',
              actions: true,
              cell: (v) => (
                <DownloadButton
                  linkPath={`/lab-reports/${id}/versions/${v.version}/download-link`}
                />
              ),
            },
          ]}
        />
        {history && (
          <section className="card">
            <h2 className="card-title">History</h2>
            <AuditTable entries={history} showEntity={false} linkEntities={false} />
          </section>
        )}
      </div>
    </>
  );
}
