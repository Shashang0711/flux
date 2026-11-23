import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { sessionWithPermission } from '@/lib/server-api';
import { NewClientForm } from './new-client-form';

export const metadata: Metadata = { title: 'New client · FLUX' };

export default async function NewClientPage() {
  const { allowed } = await sessionWithPermission('client.manage');
  if (!allowed) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="New client"
        description="A client ID (CL-00001, …) is assigned automatically. Add addresses, contacts and billing parties next."
        back={{ href: '/admin/clients', label: 'Clients' }}
      />
      <div className="card">
        <NewClientForm />
      </div>
    </>
  );
}
