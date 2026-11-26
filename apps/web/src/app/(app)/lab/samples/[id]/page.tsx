import type { Metadata } from 'next';
import Link from 'next/link';
import type { SampleAttachmentDto, SampleDto, SampleResultsDto } from '@flux/shared';
import { FieldValues } from '@/components/field-values';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { SampleStatusBadge } from '@/components/sample-status';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { FlagBadge } from '@/components/results';
import { SampleAttachments } from './sample-attachments';
import { SampleResults } from './sample-results';

export const metadata: Metadata = { title: 'Sample · FLUX' };

export default async function SamplePage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const [{ data: s }, { data: results }, { data: attachments }] = await Promise.all([
    loadOrNotFound<SampleDto>(`/samples/${id}`),
    loadOrNotFound<SampleResultsDto>(`/samples/${id}/results`),
    loadOrNotFound<SampleAttachmentDto[]>(`/samples/${id}/attachments`),
  ]);
  const permissions = session.access.permissions;
  return (
    <>
      <PageHeader
        title={`Sample ${s.code}`}
        description={
          <span className="row">
            <SampleStatusBadge
              status={s.status}
              colour={s.colour}
              reportStatus={s.labReport?.status}
            />
            <FlagBadge flag={s.worstFlag} />
            <span>{s.serviceType.name}</span>
          </span>
        }
        back={{ href: '/lab/samples', label: 'Samples' }}
      />
      <div className="stack">
        <section className="card">
          <h2 className="card-title">Sample</h2>
          <dl className="details">
            <div>
              <dt>Client</dt>
              <dd>{s.client.name}</dd>
            </div>
            <div>
              <dt>Vessel</dt>
              <dd>
                {s.vessel
                  ? `${s.vessel.name}${s.vessel.imoNumber ? ` · IMO ${s.vessel.imoNumber}` : ''}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>Batch</dt>
              <dd>
                <Link href={`/lab/batches/${s.batch.id}`}>{s.batch.code}</Link>
              </dd>
            </div>
            <div>
              <dt>Kit</dt>
              <dd>
                {s.kit.code} · {s.kit.product.name}
                {s.kit.variant ? ` (${s.kit.variant.name})` : ''}
                {s.kit.serialNumber ? ` · Serial ${s.kit.serialNumber}` : ''}
              </dd>
            </div>
            <div>
              <dt>Lab report</dt>
              <dd>
                {s.labReport ? (
                  permissions.includes('report.view') ? (
                    <Link href={`/lab/reports/${s.labReport.id}`}>{s.labReport.code}</Link>
                  ) : (
                    s.labReport.code
                  )
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt>Received under</dt>
              <dd>
                <Link href={`/lab/receiving/${s.airwayBill.id}`}>AWB {s.airwayBill.number}</Link>
              </dd>
            </div>
            <div>
              <dt>Registered</dt>
              <dd>
                {new Date(s.registeredAt).toLocaleString('en-GB', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
                {s.registeredBy ? ` by ${s.registeredBy}` : ''}
              </dd>
            </div>
          </dl>
        </section>
        <section className="card" id="results">
          <h2 className="card-title">Results</h2>
          <SampleResults data={results} canTest={permissions.includes('sample.test')} />
        </section>
        <section className="card">
          <h2 className="card-title">Attachments</h2>
          <SampleAttachments
            sampleId={s.id}
            attachments={attachments}
            canEdit={permissions.includes('sample.test') && !s.labReport}
          />
        </section>
        <section className="card">
          <h2 className="card-title">Registration details</h2>
          <FieldValues fields={s.fields.filter((f) => f.scope === 'SAMPLE')} values={s.values} />
        </section>
        {s.fields.some((f) => f.scope === 'BATCH') && (
          <section className="card">
            <h2 className="card-title">Batch details</h2>
            <FieldValues
              fields={s.fields.filter((f) => f.scope === 'BATCH')}
              values={s.batchValues}
            />
          </section>
        )}
      </div>
    </>
  );
}
