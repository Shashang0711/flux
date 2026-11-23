import type { Metadata } from 'next';
import Link from 'next/link';
import { MODULES, type PageMeta, type TenantDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
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
        <form className="row" role="search">
          <input
            className="input"
            style={{ maxWidth: 320 }}
            name="q"
            placeholder="Search name or slug"
            defaultValue={params.q}
            aria-label="Search tenants"
          />
          <select
            className="select"
            style={{ maxWidth: 180 }}
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
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Slug</th>
                <th>Modules</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">
                    No tenants found.
                  </td>
                </tr>
              )}
              {tenants.map((tenant) => (
                <tr key={tenant.id}>
                  <td>
                    <Link href={`/platform/tenants/${tenant.id}`}>{tenant.name}</Link>
                  </td>
                  <td className="muted">{tenant.slug}</td>
                  <td>
                    {tenant.modules.length === 0
                      ? '—'
                      : tenant.modules
                          .map((key) => MODULES.find((m) => m.key === key)?.name ?? key)
                          .join(', ')}
                  </td>
                  <td>
                    <StatusBadge status={tenant.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination meta={meta as PageMeta} basePath="/platform/tenants" params={params} />
      </div>
    </>
  );
}
