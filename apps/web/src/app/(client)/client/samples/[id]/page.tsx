import type { Metadata } from 'next';
import Link from 'next/link';
import type { PortalSampleDetailDto } from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { DownloadButton } from '@/components/file-field';
import { PageHeader } from '@/components/page-header';
import { FlagBadge } from '@/components/results';
import { loadOrNotFound } from '@/lib/server-api';
import { PortalStatusBadge, dateFormatter } from '../../portal-ui';

export const metadata: Metadata = { title: 'Sample · Client portal · FLUX' };

export default async function ClientSamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data: sample } = await loadOrNotFound<PortalSampleDetailDto>(`/portal/samples/${id}`);
  const formatDate = await dateFormatter();
  return (
    <>
      <PageHeader
        title={sample.code}
        description={
          <span className="row">
            <PortalStatusBadge status={sample.status} />
            <span>{sample.serviceType.name}</span>
          </span>
        }
        back={{ href: '/client/samples', label: 'Samples' }}
      />
      <div className="stack">
        <section className="card">
          <h2 className="card-title">Details</h2>
          <dl className="grid-2" style={{ margin: 0 }}>
            <div>
              <dt className="muted">Vessel</dt>
              <dd style={{ margin: 0 }}>
                {sample.vessel
                  ? `${sample.vessel.name}${sample.vessel.imoNumber ? ` · IMO ${sample.vessel.imoNumber}` : ''}`
                  : 'No vessel'}
              </dd>
            </div>
            <div>
              <dt className="muted">Kit</dt>
              <dd style={{ margin: 0 }}>
                {sample.kit.code}
                {sample.kit.serialNumber && ` · Serial ${sample.kit.serialNumber}`}
              </dd>
            </div>
            <div>
              <dt className="muted">Received</dt>
              <dd style={{ margin: 0 }}>{formatDate(sample.registeredAt)}</dd>
            </div>
            <div>
              <dt className="muted">Report</dt>
              <dd style={{ margin: 0 }}>
                {sample.report ? (
                  <>
                    <Link href={`/client/reports/${sample.report.id}`}>{sample.report.code}</Link>,
                    published {formatDate(sample.report.publishedAt)}
                  </>
                ) : (
                  'Not published yet'
                )}
              </dd>
            </div>
          </dl>
          {sample.report && (
            <div className="form-actions" style={{ justifyContent: 'flex-start' }}>
              <DownloadButton
                linkPath={`/portal/reports/${sample.report.id}/download-link`}
                label="Download report (PDF)"
              />
            </div>
          )}
        </section>
        <section className="stack" aria-labelledby="results-title">
          <h2 id="results-title" className="card-title" style={{ margin: 0 }}>
            Results
          </h2>
          {sample.results ? (
            <DataTable
              label="Results"
              rows={sample.results}
              rowKey={(r) => r.parameter}
              empty="No result values were recorded for this sample. See the report."
              columns={[
                {
                  header: 'Parameter',
                  primary: true,
                  cell: (r) => (
                    <>
                      {r.parameter}
                      {r.method && <span className="cell-sub">{r.method}</span>}
                    </>
                  ),
                },
                {
                  header: 'Result',
                  cell: (r) => (
                    <>
                      {r.value}
                      {r.unit && <span className="muted"> {r.unit}</span>}
                    </>
                  ),
                },
                { header: 'Flag', cell: (r) => <FlagBadge flag={r.flag} /> },
              ]}
            />
          ) : (
            <p className="card muted" style={{ margin: 0 }}>
              Results appear here once the laboratory publishes the report.
            </p>
          )}
        </section>
      </div>
    </>
  );
}
