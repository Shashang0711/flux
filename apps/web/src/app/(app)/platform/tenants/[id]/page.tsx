import type { Metadata } from 'next';
import type { TenantDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { loadOrNotFound, requireSession } from '@/lib/server-api';
import { TenantDetailsForm, TenantModulesForm, TenantStatusCard } from './tenant-forms';

export const metadata: Metadata = { title: 'Tenant · FLUX' };

export default async function TenantPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) return <Forbidden />;
  const { id } = await params;
  const { data: tenant } = await loadOrNotFound<TenantDto>(`/platform/tenants/${id}`);

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={
          <>
            {tenant.slug} · <StatusBadge status={tenant.status} />
          </>
        }
        back={{ href: '/platform/tenants', label: 'Tenants' }}
      />
      <TenantDetailsForm tenant={tenant} />
      <TenantModulesForm tenant={tenant} />
      <TenantStatusCard tenant={tenant} />
    </>
  );
}
