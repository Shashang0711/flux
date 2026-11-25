import type { Metadata } from 'next';
import Link from 'next/link';
import type { LabCategoryDto, ServiceTypeSummaryDto } from '@flux/shared';
import { ActiveBadge, Badge } from '@/components/badges';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { Categories, StarterImport } from '../catalogue-forms';

export const metadata: Metadata = { title: 'Service types · FLUX' };

export default async function ServiceTypesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('lab-setup.view');
  if (!allowed) return <Forbidden />;
  const canManage = session.access.permissions.includes('lab-setup.manage');
  const params = readParams(await searchParams, ['list', 'q', 'categoryId'] as const);
  const list = params.list === 'categories' ? 'categories' : 'service-types';

  const query = new URLSearchParams();
  if (params.q) query.set('q', params.q);
  if (params.categoryId) query.set('categoryId', params.categoryId);
  const [{ data: categories }, { data: serviceTypes }] = await Promise.all([
    loadOrNotFound<LabCategoryDto[]>('/lab/categories'),
    loadOrNotFound<ServiceTypeSummaryDto[]>(`/lab/service-types?${query}`),
  ]);
  const empty = categories.length === 0 && serviceTypes.length === 0;

  return (
    <>
      <PageHeader
        title="Service types"
        description="What your laboratory tests, grouped by category. Each service type defines the fields entered when its samples are registered."
        actions={
          canManage &&
          list === 'service-types' &&
          categories.length > 0 && (
            <Link className="btn btn-primary" href="/admin/lab/service-types/new">
              New service type
            </Link>
          )
        }
      />
      <ListTabs
        basePath="/admin/lab/service-types"
        param="list"
        active={list}
        tabs={[
          { key: 'service-types', name: 'Service types' },
          { key: 'categories', name: 'Categories' },
        ]}
      />
      {empty && canManage && (
        <div style={{ marginBottom: 16 }}>
          <StarterImport />
        </div>
      )}
      {list === 'categories' ? (
        <Categories categories={categories} canManage={canManage} />
      ) : (
        <div className="stack">
          {categories.length === 0 && !empty && <p className="alert">Add a category first.</p>}
          <form className="toolbar" role="search">
            <input
              className="input"
              name="q"
              placeholder="Name or code"
              defaultValue={params.q}
              aria-label="Search service types"
            />
            <select
              className="select"
              name="categoryId"
              defaultValue={params.categoryId ?? ''}
              aria-label="Category"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Filter
            </button>
          </form>
          <DataTable
            label="Service types"
            rows={serviceTypes}
            rowKey={(s) => s.id}
            empty={
              empty
                ? 'No service types yet. Import the starter catalogue or add a category and service type.'
                : 'No service types found.'
            }
            columns={[
              {
                header: 'Service type',
                primary: true,
                cell: (s) => (
                  <>
                    <Link href={`/admin/lab/service-types/${s.id}`}>{s.name}</Link>
                    <span className="cell-sub">
                      <code>{s.code}</code>
                    </span>
                  </>
                ),
              },
              {
                header: 'Category',
                cell: (s) => (
                  <>
                    {s.category.name} {!s.category.isActive && <Badge>Inactive</Badge>}
                  </>
                ),
              },
              { header: 'Registration fields', cell: (s) => s.fieldCount },
              { header: 'Kits', cell: (s) => s.productCount },
              { header: 'Status', cell: (s) => <ActiveBadge active={s.isActive} /> },
            ]}
          />
        </div>
      )}
    </>
  );
}
