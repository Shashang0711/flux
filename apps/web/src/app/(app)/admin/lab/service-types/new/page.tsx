import type { Metadata } from 'next';
import type { LabCategoryDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ServiceTypeForm } from '../../catalogue-forms';

export const metadata: Metadata = { title: 'New service type · FLUX' };

export default async function NewServiceTypePage() {
  const { allowed } = await sessionWithPermission('lab-setup.manage');
  if (!allowed) return <Forbidden />;
  const { data: categories } = await loadOrNotFound<LabCategoryDto[]>('/lab/categories');
  return (
    <>
      <PageHeader
        title="New service type"
        description="Next you will add its registration fields."
        back={{ href: '/admin/lab/service-types', label: 'Service types' }}
      />
      <section className="card">
        <ServiceTypeForm categories={categories} />
      </section>
    </>
  );
}
