import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  ClientDto,
  ReceiveRegisterOptionsDto,
  SampleSummaryDto,
  SampleUpdateGridDto,
  SampleUpdateOptionsDto,
  VesselDto,
} from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import {
  createE2eApp,
  createReferenceItem,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Sample Update (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let codes: Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', string>;

  const api = () => request(app.getHttpServer());
  const get = (url: string, cookie = admin) => api().get(url).set('Cookie', cookie);
  const grid = async (query: string): Promise<SampleUpdateGridDto> =>
    (await get(`/api/v1/sample-updates?${query}`).expect(200)).body.data;
  const list = async (query: string): Promise<SampleSummaryDto[]> =>
    (await get(`/api/v1/sample-updates/list?${query}`).expect(200)).body.data;
  const row = (g: SampleUpdateGridDto, label: string) =>
    g.rows.find(
      (r) =>
        `${r.vessel?.name ?? `${r.client.name} (no vessel)`} · ${r.serviceType.name}` === label,
    )!;

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const owner = await createReferenceItem(prisma, {
      list: 'vessel-relationship-type',
      code: 'OWNER',
      name: 'Ship Owner',
    });
    const tenant = await createTenant(prisma, {
      slug: 'acme',
      modules: ['receiving', 'samples', 'lab-setup', 'clients', 'vessels', 'reports'],
    });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
    const post = (url: string, body: object) => api().post(url).set('Cookie', admin).send(body);
    await post('/api/v1/lab/starter-catalogue', {}).expect(201);
    const alpha = (await post('/api/v1/clients', { name: 'Alpha Owners' }).expect(201)).body
      .data as ClientDto;
    const beta = (await post('/api/v1/clients', { name: 'Beta Management' }).expect(201)).body
      .data as ClientDto;
    const link = { clientId: alpha.id, relationshipTypeId: owner.id, isPrimary: true };
    const star = (
      await post('/api/v1/vessels', { name: 'Aegean Star', relationship: link }).expect(201)
    ).body.data as VesselDto;
    const wind = (
      await post('/api/v1/vessels', { name: 'Baltic Wind', relationship: link }).expect(201)
    ).body.data as VesselDto;
    const options = (await get('/api/v1/samples/receive-register-options').expect(200)).body
      .data as ReceiveRegisterOptionsDto;
    const kit = (code: string) => options.kits.find((k) => k.code === code)!;
    const st = (code: string) => options.serviceTypes.find((s) => s.code === code)!;

    // Ballast water: A, B, F on Aegean Star; C on Baltic Wind; E on Aegean Star in December.
    const bw = (
      await post('/api/v1/samples/receive-and-register', {
        airwayBill: { number: 'AWB-SU1' },
        serviceTypeId: st('BW').id,
        samples: [star, star, wind, star, star].map((v) => ({
          productId: kit('BWK').id,
          variantId: kit('BWK').variants[0]!.id,
          vesselId: v.id,
          values: { sampling_point: 'intake', date_sampled: '2026-11-01' },
        })),
      }).expect(201)
    ).body.data as BatchDto;
    // Potable water without a vessel (client Beta): D.
    const pw = (
      await post('/api/v1/samples/receive-and-register', {
        airwayBill: { number: 'AWB-SU2' },
        serviceTypeId: st('PW').id,
        samples: [
          {
            productId: kit('WQK').id,
            clientId: beta.id,
            values: { sampling_point: 'Galley', date_sampled: '2026-11-26' },
          },
        ],
      }).expect(201)
    ).body.data as BatchDto;
    const [A, B, C, F, E] = bw.samples;
    const [D] = pw.samples;
    codes = { A: A!.code, B: B!.code, C: C!.code, D: D!.code, E: E!.code, F: F!.code };

    // Fixed registration times (UTC).
    const at: [string, string][] = [
      [A!.id, '2026-11-03T10:00:00Z'],
      [B!.id, '2026-11-03T12:00:00Z'],
      [F!.id, '2026-11-03T14:00:00Z'],
      [C!.id, '2026-11-10T09:00:00Z'],
      [D!.id, '2026-11-26T23:30:00Z'], // 27 Nov 05:00 in India
      [E!.id, '2026-12-01T08:00:00Z'],
    ];
    for (const [id, when] of at)
      await prisma.sample.update({ where: { id }, data: { registeredAt: new Date(when) } });

    // Report states: B in review (yellow), C published (green), F rejected (red again).
    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        purpose: 'FINAL_REPORT',
        status: 'READY',
        name: 'f.pdf',
        size: 1,
        contentType: 'application/pdf',
        sha256: '0'.repeat(64),
        storageKey: `${tenantId}/${randomUUID()}`,
        uploadedAt: new Date(),
      },
    });
    const reports: [string, 'SUBMITTED' | 'PUBLISHED' | 'REJECTED'][] = [
      [B!.id, 'SUBMITTED'],
      [C!.id, 'PUBLISHED'],
      [F!.id, 'REJECTED'],
    ];
    for (const [i, [sampleId, status]] of reports.entries()) {
      const r = await prisma.labReport.create({
        data: {
          tenantId,
          code: `LR26-0000${i + 1}`,
          batchId: bw.id,
          serviceTypeId: st('BW').id,
          status,
          ...(status === 'PUBLISHED' ? { publishedAt: new Date(), finalFileId: file.id } : {}),
        },
      });
      await prisma.labReportSample.create({
        data: { tenantId, reportId: r.id, batchId: bw.id, sampleId },
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('monthly: rows per vessel and service type, samples without vessel last, counts per colour', async () => {
    const g = await grid('view=monthly&date=2026-11-15&timeZone=UTC');
    expect(g).toMatchObject({
      view: 'monthly',
      from: '2026-11-01',
      to: '2026-11-30',
      timeZone: 'UTC',
    });
    expect(g.columns).toHaveLength(30);
    expect(g.columns[0]).toEqual({ key: '2026-11-01', label: '1', weekend: true }); // a Sunday
    expect(
      g.rows.map(
        (r) => `${r.vessel?.name ?? `${r.client.name} (no vessel)`} · ${r.serviceType.name}`,
      ),
    ).toEqual([
      'Aegean Star · Ballast Water',
      'Baltic Wind · Ballast Water',
      'Beta Management (no vessel) · Potable Water',
    ]);
    expect(row(g, 'Aegean Star · Ballast Water').cells).toEqual({
      '2026-11-03': { red: 2, yellow: 1, green: 0 },
    });
    expect(row(g, 'Baltic Wind · Ballast Water').cells).toEqual({
      '2026-11-10': { red: 0, yellow: 0, green: 1 },
    });
    expect(row(g, 'Beta Management (no vessel) · Potable Water').cells).toEqual({
      '2026-11-26': { red: 1, yellow: 0, green: 0 },
    });
    expect(g.totals).toEqual({ red: 3, yellow: 1, green: 1 }); // E (December) is not counted
  });

  it('places samples by the viewer’s time zone (days and hours)', async () => {
    const india = await grid('view=monthly&date=2026-11-15&timeZone=Asia/Kolkata');
    expect(Object.keys(row(india, 'Beta Management (no vessel) · Potable Water').cells)).toEqual([
      '2026-11-27',
    ]);
    const utcDay = await grid('view=daily&date=2026-11-26&timeZone=UTC');
    expect(utcDay.columns).toHaveLength(24);
    expect(utcDay.rows[0]!.cells).toEqual({ '23': { red: 1, yellow: 0, green: 0 } });
    const indiaDay = await grid('view=daily&date=2026-11-27&timeZone=Asia/Kolkata');
    expect(indiaDay.rows[0]!.cells).toEqual({ '05': { red: 1, yellow: 0, green: 0 } });
  });

  it('weekly: Monday to Sunday around the date', async () => {
    const g = await grid('view=weekly&date=2026-11-04&timeZone=UTC');
    expect([g.from, g.to]).toEqual(['2026-11-02', '2026-11-08']);
    expect(g.rows.map((r) => r.vessel?.name)).toEqual(['Aegean Star']);
  });

  it('uses the same colours as the rest of the app, and filters the list view', async () => {
    const samples = (await get('/api/v1/samples?pageSize=100').expect(200)).body
      .data as SampleSummaryDto[];
    const colourOf = Object.fromEntries(samples.map((s) => [s.code, s.colour]));
    expect([colourOf[codes.A], colourOf[codes.B], colourOf[codes.C], colourOf[codes.F]]).toEqual([
      'red',
      'yellow',
      'green',
      'red',
    ]);

    const month = 'date=2026-11-15&timeZone=UTC';
    expect((await list(`${month}`)).map((s) => s.code).sort()).toEqual(
      [codes.A, codes.B, codes.C, codes.D, codes.F].sort(),
    );
    expect((await list(`${month}&colour=red`)).map((s) => s.code).sort()).toEqual(
      [codes.A, codes.D, codes.F].sort(),
    );
    expect((await list(`${month}&colour=yellow`)).map((s) => s.code)).toEqual([codes.B]);
    expect((await list(`${month}&colour=green`)).map((s) => s.code)).toEqual([codes.C]);
    expect((await list('day=2026-11-03&timeZone=UTC')).map((s) => s.code).sort()).toEqual(
      [codes.A, codes.B, codes.F].sort(),
    );
    expect((await list(`${month}&noVessel=true`)).map((s) => s.code)).toEqual([codes.D]);
    expect((await list('day=2026-11-27&timeZone=Asia/Kolkata')).map((s) => s.code)).toEqual([
      codes.D,
    ]);
    const paged = (await get(`/api/v1/sample-updates/list?${month}&pageSize=2`).expect(200)).body;
    expect(paged.meta).toMatchObject({ total: 5, totalPages: 3 });
  });

  it('offers the clients, vessels and service types that have samples', async () => {
    const o = (await get('/api/v1/sample-updates/options').expect(200)).body
      .data as SampleUpdateOptionsDto;
    expect(o.vessels.map((v) => v.name)).toEqual(['Aegean Star', 'Baltic Wind']);
    expect(o.clients.map((c) => c.name)).toEqual(['Alpha Owners', 'Beta Management']);
    expect(o.serviceTypes.map((s) => s.name)).toEqual(['Ballast Water', 'Potable Water']);
  });

  it('rejects unknown time zones, needs report.view, and shows only the organisation’s samples', async () => {
    const bad = await get('/api/v1/sample-updates?timeZone=Mars/Olympus').expect(400);
    expect(bad.body.error.details[0]).toEqual({ path: 'timeZone', message: 'Unknown time zone' });

    const role = await createRole(prisma, {
      tenantId,
      name: 'Tester',
      modules: ['samples'],
      permissions: ['sample.view'],
    });
    await createUser(prisma, { email: 'tester@acme.test', tenantId, roleIds: [role.id] });
    await get('/api/v1/sample-updates', await loginCookie(app, 'tester@acme.test')).expect(403);

    const other = await createTenant(prisma, { slug: 'other', modules: ['samples', 'reports'] });
    await createUser(prisma, {
      email: 'admin@other.test',
      tenantId: other.id,
      roleIds: [other.adminRoleId],
    });
    const outsider = await loginCookie(app, 'admin@other.test');
    const g = (await get('/api/v1/sample-updates?date=2026-11-15', outsider).expect(200)).body
      .data as SampleUpdateGridDto;
    expect(g.rows).toEqual([]);
  });
});
