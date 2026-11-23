import type { Metadata } from 'next';
import type { AuditLogDto, PageMeta } from '@flux/shared';
import { AuditTable } from '@/components/audit-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, requireSession } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Platform audit log · FLUX' };

export default async function PlatformAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!session.user.isPlatformAdmin) return <Forbidden />;
  const params = readParams(await searchParams, ['page'] as const);
  const query = new URLSearchParams({ pageSize: '50' });
  if (params.page) query.set('page', params.page);
  const { data: entries, meta } = await loadOrNotFound<AuditLogDto[]>(
    `/platform/audit-logs?${query}`,
  );
  return (
    <>
      <PageHeader
        title="Platform audit log"
        description="Changes to platform-wide data such as FLUX default reference data. Organisation activity is in each tenant’s history."
      />
      <div className="stack">
        <AuditTable entries={entries} linkEntities={false} />
        <Pagination meta={meta as PageMeta} basePath="/platform/audit" params={params} />
      </div>
    </>
  );
}
