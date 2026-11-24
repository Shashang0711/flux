import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import type { ClientSummaryDto, ReferenceItemDto } from '@flux/shared';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { loadVesselFormOptions } from '../load-options';
import { VesselForm } from '../vessel-form';

export const metadata: Metadata = { title: 'New vessel · FLUX' };

export default async function NewVesselPage() {
  const { session, allowed } = await sessionWithPermission('vessel.manage');
  if (!allowed) return <Forbidden />;
  const options = await loadVesselFormOptions();
  // Optional client link on create (design pack: Client and Fleet dropdowns on Create New Ship).
  const linkOptions =
    session.modules.includes('clients') && session.access.permissions.includes('client.view')
      ? {
          clients: (await loadOrNotFound<ClientSummaryDto[]>('/clients?status=ACTIVE&pageSize=100'))
            .data,
          relationshipTypes: (
            await loadOrNotFound<ReferenceItemDto[]>('/reference-data/vessel-relationship-type')
          ).data,
        }
      : null;
  return (
    <>
      <PageHeader
        title="New vessel"
        description="A vessel code (VS-00001, …) is assigned automatically. You can link it to a client and fleet below, or later."
        back={{ href: '/admin/vessels', label: 'Vessels' }}
      />
      <div className="card">
        <VesselForm options={options} linkOptions={linkOptions} />
      </div>
    </>
  );
}
