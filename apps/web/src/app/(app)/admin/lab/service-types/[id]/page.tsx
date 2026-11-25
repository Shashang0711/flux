import type { Metadata } from 'next';
import Link from 'next/link';
import type { AuditLogDto, LabCategoryDto, ServiceTypeDto } from '@flux/shared';
import { ActiveBadge, Badge } from '@/components/badges';
import { AuditTable } from '@/components/audit-table';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ServiceTypeForm } from '../../catalogue-forms';
import { RegistrationFields, RegistrationPreview } from '../../field-forms';
import { Parameters } from '../../parameter-forms';

export const metadata: Metadata = { title: 'Service type · FLUX' };

export default async function ServiceTypePage({
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
    { key: 'fields', name: 'Registration fields' },
    { key: 'parameters', name: 'Parameters' },
    { key: 'preview', name: 'Preview' },
    { key: 'kits', name: 'Kits' },
    ...(permissions.includes('audit.view') ? [{ key: 'audit', name: 'Audit' }] : []),
  ];
  const requested = readParams(await searchParams, ['tab'] as const).tab;
  const tab = tabs.find((t) => t.key === requested)?.key ?? 'general';
  const { data: st } = await loadOrNotFound<ServiceTypeDto>(`/lab/service-types/${id}`);

  return (
    <>
      <PageHeader
        title={st.name}
        description={
          <span className="row">
            <code>{st.code}</code>
            <span>{st.category.name}</span>
            <ActiveBadge active={st.isActive} />
            {!st.category.isActive && <Badge tone="warn">Category inactive</Badge>}
          </span>
        }
        back={{ href: '/admin/lab/service-types', label: 'Service types' }}
      />
      <ListTabs basePath={`/admin/lab/service-types/${id}`} param="tab" active={tab} tabs={tabs} />
      {tab === 'general' && (
        <section className="card">
          <ServiceTypeForm
            serviceType={st}
            categories={(await loadOrNotFound<LabCategoryDto[]>('/lab/categories')).data}
            disabled={!canManage}
          />
        </section>
      )}
      {tab === 'fields' && <RegistrationFields serviceType={st} canManage={canManage} />}
      {tab === 'parameters' && <Parameters serviceType={st} canManage={canManage} />}
      {tab === 'preview' && <RegistrationPreview serviceType={st} />}
      {tab === 'kits' && (
        <div className="stack">
          <DataTable
            label="Kits"
            rows={st.products}
            rowKey={(p) => p.id}
            empty="No kits are used for this service type yet."
            columns={[
              {
                header: 'Kit',
                primary: true,
                cell: (p) => (
                  <>
                    <Link href={`/admin/lab/kits/${p.id}`}>{p.name}</Link>
                    <span className="cell-sub">
                      <code>{p.code}</code>
                    </span>
                  </>
                ),
              },
              { header: 'Status', cell: (p) => <ActiveBadge active={p.isActive} /> },
            ]}
          />
          <p className="muted" style={{ margin: 0 }}>
            Kits are linked to service types on the kit’s General tab.
          </p>
        </div>
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
