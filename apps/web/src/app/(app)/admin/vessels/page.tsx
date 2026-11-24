import type { Metadata } from 'next';
import Link from 'next/link';
import type { PageMeta, ReferenceItemDto, VesselSummaryDto } from '@flux/shared';
import { StatusBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Vessels · FLUX' };

export default async function VesselsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('vessel.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('vessel.manage');

  const params = readParams(await searchParams, ['q', 'status', 'vesselTypeId', 'page'] as const);
  const query = new URLSearchParams({ pageSize: '20' });
  Object.entries(params).forEach(([key, value]) => value && query.set(key, value));
  const [{ data: vessels, meta }, { data: types }] = await Promise.all([
    loadOrNotFound<VesselSummaryDto[]>(`/vessels?${query}`),
    loadOrNotFound<ReferenceItemDto[]>('/reference-data/vessel-type'),
  ]);

  return (
    <>
      <PageHeader
        title="Vessels"
        description="Vessel master records. Each physical ship is registered once."
        actions={
          canManage && (
            <Link className="btn btn-primary" href="/admin/vessels/new">
              New vessel
            </Link>
          )
        }
      />
      <div className="stack">
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Name, previous name, IMO or vessel code"
            defaultValue={params.q}
            aria-label="Search vessels"
          />
          <select
            className="select"
            name="vesselTypeId"
            defaultValue={params.vesselTypeId ?? ''}
            aria-label="Vessel type"
          >
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            className="select"
            name="status"
            defaultValue={params.status ?? ''}
            aria-label="Status"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Vessels"
          rows={vessels}
          rowKey={(v) => v.id}
          empty="No vessels found."
          columns={[
            {
              header: 'Vessel',
              primary: true,
              cell: (v) => (
                <>
                  <Link href={`/admin/vessels/${v.id}`}>{v.name}</Link>
                  <span className="cell-sub">
                    <code>{v.code}</code>
                  </span>
                </>
              ),
            },
            { header: 'IMO', cell: (v) => v.imoNumber ?? <span className="muted">—</span> },
            { header: 'Type', cell: (v) => v.vesselType?.name ?? <span className="muted">—</span> },
            { header: 'Status', cell: (v) => <StatusBadge status={v.status} /> },
          ]}
        />
        <Pagination meta={meta as PageMeta} basePath="/admin/vessels" params={params} />
      </div>
    </>
  );
}
