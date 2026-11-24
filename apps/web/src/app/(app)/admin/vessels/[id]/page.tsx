import type { Metadata } from 'next';
import type { AuditLogDto, VesselDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { loadVesselFormOptions } from '../load-options';
import { VesselForm } from '../vessel-form';
import { VesselStatusCard } from './vessel-status';

export const metadata: Metadata = { title: 'Vessel · FLUX' };

export default async function VesselPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('vessel.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const permissions = session.access.permissions;
  const canManage = permissions.includes('vessel.manage');
  const tabs = [
    { key: 'overview', name: 'Overview' },
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'overview';

  const { data: vessel } = await loadOrNotFound<VesselDto>(`/vessels/${id}`);

  return (
    <>
      <PageHeader
        title={vessel.name}
        description={
          <span className="row">
            <code>{vessel.code}</code>
            {vessel.imoNumber && <span>IMO {vessel.imoNumber}</span>}
            <StatusBadge status={vessel.status} />
          </span>
        }
        back={{ href: '/admin/vessels', label: 'Vessels' }}
      />
      {!canManage && (
        <p className="alert" style={{ marginBottom: 16 }}>
          You can view this vessel but not change it.
        </p>
      )}
      <ListTabs basePath={`/admin/vessels/${id}`} param="tab" active={tab} tabs={tabs} />
      {tab === 'overview' && (
        <>
          <section className="card">
            <h2 className="card-title">General</h2>
            <VesselForm
              vessel={vessel}
              options={await loadVesselFormOptions()}
              disabled={!canManage}
            />
          </section>
          {canManage && <VesselStatusCard vessel={vessel} />}
        </>
      )}
      {tab === 'audit' && (
        <section className="card">
          <AuditTable
            entries={
              (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=50`)).data
            }
            showEntity={false}
            linkEntities={false}
          />
        </section>
      )}
    </>
  );
}
