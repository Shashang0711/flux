import type { Metadata } from 'next';
import type { BatchResultsDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ResultsGrid } from './results-grid';

export const metadata: Metadata = { title: 'Batch results · FLUX' };

export default async function BatchResultsPage({ params }: { params: Promise<{ id: string }> }) {
  const { session, allowed } = await sessionWithPermission('sample.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const { data } = await loadOrNotFound<BatchResultsDto>(`/samples/batches/${id}/results`);
  return (
    <>
      <PageHeader
        title={`Results · ${data.batchCode}`}
        description="Enter results per sample, or download the CSV template and upload it filled in."
        back={{ href: `/lab/batches/${id}`, label: `Batch ${data.batchCode}` }}
      />
      {data.parameters.length === 0 ? (
        <p className="alert">
          This service type has no test parameters yet (Lab setup → Service types → Parameters).
        </p>
      ) : (
        <ResultsGrid data={data} canTest={session.access.permissions.includes('sample.test')} />
      )}
    </>
  );
}
