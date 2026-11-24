import type { Metadata } from 'next';
import type {
  AuditLogDto,
  ClientSummaryDto,
  ReferenceItemDto,
  VesselDto,
  VesselLinkSettingsDto,
  VesselRelationshipDto,
} from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { StatusBadge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { loadVesselFormOptions } from '../load-options';
import { VesselForm } from '../vessel-form';
import { LinkSwitcher } from './link-switcher';
import { VesselClients } from './vessel-clients';
import { VesselBilling, VesselContacts, VesselNotifications } from './vessel-settings';
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
    ...(session.modules.includes('clients')
      ? [
          { key: 'clients', name: 'Clients' },
          { key: 'billing', name: 'Billing' },
          { key: 'contacts', name: 'Contacts' },
          { key: 'notifications', name: 'Notifications' },
        ]
      : []),
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const {
    tab: requested,
    ended,
    link,
  } = readParams(await searchParams, ['tab', 'ended', 'link'] as const);
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'overview';

  const { data: vessel } = await loadOrNotFound<VesselDto>(`/vessels/${id}`);

  // Billing, Contacts and Notifications are per client link (active links only).
  const perLink = tab === 'billing' || tab === 'contacts' || tab === 'notifications';
  const links = perLink
    ? (await loadOrNotFound<VesselRelationshipDto[]>(`/vessels/${id}/relationships`)).data
    : [];
  const activeLink = links.find((l) => l.id === link) ?? links.find((l) => l.isPrimary) ?? links[0];
  const settings = activeLink
    ? (await loadOrNotFound<VesselLinkSettingsDto>(`/relationships/${activeLink.id}/settings`)).data
    : null;

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
      {tab === 'clients' && (
        <VesselClients
          vessel={vessel}
          relationships={
            (
              await loadOrNotFound<VesselRelationshipDto[]>(
                `/vessels/${id}/relationships?status=${ended ? 'ALL' : 'ACTIVE'}`,
              )
            ).data
          }
          options={
            canManage && permissions.includes('client.view')
              ? {
                  clients: (
                    await loadOrNotFound<ClientSummaryDto[]>('/clients?status=ACTIVE&pageSize=100')
                  ).data,
                  relationshipTypes: (
                    await loadOrNotFound<ReferenceItemDto[]>(
                      '/reference-data/vessel-relationship-type',
                    )
                  ).data,
                }
              : null
          }
          canManage={canManage}
          canManageFleets={permissions.includes('fleet.manage')}
          showEnded={Boolean(ended)}
        />
      )}
      {perLink && !settings && (
        <section className="card">
          <p style={{ margin: 0 }}>
            Billing, contacts and notifications come from the vessel’s clients.{' '}
            <a href={`/admin/vessels/${id}?tab=clients`}>Link this vessel to a client</a> first.
          </p>
        </section>
      )}
      {perLink && settings && activeLink && (
        <LinkSwitcher
          basePath={`/admin/vessels/${id}`}
          tab={tab}
          links={links}
          active={activeLink}
        />
      )}
      {tab === 'billing' && settings && <VesselBilling settings={settings} canManage={canManage} />}
      {tab === 'contacts' && settings && (
        <VesselContacts settings={settings} canManage={canManage} />
      )}
      {tab === 'notifications' && settings && (
        <VesselNotifications settings={settings} canManage={canManage} />
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
