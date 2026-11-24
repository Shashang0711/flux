import type { Metadata } from 'next';
import Link from 'next/link';
import { MODULES, type PageMeta, type TenantDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, requireSession } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Tenants · FLUX' };

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) return <Forbidden />;

  const params = readParams(await searchParams, ['q', 'status', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  if (params.q) query.set('q', params.q);
  if (params.status) query.set('status', params.status);
  if (params.page) query.set('page', params.page);
  const { data: tenants, meta } = await loadOrNotFound<TenantDto[]>(`/platform/tenants?${query}`);

  return (
    <>
      <PageHeader
        title="Tenants"
        description="Organisations subscribed to FLUX and the modules they are licensed for."
        actions={
          <Link className="btn btn-primary" href="/platform/tenants/new">
            New tenant
          </Link>
        }
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Search name or slug"
            defaultValue={params.q}
            aria-label="Search tenants"
          />
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Tenants"
          rows={tenants}
          rowKey={(t) => t.id}
          empty="No tenants found."
          columns={[
            {
              header: 'Name',
              primary: true,
              cell: (t) => <Link href={`/platform/tenants/${t.id}`}>{t.name}</Link>,
            },
            { header: 'Slug', cell: (t) => <code>{t.slug}</code> },
            {
              header: 'Modules',
              cell: (t) =>
                t.modules.length === 0
                  ? '—'
                  : t.modules
                      .map((key) => MODULES.find((m) => m.key === key)?.name ?? key)
                      .join(', '),
            },
            { header: 'Status', cell: (t) => <StatusBadge status={t.status} /> },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/platform/tenants" params={params} />
      </div>
    </>
  );
}
