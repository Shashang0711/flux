import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { sessionWithPermission } from '@/lib/server-api';
import { AirwayBillForm } from '../kit-forms';

export const metadata: Metadata = { title: 'New airway bill · FLUX' };

export default async function NewAirwayBillPage() {
  const { allowed } = await sessionWithPermission('receiving.receive');
  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="New airway bill"
        description="Record the shipment, then receive its kits one by one."
        back={{ href: '/lab/receiving', label: 'Receiving' }}
      />
      <section className="card">
        <AirwayBillForm />
      </section>
    </>
  );
}
