import type { Metadata } from 'next';
import type { BottleTypeDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { BottleTypes } from '../kit-forms';

export const metadata: Metadata = { title: 'Bottle types · FLUX' };

export default async function BottleTypesPage() {
  const { session, allowed } = await sessionWithPermission('lab-setup.view');
  if (!allowed) return <Forbidden />;
  const { data: bottles } = await loadOrNotFound<BottleTypeDto[]>('/lab/bottle-types');
  return (
    <>
      <PageHeader
        title="Bottle types"
        description="The bottles your kits contain. Kits and variants list them with quantities."
      />
      <BottleTypes
        bottles={bottles}
        canManage={session.access.permissions.includes('lab-setup.manage')}
      />
    </>
  );
}
