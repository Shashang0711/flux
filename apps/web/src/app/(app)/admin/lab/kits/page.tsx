import type { Metadata } from 'next';
import Link from 'next/link';
import type { ProductSummaryDto, ServiceTypeSummaryDto } from '@flux/shared';
import { ActiveBadge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Kits · FLUX' };

export default async function KitsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('lab-setup.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('lab-setup.manage');
  const params = readParams(await searchParams, ['q', 'serviceTypeId'] as const);
  const query = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const [{ data: kits }, { data: serviceTypes }] = await Promise.all([
    loadOrNotFound<ProductSummaryDto[]>(`/lab/products?${query}`),
    loadOrNotFound<ServiceTypeSummaryDto[]>('/lab/service-types'),
  ]);

  return (
    <>
      <PageHeader
        title="Kits"
        description="Sampling kits sent to vessels, with their variants and bottles."
        actions={
          canManage &&
          serviceTypes.length > 0 && (
            <Link className="btn btn-primary" href="/admin/lab/kits/new">
              New kit
            </Link>
          )
        }
      />
      <div className="stack">
        {serviceTypes.length === 0 && (
          <p className="alert">
            Kits are used for service types.{' '}
            <Link href="/admin/lab/service-types">Set up service types</Link> first.
          </p>
        )}
        <form className="toolbar" role="search">
          <input
            className="input"
            name="q"
            placeholder="Name or code"
            defaultValue={params.q}
            aria-label="Search kits"
          />
          <select
            className="select"
            name="serviceTypeId"
            defaultValue={params.serviceTypeId ?? ''}
            aria-label="Service type"
          >
            <option value="">All service types</option>
            {serviceTypes.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <DataTable
          label="Kits"
          rows={kits}
          rowKey={(k) => k.id}
          empty="No kits found."
          columns={[
            {
              header: 'Kit',
              primary: true,
              cell: (k) => (
                <>
                  <Link href={`/admin/lab/kits/${k.id}`}>{k.name}</Link>
                  <span className="cell-sub">
                    <code>{k.code}</code>
                  </span>
                </>
              ),
            },
            { header: 'Used for', cell: (k) => k.serviceTypes.map((s) => s.name).join(', ') },
            { header: 'Variants', cell: (k) => k.variantCount || '—' },
            { header: 'Status', cell: (k) => <ActiveBadge active={k.isActive} /> },
          ]}
        />
      </div>
    </>
  );
}
