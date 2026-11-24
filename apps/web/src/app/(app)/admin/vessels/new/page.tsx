import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { sessionWithPermission } from '@/lib/server-api';
import { loadVesselFormOptions } from '../load-options';
import { VesselForm } from '../vessel-form';

export const metadata: Metadata = { title: 'New vessel · FLUX' };

export default async function NewVesselPage() {
  const { allowed } = await sessionWithPermission('vessel.manage');
  if (!allowed) return <Forbidden />;
  const options = await loadVesselFormOptions();
  return (
    <>
      <PageHeader
        title="New vessel"
        description="A vessel code (VS-00001, …) is assigned automatically. Linking the vessel to clients and fleets comes next."
        back={{ href: '/admin/vessels', label: 'Vessels' }}
      />
      <div className="card">
        <VesselForm options={options} />
      </div>
    </>
  );
}
