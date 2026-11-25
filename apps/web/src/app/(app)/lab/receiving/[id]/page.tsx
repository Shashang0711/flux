import type { Metadata } from 'next';
import type { AirwayBillDto, AuditLogDto, ReceivingOptionsDto } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { Badge } from '@/components/badges';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { AirwayBillActions, KitTable, ReceiveKitForm } from '../kit-forms';

export const metadata: Metadata = { title: 'Airway bill · FLUX' };

export default async function AirwayBillPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('receiving.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const permissions = session.access.permissions;
  const canReceive = permissions.includes('receiving.receive');
  const tabs = [
    { key: 'kits', name: 'Kits' },
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'kits';
  const { data: awb } = await loadOrNotFound<AirwayBillDto>(`/receiving/airway-bills/${id}`);
  const options = canReceive
    ? (await loadOrNotFound<ReceivingOptionsDto>('/receiving/options')).data
    : null;

  return (
    <>
      <PageHeader
        title={`AWB ${awb.number}`}
        description={
          <span className="row">
            {awb.status === 'OPEN' ? <Badge tone="brand">Open</Badge> : <Badge>Closed</Badge>}
            <span>Received {awb.receivedOn}</span>
            {awb.courier && <span>{awb.courier}</span>}
            {awb.origin && <span>from {awb.origin}</span>}
            <span>
              {awb.kitCount} kit{awb.kitCount === 1 ? '' : 's'}
              {awb.pendingCount > 0 ? `, ${awb.pendingCount} awaiting registration` : ''}
            </span>
          </span>
        }
        back={{ href: '/lab/receiving', label: 'Receiving' }}
        actions={canReceive && <AirwayBillActions awb={awb} />}
      />
      {awb.notes && <p className="muted">{awb.notes}</p>}
      <ListTabs basePath={`/lab/receiving/${id}`} param="tab" active={tab} tabs={tabs} />
      {tab === 'kits' && (
        <div className="stack">
          {canReceive && options && awb.status === 'OPEN' && (
            <ReceiveKitForm awb={awb} options={options} />
          )}
          {awb.status === 'CLOSED' && (
            <p className="alert" style={{ margin: 0 }}>
              This airway bill is closed. Reopen it to receive more kits.
            </p>
          )}
          <KitTable
            kits={awb.kits}
            options={options}
            canReceive={canReceive}
            empty="No kits received yet."
          />
        </div>
      )}
      {tab === 'audit' && (
        <section className="card">
          <AuditTable
            entries={
              (await loadOrNotFound<AuditLogDto[]>(`/audit-logs?entityId=${id}&pageSize=100`)).data
            }
            showEntity
            linkEntities={false}
          />
        </section>
      )}
    </>
  );
}
