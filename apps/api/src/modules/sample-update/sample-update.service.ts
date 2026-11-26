import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  daysBetween,
  periodOf,
  todayIn,
  type ColourCounts,
  type PageQuery,
  type SampleColour,
  type SampleSummaryDto,
  type SampleUpdateGridDto,
  type SampleUpdateOptionsDto,
  type SampleUpdateQuery,
  type SampleUpdateRowDto,
} from '@flux/shared';
import { Paginated, toSkipTake } from '../../common/pagination/pagination';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import { SAMPLE_INCLUDE, toSampleSummaryDto } from '../samples/samples.mapper';
import type { TenantContext } from '../auth/auth.types';

const empty = (): ColourCounts => ({ red: 0, yellow: 0, green: 0 });

/**
 * The colour rule in SQL — must match sampleColour() in @flux/shared: no report or a rejected
 * one = red, published = green, any other report status = yellow.
 */
const COLOUR_SQL = Prisma.sql`CASE
    WHEN r.status = 'PUBLISHED' THEN 'green'
    WHEN r.status IS NULL OR r.status = 'REJECTED' THEN 'red'
    ELSE 'yellow' END`;

/** The same rule as Prisma filters, for the list view. */
function colourWhere(colour: SampleColour): Prisma.SampleWhereInput {
  if (colour === 'green') return { labReportLinks: { some: { report: { status: 'PUBLISHED' } } } };
  if (colour === 'yellow') {
    return {
      labReportLinks: { some: { report: { status: { in: ['SUBMITTED', 'READY_TO_PUBLISH'] } } } },
    };
  }
  return {
    OR: [
      { labReportLinks: { none: {} } },
      { labReportLinks: { some: { report: { status: 'REJECTED' } } } },
    ],
  };
}

const weekday = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay();

/**
 * Sample Update (design pack §9): one API for the monthly, weekly, daily and list views. Samples
 * are placed by their registration time in the viewer's time zone.
 */
@Injectable()
export class SampleUpdateService {
  constructor(private readonly db: TenantDb) {}

  grid(ctx: TenantContext, q: SampleUpdateQuery): Promise<SampleUpdateGridDto> {
    const view = q.view === 'list' ? 'monthly' : q.view;
    const { from, to } = periodOf(view, q.date ?? todayIn(q.timeZone));
    return this.db.run(ctx.tenantId, async (tx) => {
      // registered_at is stored as UTC (timestamp without time zone).
      const local = Prisma.sql`((s.registered_at AT TIME ZONE 'UTC') AT TIME ZONE ${q.timeZone})`;
      const bucket =
        view === 'daily'
          ? Prisma.sql`to_char(${local}, 'HH24')`
          : Prisma.sql`to_char(${local}, 'YYYY-MM-DD')`;
      const rows = await tx.$queryRaw<
        {
          vessel_id: string | null;
          client_id: string;
          service_type_id: string;
          bucket: string;
          colour: SampleColour;
          n: number;
        }[]
      >`
        SELECT s.vessel_id, s.client_id, s.service_type_id, ${bucket} AS bucket, ${COLOUR_SQL} AS colour,
               count(*)::int AS n
          FROM samples s
          LEFT JOIN lab_report_samples ls ON ls.sample_id = s.id
          LEFT JOIN lab_reports r ON r.id = ls.report_id
         WHERE ${local} >= ${from}::date
           AND ${local} < (${to}::date + 1)
           ${q.clientId ? Prisma.sql`AND s.client_id = ${q.clientId}::uuid` : Prisma.empty}
           ${q.vesselId ? Prisma.sql`AND s.vessel_id = ${q.vesselId}::uuid` : Prisma.empty}
           ${q.serviceTypeId ? Prisma.sql`AND s.service_type_id = ${q.serviceTypeId}::uuid` : Prisma.empty}
         GROUP BY 1, 2, 3, 4, 5`;

      const names = await this.names(tx, rows);
      const byKey = new Map<string, SampleUpdateRowDto>();
      const totals = empty();
      for (const r of rows) {
        const key = `${r.vessel_id ?? 'none'}|${r.client_id}|${r.service_type_id}`;
        let row = byKey.get(key);
        if (!row) {
          row = {
            key,
            vessel: r.vessel_id
              ? { id: r.vessel_id, name: names.vessels.get(r.vessel_id) ?? '' }
              : null,
            client: { id: r.client_id, name: names.clients.get(r.client_id) ?? '' },
            serviceType: {
              id: r.service_type_id,
              name: names.serviceTypes.get(r.service_type_id) ?? '',
            },
            cells: {},
            totals: empty(),
          };
          byKey.set(key, row);
        }
        const cell = (row.cells[r.bucket] ??= empty());
        cell[r.colour] += r.n;
        row.totals[r.colour] += r.n;
        totals[r.colour] += r.n;
      }
      // Vessel rows first (by vessel, service type); then samples without a vessel, by client.
      const sorted = [...byKey.values()].sort(
        (a, b) =>
          Number(a.vessel === null) - Number(b.vessel === null) ||
          (a.vessel?.name ?? a.client.name).localeCompare(b.vessel?.name ?? b.client.name) ||
          a.client.name.localeCompare(b.client.name) ||
          a.serviceType.name.localeCompare(b.serviceType.name),
      );
      const columns =
        view === 'daily'
          ? Array.from({ length: 24 }, (_, h) => {
              const key = String(h).padStart(2, '0');
              return { key, label: `${key}:00`, weekend: false };
            })
          : daysBetween(from, to).map((day) => ({
              key: day,
              label: String(Number(day.slice(8))),
              weekend: weekday(day) === 0 || weekday(day) === 6,
            }));
      return { view, from, to, timeZone: q.timeZone, columns, rows: sorted, totals };
    });
  }

  /** The list view: samples of the period (or one day), newest first. */
  list(
    ctx: TenantContext,
    q: SampleUpdateQuery,
    page: PageQuery,
  ): Promise<Paginated<SampleSummaryDto>> {
    const { from, to } = q.day
      ? { from: q.day, to: q.day }
      : periodOf('monthly', q.date ?? todayIn(q.timeZone));
    return this.db.run(ctx.tenantId, async (tx) => {
      // Period bounds in the viewer's time zone, as UTC instants.
      const [bounds] = await tx.$queryRaw<{ start: Date; end: Date }[]>`
        SELECT (${from}::date::timestamp AT TIME ZONE ${q.timeZone}) AT TIME ZONE 'UTC' AS start,
               ((${to}::date + 1)::timestamp AT TIME ZONE ${q.timeZone}) AT TIME ZONE 'UTC' AS end`;
      const where: Prisma.SampleWhereInput = {
        registeredAt: { gte: bounds!.start, lt: bounds!.end },
        ...(q.clientId ? { clientId: q.clientId } : {}),
        ...(q.vesselId ? { vesselId: q.vesselId } : {}),
        ...(q.noVessel ? { vesselId: null } : {}),
        ...(q.serviceTypeId ? { serviceTypeId: q.serviceTypeId } : {}),
        ...(q.colour ? colourWhere(q.colour) : {}),
      };
      const [rows, total] = await Promise.all([
        tx.sample.findMany({
          where,
          include: SAMPLE_INCLUDE,
          orderBy: [{ registeredAt: 'desc' }, { code: 'desc' }],
          ...toSkipTake(page),
        }),
        tx.sample.count({ where }),
      ]);
      return new Paginated(rows.map(toSampleSummaryDto), total, page);
    });
  }

  options(ctx: TenantContext): Promise<SampleUpdateOptionsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const REF = { id: true, name: true } as const;
      const [clients, vessels, serviceTypes] = await Promise.all([
        tx.client.findMany({
          where: { samples: { some: {} } },
          select: REF,
          orderBy: { name: 'asc' },
        }),
        tx.vessel.findMany({
          where: { samples: { some: {} } },
          select: REF,
          orderBy: { name: 'asc' },
        }),
        tx.serviceType.findMany({
          where: { samples: { some: {} } },
          select: REF,
          orderBy: { name: 'asc' },
        }),
      ]);
      return { clients, vessels, serviceTypes };
    });
  }

  private async names(
    tx: TenantTx,
    rows: { vessel_id: string | null; client_id: string; service_type_id: string }[],
  ) {
    const ids = (pick: (r: (typeof rows)[number]) => string | null) => [
      ...new Set(rows.map(pick).filter((x): x is string => Boolean(x))),
    ];
    const [vessels, clients, serviceTypes] = await Promise.all([
      tx.vessel.findMany({
        where: { id: { in: ids((r) => r.vessel_id) } },
        select: { id: true, name: true },
      }),
      tx.client.findMany({
        where: { id: { in: ids((r) => r.client_id) } },
        select: { id: true, name: true },
      }),
      tx.serviceType.findMany({
        where: { id: { in: ids((r) => r.service_type_id) } },
        select: { id: true, name: true },
      }),
    ]);
    const map = (list: { id: string; name: string }[]) => new Map(list.map((x) => [x.id, x.name]));
    return { vessels: map(vessels), clients: map(clients), serviceTypes: map(serviceTypes) };
  }
}
