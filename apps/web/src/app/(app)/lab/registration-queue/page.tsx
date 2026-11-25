import type { Metadata } from 'next';
import type { PageMeta, ReceivedKitDto, ReceivingOptionsDto } from '@flux/shared';
import { Forbidden } from '@/components/forbidden';
import { ListTabs } from '@/components/list-tabs';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { QueueTable } from './queue-table';

export const metadata: Metadata = { title: 'Registration queue · FLUX' };

export default async function RegistrationQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { session, allowed } = await sessionWithPermission('receiving.view');
  if (!allowed) return <Forbidden />;
  const canReceive = session.access.permissions.includes('receiving.receive');
  const canRegister = session.access.permissions.includes('sample.register');
  const params = readParams(await searchParams, [
    'link',
    'q',
    'serviceTypeId',
    'flagged',
    'page',
  ] as const);
  const query = new URLSearchParams({ pageSize: '25' });
  Object.entries(params).forEach(([k, v]) => v && query.set(k, v));
  const [{ data: kits, meta }, { data: options }] = await Promise.all([
    loadOrNotFound<ReceivedKitDto[]>(`/receiving/registration-queue?${query}`),
    loadOrNotFound<ReceivingOptionsDto>('/receiving/options'),
  ]);
  const serviceTypes = [
    ...new Map(options.kits.flatMap((k) => k.serviceTypes).map((s) => [s.id, s])).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Registration queue"
        description="Received kits waiting to be registered as samples, with or without a vessel."
      />
      <ListTabs
        basePath="/lab/registration-queue"
        param="link"
        active={params.link ?? 'all'}
        tabs={[
          { key: 'all', name: 'All kits' },
          { key: 'linked', name: 'Vessel linked' },
          { key: 'unlinked', name: 'Unlinked' },
        ]}
      />
      <div className="stack">
        <form className="toolbar" role="search">
          {params.link && params.link !== 'all' && (
            <input type="hidden" name="link" value={params.link} />
          )}
          <input
            className="input"
            name="q"
            placeholder="Kit ID, serial, vessel or AWB"
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
          <label className="check">
            <input
              type="checkbox"
              name="flagged"
              value="true"
              defaultChecked={params.flagged === 'true'}
            />{' '}
            Condition not OK
          </label>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
        <QueueTable
          kits={kits}
          options={options}
          canReceive={canReceive}
          canRegister={canRegister}
        />
        <Pagination meta={meta as PageMeta} basePath="/lab/registration-queue" params={params} />
      </div>
    </>
  );
}
