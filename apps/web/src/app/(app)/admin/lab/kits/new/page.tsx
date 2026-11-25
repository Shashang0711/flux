import type { Metadata } from 'next';
import type { ServiceTypeSummaryDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { KitForm } from '../../kit-forms';

export const metadata: Metadata = { title: 'New kit · FLUX' };

export default async function NewKitPage() {
  const { allowed } = await sessionWithPermission('lab-setup.manage');
  if (!allowed) return <Forbidden />;
  const { data: serviceTypes } =
    await loadOrNotFound<ServiceTypeSummaryDto[]>('/lab/service-types');
  return (
    <>
      <PageHeader
        title="New kit"
        description="Next you will set its bottles and, if it comes in versions, its variants."
        back={{ href: '/admin/lab/kits', label: 'Kits' }}
      />
      <section className="card">
        <KitForm serviceTypes={serviceTypes} />
      </section>
    </>
  );
}
