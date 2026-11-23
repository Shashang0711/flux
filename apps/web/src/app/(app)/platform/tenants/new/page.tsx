import type { Metadata } from 'next';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { requireSession } from '@/lib/server-api';
import { NewTenantForm } from './new-tenant-form';

export const metadata: Metadata = { title: 'New tenant · FLUX' };

export default async function NewTenantPage() {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) return <Forbidden />;
  return (
    <>
      <PageHeader
        title="New tenant"
        description="Creates the organisation, its licensed modules and its first administrator."
        back={{ href: '/platform/tenants', label: 'Tenants' }}
      />
      <div className="card">
        <NewTenantForm />
      </div>
    </>
  );
}
