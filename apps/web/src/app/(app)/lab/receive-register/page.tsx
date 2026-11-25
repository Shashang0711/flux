import type { Metadata } from 'next';
import type { ReceiveRegisterOptionsDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ReceiveRegisterForm } from './receive-register-form';

export const metadata: Metadata = { title: 'Receive & register · FLUX' };

export default async function ReceiveRegisterPage() {
  const { allowed } = await sessionWithPermission('receiving.receive', 'sample.register');
  if (!allowed) return <Forbidden />;
  const { data: options } = await loadOrNotFound<ReceiveRegisterOptionsDto>(
    '/samples/receive-register-options',
  );
  return (
    <>
      <PageHeader
        title="Receive & register"
        description="Receive a package and register its kits in one step. Kits get their kit IDs, the batch its batch ID and each kit a sample ID."
        back={{ href: '/lab/receiving', label: 'Receiving' }}
      />
      {options.serviceTypes.length === 0 ? (
        <p className="alert">No active kits and service types are set up yet (Lab setup).</p>
      ) : (
        <ReceiveRegisterForm options={options} />
      )}
    </>
  );
}
