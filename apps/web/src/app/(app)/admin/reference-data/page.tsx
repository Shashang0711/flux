import type { Metadata } from 'next';
import type { REFERENCE_LISTS, ReferenceItemDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { ReferenceItemsManager } from '@/components/reference-items-manager';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Reference data · FLUX' };

type ReferenceList = (typeof REFERENCE_LISTS)[number];

export default async function ReferenceDataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('reference-data.manage');
  if (!allowed) return <Forbidden />;

  const { data: lists } = await loadOrNotFound<ReferenceList[]>('/reference-data');
  if (lists.length === 0) {
    return (
      <>
        <PageHeader title="Reference data" />
        <p className="card muted">Your organisation has no modules that use reference data yet.</p>
      </>
    );
  }
  const requested = readParams(await searchParams, ['list'] as const).list;
  const list = lists.find((l) => l.key === requested) ?? lists[0]!;
  const { data: items } = await loadOrNotFound<ReferenceItemDto[]>(
    `/reference-data/${list.key}?view=all`,
  );

  return (
    <>
      <PageHeader
        title="Reference data"
        description="FLUX provides standard values for each list. Hide the ones you don’t use and add your own."
      />
      <ListTabs basePath="/admin/reference-data" param="list" active={list.key} tabs={lists} />
      <p className="muted" style={{ marginTop: 0 }}>
        {list.description}
      </p>
      <ReferenceItemsManager
        mode="tenant"
        apiPath={`/reference-data/${list.key}`}
        itemName={list.itemName}
        items={items}
        canManage
      />
    </>
  );
}
