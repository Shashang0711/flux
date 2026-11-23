import type { Metadata } from 'next';
import { REFERENCE_LISTS, type ReferenceItemDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { readParams } from '@/components/pagination';
import { ReferenceItemsManager } from '@/components/reference-items-manager';
import { loadOrNotFound, requireSession } from '@/lib/server-api';

export const metadata: Metadata = { title: 'FLUX defaults · FLUX' };

export default async function PlatformReferenceDataPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) return <Forbidden />;

  const requested = readParams(await searchParams, ['list'] as const).list;
  const list = REFERENCE_LISTS.find((l) => l.key === requested) ?? REFERENCE_LISTS[0];
  const { data: items } = await loadOrNotFound<ReferenceItemDto[]>(
    `/platform/reference-data/${list.key}`,
  );

  return (
    <>
      <PageHeader
        title="Reference data"
        description="FLUX defaults shared by every organisation. Organisations can hide defaults and add their own items."
      />
      <ListTabs
        basePath="/platform/reference-data"
        param="list"
        active={list.key}
        tabs={REFERENCE_LISTS}
      />
      <p className="muted" style={{ marginTop: 0 }}>
        {list.description}. Deactivate rather than delete: records may refer to these values.
      </p>
      <ReferenceItemsManager
        mode="platform"
        apiPath={`/platform/reference-data/${list.key}`}
        itemName={list.itemName}
        items={items}
        canManage
      />
    </>
  );
}
