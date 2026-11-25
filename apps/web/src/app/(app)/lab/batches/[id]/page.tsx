import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuditLogDto, BatchDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { DataTable } from '@/components/data-table';
import { FieldValues, fieldSummary } from '@/components/field-values';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { SampleStatusBadge } from '@/components/sample-status';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Batch · FLUX' };

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const { data: batch } = await loadOrNotFound<BatchDto>(`/samples/batches/${id}`);
  const batchFields = batch.fields.filter((f) => f.scope === 'BATCH');
  const sampleFields = batch.fields.filter((f) => f.scope === 'SAMPLE');
  const history = session.access.permissions.includes('audit.view')
    ? (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=20`)).data
    : null;

  return (
    <>
      <PageHeader
        title={`Batch ${batch.code}`}
        description={
          <span className="row">
            <span>{batch.serviceType.name}</span>
            <span>
              {batch.sampleCount} sample{batch.sampleCount === 1 ? '' : 's'}
            </span>
            <span>
              Registered{' '}
              {new Date(batch.registeredAt).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
              {batch.registeredBy ? ` by ${batch.registeredBy}` : ''}
            </span>
          </span>
        }
        back={{ href: '/lab/batches', label: 'Batches' }}
      />
      <div className="stack">
        {(batchFields.length > 0 || batch.notes) && (
          <section className="card">
            <h2 className="card-title">Batch details</h2>
            <FieldValues fields={batchFields} values={batch.values} />
            {batch.notes && <p style={{ marginBottom: 0 }}>{batch.notes}</p>}
          </section>
        )}
        <DataTable
          label="Samples"
          rows={batch.samples}
          rowKey={(s) => s.id}
          empty="No samples."
          columns={[
            {
              header: 'Sample',
              primary: true,
              cell: (s) => (
                <>
                  <Link href={`/lab/samples/${s.id}`}>
                    <code>{s.code}</code>
                  </Link>
                  <span className="cell-sub">
                    Kit {s.kit.code}
                    {s.kit.serialNumber ? ` · ${s.kit.serialNumber}` : ''}
                  </span>
                </>
              ),
            },
            {
              header: 'Vessel / client',
              cell: (s) => (
                <>
                  {s.vessel?.name ?? <span className="muted">No vessel</span>}
                  <span className="cell-sub">{s.client.name}</span>
                </>
              ),
            },
            { header: 'Details', cell: (s) => fieldSummary(sampleFields, s.values) || '—' },
            {
              header: 'Status',
              cell: (s) => <SampleStatusBadge status={s.status} colour={s.colour} />,
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
