import type { Metadata } from 'next';
import type {
  AuditLogDto,
  ClientDto,
  CustomFieldDefinitionDto,
  FleetDto,
  VesselRelationshipDto,
} from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ClientFleets, ClientVessels } from './client-fleets';
import { Addresses, BillingParties, Contacts, Overview } from './client-tabs';

export const metadata: Metadata = { title: 'Client · FLUX' };

export default async function ClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('client.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const permissions = session.access.permissions;
  const canManage = permissions.includes('client.manage');

  const tabs = [
    { key: 'overview', name: 'Overview' },
    { key: 'addresses', name: 'Addresses' },
    { key: 'contacts', name: 'Contacts' },
    { key: 'billing', name: 'Billing Parties' },
    ...(session.modules.includes('vessels') && permissions.includes('vessel.view')
      ? [
          { key: 'vessels', name: 'Vessels' },
          { key: 'fleets', name: 'Fleets' },
        ]
      : []),
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'overview';

  const { data: client } = await loadOrNotFound<ClientDto>(`/clients/${id}`);
  const customFields =
    tab === 'overview'
      ? (await loadOrNotFound<CustomFieldDefinitionDto[]>('/custom-fields?entity=client')).data
      : [];
  const history =
    tab === 'audit'
      ? (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=50`)).data
      : [];

  return (
    <>
      <PageHeader
        title={client.name}
        description={
          <span className="row">
            <code>{client.code}</code>
            <StatusBadge status={client.status} />
            {client.tradingName && <span>Trading as {client.tradingName}</span>}
          </span>
        }
        back={{ href: '/admin/clients', label: 'Clients' }}
      />
      {!canManage && (
        <p className="alert" style={{ marginBottom: 16 }}>
          You can view this client but not change it.
        </p>
      )}
      <ListTabs basePath={`/admin/clients/${id}`} param="tab" active={tab} tabs={tabs} />
      {tab === 'overview' && (
        <Overview client={client} canManage={canManage} customFields={customFields} />
      )}
      {tab === 'addresses' && <Addresses client={client} canManage={canManage} />}
      {tab === 'contacts' && <Contacts client={client} canManage={canManage} />}
      {tab === 'billing' && <BillingParties client={client} canManage={canManage} />}
      {tab === 'vessels' && (
        <ClientVessels
          relationships={
            (await loadOrNotFound<VesselRelationshipDto[]>(`/clients/${id}/vessels`)).data
          }
        />
      )}
      {tab === 'fleets' && (
        <ClientFleets
          client={client}
          fleets={(await loadOrNotFound<FleetDto[]>(`/clients/${id}/fleets`)).data}
          canManage={permissions.includes('fleet.manage')}
        />
      )}
      {tab === 'audit' && (
        <section className="card">
          <AuditTable entries={history} showEntity={false} linkEntities={false} />
        </section>
      )}
    </>
  );
}
