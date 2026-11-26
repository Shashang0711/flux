import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import {
  isTimeZone,
  periodOf,
  shiftPeriod,
  todayIn,
  type ColourCounts,
  type PageMeta,
  type SampleColour,
  type SampleSummaryDto,
  type SampleUpdateGridDto,
  type SampleUpdateOptionsDto,
  type SampleUpdateView,
} from '@flux/shared';
import { DataTable } from '@/components/data-table';
import { Forbidden } from '@/components/forbidden';
import { PageHeader } from '@/components/page-header';
import { Pagination, readParams } from '@/components/pagination';
import { SampleStatusBadge } from '@/components/sample-status';
import { TIME_ZONE_COOKIE } from '@/lib/time-zone';
import { loadOrNotFound, sessionWithPermission } from '@/lib/server-api';
import { ScrollToToday } from './scroll-to-today';
import styles from './sample-update.module.css';

export const metadata: Metadata = { title: 'Sample update · FLUX' };

const VIEWS: { key: SampleUpdateView; name: string }[] = [
  { key: 'monthly', name: 'Monthly' },
  { key: 'weekly', name: 'Weekly' },
  { key: 'daily', name: 'Daily' },
  { key: 'list', name: 'List' },
];

const COLOURS: { key: SampleColour; label: string }[] = [
  { key: 'red', label: 'Registered / in testing' },
  { key: 'yellow', label: 'Lab report uploaded' },
  { key: 'green', label: 'Final report published' },
];

const FILTER_KEYS = ['clientId', 'vesselId', 'serviceTypeId'] as const;

function periodLabel(view: SampleUpdateView, date: string): string {
  const fmt = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(new Date(`${d}T00:00:00Z`));
  if (view === 'daily')
    return fmt(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (view === 'weekly') {
    const { from, to } = periodOf('weekly', date);
    return `${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  return fmt(date, { month: 'long', year: 'numeric' });
}

function Counts({ counts, href, label }: { counts: ColourCounts; href?: string; label: string }) {
  const chips = COLOURS.filter((c) => counts[c.key] > 0).map((c) => (
    <span key={c.key} className={`${styles.chip} ${styles[c.key]}`}>
      {counts[c.key]}
      <span className="sr-only"> {c.label}</span>
    </span>
  ));
  if (chips.length === 0) return null;
  return href ? (
    <Link href={href} className={styles.counts} aria-label={label}>
      {chips}
    </Link>
  ) : (
    <span className={styles.counts}>{chips}</span>
  );
}

/**
 * Sample Update (design pack §9): monthly, weekly and daily grids (rows: vessel + service type,
 * samples without a vessel under their client) and a list view. Colours: red registered/testing,
 * yellow lab report uploaded, green final report published.
 */
export default async function SampleUpdatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { allowed } = await sessionWithPermission('report.view');
  if (!allowed) return <Forbidden />;
  const cookieTz = decodeURIComponent((await cookies()).get(TIME_ZONE_COOKIE)?.value ?? '');
  const timeZone = cookieTz && isTimeZone(cookieTz) ? cookieTz : 'UTC';
  const params = readParams(await searchParams, [
    'view',
    'date',
    'day',
    'colour',
    'noVessel',
    'page',
    ...FILTER_KEYS,
  ] as const);
  const view = (
    VIEWS.some((v) => v.key === params.view) ? params.view : 'monthly'
  ) as SampleUpdateView;
  const date =
    params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayIn(timeZone);
  const filters = Object.fromEntries(
    FILTER_KEYS.filter((k) => params[k]).map((k) => [k, params[k]!]),
  );

  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams({ view, date, ...filters });
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    return `/lab/sample-update?${q}`;
  };

  const { data: options } = await loadOrNotFound<SampleUpdateOptionsDto>('/sample-updates/options');
  const apiQuery = new URLSearchParams({ view, date, timeZone, ...filters });

  return (
    <>
      <PageHeader
        title="Sample update"
        description={`Every registered sample by vessel and service type, coloured by progress. Days are in ${timeZone.replace(/_/g, ' ')}.`}
      />
      <nav className={styles.views} aria-label="View">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={href({
              view: v.key,
              day: undefined,
              colour: undefined,
              page: undefined,
              noVessel: undefined,
            })}
            className={v.key === view ? styles.active : undefined}
            aria-current={v.key === view ? 'page' : undefined}
          >
            {v.name}
          </Link>
        ))}
      </nav>
      <div className="stack">
        <div className={styles.toolbar}>
          {!params.day && (
            <div className={styles.period}>
              <Link
                className="btn"
                href={href({ date: shiftPeriod(view, date, -1) })}
                aria-label="Previous period"
              >
                ‹
              </Link>
              <Link className="btn" href={href({ date: todayIn(timeZone) })}>
                Today
              </Link>
              <Link
                className="btn"
                href={href({ date: shiftPeriod(view, date, 1) })}
                aria-label="Next period"
              >
                ›
              </Link>
              <h2 className={styles.periodLabel}>
                {periodLabel(view === 'list' ? 'monthly' : view, date)}
              </h2>
            </div>
          )}
          <form className="toolbar" role="search" aria-label="Filters">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={date} />
            <select
              className="select"
              name="clientId"
              defaultValue={params.clientId ?? ''}
              aria-label="Client"
            >
              <option value="">All clients</option>
              {options.clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              name="vesselId"
              defaultValue={params.vesselId ?? ''}
              aria-label="Vessel"
            >
              <option value="">All vessels</option>
              {options.vessels.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              name="serviceTypeId"
              defaultValue={params.serviceTypeId ?? ''}
              aria-label="Service type"
            >
              <option value="">All service types</option>
              {options.serviceTypes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button className="btn" type="submit">
              Filter
            </button>
          </form>
        </div>
        <ul className={styles.legend} aria-label="Colours">
          {COLOURS.map((c) => (
            <li key={c.key}>
              <span className={`${styles.chip} ${styles[c.key]}`} aria-hidden="true" /> {c.label}
            </li>
          ))}
        </ul>
        {view === 'list' ? (
          <ListView
            query={apiQuery}
            params={params}
            href={href}
            pageParams={{
              view,
              date,
              ...filters,
              day: params.day,
              colour: params.colour,
              noVessel: params.noVessel,
            }}
          />
        ) : (
          <GridView query={apiQuery} href={href} today={todayIn(timeZone)} />
        )}
      </div>
    </>
  );
}

async function GridView({
  query,
  href,
  today,
}: {
  query: URLSearchParams;
  href: (patch: Record<string, string | undefined>) => string;
  /** Highlighted and scrolled into view. */
  today: string;
}) {
  const { data: g } = await loadOrNotFound<SampleUpdateGridDto>(`/sample-updates?${query}`);
  if (g.rows.length === 0)
    return <p className="card muted">No samples were registered in this period.</p>;
  const cellHref = (r: SampleUpdateGridDto['rows'][number], day: string) =>
    href({
      view: 'list',
      day,
      page: undefined,
      serviceTypeId: r.serviceType.id,
      clientId: r.client.id,
      vesselId: r.vessel?.id,
      noVessel: r.vessel ? undefined : 'true',
    });
  const rowName = (r: SampleUpdateGridDto['rows'][number]) => r.vessel?.name ?? r.client.name;
  const columnClass = (c: SampleUpdateGridDto['columns'][number]) =>
    [c.weekend && styles.weekend, c.key === today && styles.today].filter(Boolean).join(' ') ||
    undefined;
  return (
    <ScrollToToday>
      <div className="table-wrap">
        <table className={`table ${styles.grid}`} aria-label="Sample update">
          <thead>
            <tr>
              <th scope="col">Vessel · service</th>
              {g.columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={columnClass(c)}
                  data-today={c.key === today ? '' : undefined}
                  aria-current={c.key === today ? 'date' : undefined}
                >
                  {c.label}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">
                  {rowName(r)}
                  {!r.vessel && <span className="muted"> · no vessel</span>}
                  <span className="cell-sub">
                    {r.serviceType.name}
                    {r.vessel ? ` · ${r.client.name}` : ''}
                  </span>
                </th>
                {g.columns.map((c) => (
                  <td key={c.key} className={columnClass(c)}>
                    {r.cells[c.key] && (
                      <Counts
                        counts={r.cells[c.key]!}
                        href={cellHref(r, g.view === 'daily' ? g.from : c.key)}
                        label={`${rowName(r)}, ${r.serviceType.name}, ${c.label}: open samples`}
                      />
                    )}
                  </td>
                ))}
                <td>
                  <Counts counts={r.totals} label="Total" />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">All</th>
              <td colSpan={g.columns.length} />
              <td>
                <Counts counts={g.totals} label="Total" />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </ScrollToToday>
  );
}

async function ListView({
  query,
  params,
  href,
  pageParams,
}: {
  query: URLSearchParams;
  params: Record<string, string | undefined>;
  href: (patch: Record<string, string | undefined>) => string;
  /** Everything that defines the list, kept when paging. */
  pageParams: Record<string, string | undefined>;
}) {
  for (const k of ['day', 'colour', 'noVessel', 'page'] as const)
    if (params[k]) query.set(k, params[k]!);
  query.set('pageSize', '25');
  const { data: samples, meta } = await loadOrNotFound<SampleSummaryDto[]>(
    `/sample-updates/list?${query}`,
  );
  return (
    <>
      <div className="row">
        {params.day && (
          <span>
            Registered on <strong>{params.day}</strong> ·{' '}
            <Link href={href({ day: undefined, page: undefined })}>whole month</Link>
          </span>
        )}
        <nav className={styles.views} aria-label="Colour">
          {[{ key: undefined, label: 'All' }, ...COLOURS].map((c) => (
            <Link
              key={c.key ?? 'all'}
              href={href({
                view: 'list',
                day: params.day,
                noVessel: params.noVessel,
                colour: c.key,
                page: undefined,
              })}
              className={params.colour === c.key ? styles.active : undefined}
              aria-current={params.colour === c.key ? 'page' : undefined}
            >
              {c.label}
            </Link>
          ))}
        </nav>
      </div>
      <DataTable
        label="Samples"
        rows={samples}
        rowKey={(s) => s.id}
        empty="No samples match."
        columns={[
          {
            header: 'Sample',
            primary: true,
            cell: (s) => (
              <>
                <Link href={`/lab/samples/${s.id}`}>
                  <code>{s.code}</code>
                </Link>
                <span className="cell-sub">Batch {s.batch.code}</span>
              </>
            ),
          },
          {
            header: 'Vessel / client',
            cell: (s) => (
              <>
                {s.vessel?.name ?? <span className="muted">No vessel</span>}
                <span className="cell-sub">{s.client.name}</span>
              </>
            ),
          },
          { header: 'Service type', cell: (s) => s.serviceType.name },
          {
            header: 'Registered',
            cell: (s) =>
              new Date(s.registeredAt).toLocaleString('en-GB', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }),
          },
          {
            header: 'Status',
            cell: (s) => (
              <SampleStatusBadge
                status={s.status}
                colour={s.colour}
                reportStatus={s.labReport?.status}
              />
            ),
          },
        ]}
      />
      <Pagination meta={meta as PageMeta} basePath="/lab/sample-update" params={pageParams} />
    </>
  );
}
