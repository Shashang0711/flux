import type { Metadata } from 'next';
import type { AuditLogDto, TenantDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
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
  const { data: history } = await loadOrNotFound<AuditLogDto[]>(
    `/platform/tenants/${id}/audit-logs?pageSize=20`,
  );

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
      <section className="card">
        <h2 className="card-title">History</h2>
        <AuditTable entries={history} showEntity={false} linkEntities={false} />
      </section>
    </>
  );
}
