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
import { ReviewPanel } from '../review-panel';

export const metadata: Metadata = { title: 'Lab report · FLUX' };

export default async function LabReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('report.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const { data: report } = await loadOrNotFound<LabReportDto>(`/lab-reports/${id}`);
  const permissions = session.access.permissions;
  const canUpload = permissions.includes('report.upload') && report.status !== 'READY_TO_PUBLISH';
  const canReview = permissions.includes('report.review');
  const lastRejection = report.reviews.find((r) => r.decision === 'REJECTED');
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
        {report.status === 'REJECTED' && lastRejection && (
          <div className="alert alert-error" role="status">
            <strong>Rejected</strong> by {lastRejection.reviewer ?? 'a reviewer'} on{' '}
            {new Date(lastRejection.decidedAt).toLocaleString('en-GB', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            :<p style={{ margin: '6px 0' }}>{lastRejection.comment}</p>
            Correct the results of the samples if needed (their results can be reopened now), then
            use <em>Replace file</em> to upload the corrected report.
          </div>
        )}
        {canReview && (report.status === 'SUBMITTED' || report.status === 'READY_TO_PUBLISH') && (
          <section className="card" aria-label="Review">
            <h2 className="card-title">Review</h2>
            <ReviewPanel report={report} userId={session.user.id} />
          </section>
        )}
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
        {report.reviews.length > 0 && (
          <DataTable
            label="Review history"
            rows={report.reviews}
            rowKey={(r) => r.decidedAt}
            empty="No reviews yet."
            columns={[
              {
                header: 'Decision',
                primary: true,
                cell: (r) =>
                  r.decision === 'REJECTED'
                    ? 'Rejected'
                    : r.decision === 'READY_TO_PUBLISH'
                      ? 'Ready to publish'
                      : 'Sent back to review',
              },
              { header: 'Version', cell: (r) => r.version },
              { header: 'Comment', cell: (r) => r.comment ?? '—' },
              {
                header: 'Reviewer',
                cell: (r) => (
                  <>
                    {r.reviewer ?? '—'}
                    <span className="cell-sub">
                      {new Date(r.decidedAt).toLocaleString('en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                    </span>
                  </>
                ),
              },
            ]}
          />
        )}
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
