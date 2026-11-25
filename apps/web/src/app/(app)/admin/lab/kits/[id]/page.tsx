import type { Metadata } from 'next';
import type { AuditLogDto, BottleTypeDto, ProductDto, ServiceTypeSummaryDto } from '@flux/shared';
import { ActiveBadge } from '@/components/badges';
import { AuditTable } from '@/components/audit-table';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { BottleLinesEditor, KitForm, Variants, bottleSummary } from '../../kit-forms';

export const metadata: Metadata = { title: 'Kit · FLUX' };

export default async function KitPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('lab-setup.view');
  if (!allowed) return <Forbidden />;
  const { id } = await params;
  const permissions = session.access.permissions;
  const canManage = permissions.includes('lab-setup.manage');
  const tabs = [
    { key: 'general', name: 'General' },
    { key: 'bottles', name: 'Bottles' },
    { key: 'variants', name: 'Variants' },
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'general';
  const { data: kit } = await loadOrNotFound<ProductDto>(`/lab/products/${id}`);
  const bottleTypes =
    tab === 'bottles' || tab === 'variants'
      ? (await loadOrNotFound<BottleTypeDto[]>('/lab/bottle-types')).data
      : [];

  return (
    <>
      <PageHeader
        title={kit.name}
        description={
          <span className="row">
            <code>{kit.code}</code>
            <ActiveBadge active={kit.isActive} />
          </span>
        }
        back={{ href: '/admin/lab/kits', label: 'Kits' }}
      />
      <ListTabs basePath={`/admin/lab/kits/${id}`} param="tab" active={tab} tabs={tabs} />
      {tab === 'general' && (
        <section className="card">
          <KitForm
            kit={kit}
            serviceTypes={
              (await loadOrNotFound<ServiceTypeSummaryDto[]>('/lab/service-types')).data
            }
            disabled={!canManage}
          />
        </section>
      )}
      {tab === 'bottles' && (
        <section className="card">
          <h2 className="card-title">Bottles in each kit</h2>
          {canManage ? (
            bottleTypes.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                Add bottle types first (Laboratory → Bottle types).
              </p>
            ) : (
              <BottleLinesEditor
                idPrefix="kit"
                lines={kit.bottles}
                bottleTypes={bottleTypes}
                url={`/lab/products/${kit.id}/bottles`}
                emptyHint="No bottles yet."
              />
            )
          ) : (
            <p style={{ margin: 0 }}>{bottleSummary(kit.bottles)}</p>
          )}
          {kit.variants.some((v) => v.bottles.length > 0) && (
            <p className="muted" style={{ marginBottom: 0 }}>
              Some variants have their own bottles; see the Variants tab.
            </p>
          )}
        </section>
      )}
      {tab === 'variants' && <Variants kit={kit} bottleTypes={bottleTypes} canManage={canManage} />}
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
