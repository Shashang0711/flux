import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  ClientDto,
  PortalOverviewDto,
  PortalReportDetailDto,
  PortalReportDto,
  PortalSampleDetailDto,
  PortalSampleDto,
  PortalUserDto,
  ReceiveRegisterOptionsDto,
  SessionInfo,
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

const PORTAL_PASSWORD = 'portal-pass-123';

describe('Client portal (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let alpha: ClientDto;
  let beta: ClientDto;
  let ids: Record<'A' | 'B' | 'C' | 'X' | 'D', string>;
  let reports: { submitted: string; published: string };

  const api = () => request(app.getHttpServer());
  const get = (url: string, cookie: string) => api().get(`/api/v1${url}`).set('Cookie', cookie);
  const post = (url: string, body: object, cookie = admin) =>
    api().post(`/api/v1${url}`).set('Cookie', cookie).send(body);
  const patch = (url: string, body: object, cookie = admin) =>
    api().patch(`/api/v1${url}`).set('Cookie', cookie).send(body);

  const addPortalUser = async (client: ClientDto, email: string): Promise<PortalUserDto> =>
    (
      await post(`/clients/${client.id}/portal-users`, {
        email,
        name: email.split('@')[0],
        password: PORTAL_PASSWORD,
      }).expect(201)
    ).body.data;
  const portalLogin = (email: string) => loginCookie(app, email, PORTAL_PASSWORD);

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
      modules: [
        'receiving',
        'samples',
        'lab-setup',
        'clients',
        'vessels',
        'reports',
        'client-portal',
      ],
    });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
    await post('/lab/starter-catalogue', {}).expect(201);
    alpha = (await post('/clients', { name: 'Alpha Owners' }).expect(201)).body.data;
    beta = (await post('/clients', { name: 'Beta Management' }).expect(201)).body.data;
    const link = { clientId: alpha.id, relationshipTypeId: owner.id, isPrimary: true };
    const star = (await post('/vessels', { name: 'Aegean Star', relationship: link }).expect(201))
      .body.data as VesselDto;
    const wind = (await post('/vessels', { name: 'Baltic Wind', relationship: link }).expect(201))
      .body.data as VesselDto;
    const options = (await get('/samples/receive-register-options', admin).expect(200)).body
      .data as ReceiveRegisterOptionsDto;
    const kit = (code: string) => options.kits.find((k) => k.code === code)!;
    const st = (code: string) => options.serviceTypes.find((s) => s.code === code)!;

    // Alpha, ballast water: A received, B in testing, C reported (awaiting review).
    const bw = (
      await post('/samples/receive-and-register', {
        airwayBill: { number: 'AWB-P1' },
        serviceTypeId: st('BW').id,
        samples: [star, star, wind].map((v) => ({
          productId: kit('BWK').id,
          variantId: kit('BWK').variants[0]!.id,
          vesselId: v.id,
          values: { sampling_point: 'intake', date_sampled: '2026-11-01' },
        })),
      }).expect(201)
    ).body.data as BatchDto;
    // Potable water without vessel: X (Alpha) and D (Beta), both in one published report.
    const pw = (
      await post('/samples/receive-and-register', {
        airwayBill: { number: 'AWB-P2' },
        serviceTypeId: st('PW').id,
        samples: [alpha, beta].map((c) => ({
          productId: kit('WQK').id,
          clientId: c.id,
          values: { sampling_point: 'Galley', date_sampled: '2026-11-20' },
        })),
      }).expect(201)
    ).body.data as BatchDto;
    const [A, B, C] = bw.samples;
    const [X, D] = pw.samples;
    ids = { A: A!.id, B: B!.id, C: C!.id, X: X!.id, D: D!.id };

    await prisma.sample.update({ where: { id: B!.id }, data: { status: 'UNDER_TESTING' } });
    for (const id of [C!.id, X!.id, D!.id]) {
      await prisma.sample.update({ where: { id }, data: { status: 'RESULTS_ENTERED' } });
    }
    const coli = await prisma.testParameter.findFirstOrThrow({
      where: { serviceTypeId: st('PW').id, key: 'e_coli' },
    });
    await prisma.sampleResult.create({
      data: {
        tenantId,
        sampleId: X!.id,
        serviceTypeId: st('PW').id,
        parameterId: coli.id,
        valueNumber: 3,
        flag: 'CAUTION',
      },
    });

    const file = await prisma.storedFile.create({
      data: {
        tenantId,
        purpose: 'FINAL_REPORT',
        status: 'READY',
        name: 'final.pdf',
        size: 1,
        contentType: 'application/pdf',
        sha256: '0'.repeat(64),
        storageKey: `${tenantId}/${randomUUID()}`,
        uploadedAt: new Date(),
      },
    });
    const submitted = await prisma.labReport.create({
      data: { tenantId, code: 'LR26-00001', batchId: bw.id, serviceTypeId: st('BW').id },
    });
    await prisma.labReportSample.create({
      data: { tenantId, reportId: submitted.id, batchId: bw.id, sampleId: C!.id },
    });
    const published = await prisma.labReport.create({
      data: {
        tenantId,
        code: 'LR26-00002',
        batchId: pw.id,
        serviceTypeId: st('PW').id,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        finalFileId: file.id,
      },
    });
    for (const sampleId of [X!.id, D!.id]) {
      await prisma.labReportSample.create({
        data: { tenantId, reportId: published.id, batchId: pw.id, sampleId },
      });
    }
    reports = { submitted: submitted.id, published: published.id };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('portal users (client page)', () => {
    it('creates client logins that stay off the staff Users page and never get roles', async () => {
      const user = await addPortalUser(alpha, 'Olivia@Alpha.test');
      expect(user).toMatchObject({ email: 'olivia@alpha.test', name: 'Olivia', status: 'ACTIVE' });
      const listed = (await get(`/clients/${alpha.id}/portal-users`, admin).expect(200)).body.data;
      expect(listed.map((u: PortalUserDto) => u.email)).toEqual(['olivia@alpha.test']);
      expect((await get(`/clients/${beta.id}/portal-users`, admin).expect(200)).body.data).toEqual(
        [],
      );

      // Not a staff user: hidden from /users and its actions.
      const staff = (await get('/users', admin).expect(200)).body.data;
      expect(staff.map((u: { email: string }) => u.email)).toEqual(['admin@acme.test']);
      await get(`/users/${user.id}`, admin).expect(404);
      await api()
        .put(`/api/v1/users/${user.id}/roles`)
        .set('Cookie', admin)
        .send({ roleIds: [] })
        .expect(404);
      await post(`/users/${user.id}/reset-password`, { password: 'whatever-123' }).expect(404);
      const role = await prisma.role.findFirstOrThrow({ where: { tenantId, isSystem: true } });
      await post(`/roles/${role.id}/users`, { userIds: [user.id] }).expect(400);
      // The database refuses it too.
      await expect(
        prisma.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id } }),
      ).rejects.toThrow(/cannot be given roles/);
      await expect(
        prisma.user.update({ where: { id: user.id }, data: { clientId: beta.id } }),
      ).rejects.toThrow(/client cannot change/);

      // Audited on the client.
      const audit = (await get(`/audit-logs?entityId=${alpha.id}`, admin).expect(200)).body.data;
      expect(audit[0]).toMatchObject({ action: 'user.created', entity: { id: user.id } });
    });

    it('edits, disables (signing out) and resets the password of a portal user', async () => {
      const user = await addPortalUser(alpha, 'olivia@alpha.test');
      const cookie = await portalLogin('olivia@alpha.test');
      await get('/auth/me', cookie).expect(200);

      await patch(`/clients/${alpha.id}/portal-users/${user.id}`, { name: 'Olivia Ng' }).expect(
        200,
      );
      // Wrong client: not found.
      await patch(`/clients/${beta.id}/portal-users/${user.id}`, { name: 'X' }).expect(404);
      await patch(`/clients/${alpha.id}/portal-users/${user.id}`, { status: 'DISABLED' }).expect(
        200,
      );
      await get('/auth/me', cookie).expect(401);
      await post('/auth/login', { email: 'olivia@alpha.test', password: PORTAL_PASSWORD }).expect(
        401,
      );
      await patch(`/clients/${alpha.id}/portal-users/${user.id}`, { status: 'ACTIVE' }).expect(200);
      await post(`/clients/${alpha.id}/portal-users/${user.id}/reset-password`, {
        password: 'brand-new-pass',
      }).expect(204);
      await loginCookie(app, 'olivia@alpha.test', 'brand-new-pass');
    });

    it('validates input and requires permissions and the module', async () => {
      await addPortalUser(alpha, 'olivia@alpha.test');
      // Emails are unique across staff and portal users.
      const dup = await post(`/clients/${beta.id}/portal-users`, {
        email: 'admin@acme.test',
        name: 'Dup',
        password: PORTAL_PASSWORD,
      }).expect(409);
      expect(dup.body.error.code).toBe('CONFLICT');
      await post(`/clients/${beta.id}/portal-users`, {
        email: 'bad',
        name: '',
        password: 'short',
      }).expect(400);
      await patch(`/clients/${beta.id}`, { status: 'INACTIVE' }).expect(200);
      await post(`/clients/${beta.id}/portal-users`, {
        email: 'b@beta.test',
        name: 'B',
        password: PORTAL_PASSWORD,
      }).expect(409);

      const viewer = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['clients', 'administration'],
        permissions: ['client.view', 'user.view'],
      });
      await createUser(prisma, { email: 'viewer@acme.test', tenantId, roleIds: [viewer.id] });
      const v = await loginCookie(app, 'viewer@acme.test');
      await get(`/clients/${alpha.id}/portal-users`, v).expect(200);
      await post(
        `/clients/${alpha.id}/portal-users`,
        { email: 'v@alpha.test', name: 'V', password: PORTAL_PASSWORD },
        v,
      ).expect(403);

      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'client-portal' } });
      await get(`/clients/${alpha.id}/portal-users`, admin).expect(403);
    });
  });

  describe('as a client user', () => {
    let olivia: string;
    beforeEach(async () => {
      await addPortalUser(alpha, 'olivia@alpha.test');
      olivia = await portalLogin('olivia@alpha.test');
    });

    it('has fixed client access and is refused every staff route', async () => {
      const me = (await get('/auth/me', olivia).expect(200)).body.data as SessionInfo;
      expect(me.client).toEqual({ id: alpha.id, code: alpha.code, name: 'Alpha Owners' });
      expect(me.user.clientId).toBe(alpha.id);
      expect(me.access).toEqual({
        portals: ['CLIENT'],
        modules: ['client-portal'],
        permissions: ['client-portal.view'],
        defaultPortal: 'CLIENT',
      });
      for (const url of [
        '/samples',
        `/clients/${alpha.id}`,
        '/reference-data',
        '/custom-fields',
        `/lab-reports/${reports.published}`,
        '/sample-updates?view=monthly',
      ]) {
        const res = await get(url, olivia).expect(403);
        expect(res.body.error.message).toBe('This is not available in the client portal');
      }
      await post('/files', { purpose: 'LAB_REPORT', name: 'x.pdf', size: 1 }, olivia).expect(403);
      // Own password still works.
      await post(
        '/auth/change-password',
        { currentPassword: PORTAL_PASSWORD, newPassword: 'olivia-new-pass' },
        olivia,
      ).expect(204);
    });

    it('overview and samples: only samples registered to the client, with portal status', async () => {
      const overview = (await get('/portal/overview', olivia).expect(200)).body
        .data as PortalOverviewDto;
      expect(overview).toMatchObject({
        client: { id: alpha.id, name: 'Alpha Owners' },
        counts: { RECEIVED: 1, IN_TESTING: 2, PUBLISHED: 1 },
        vesselCount: 2,
      });
      expect(overview.recentReports.map((r) => r.code)).toEqual(['LR26-00002']);

      const samples = (await get('/portal/samples', olivia).expect(200)).body
        .data as PortalSampleDto[];
      const byId = Object.fromEntries(samples.map((s) => [s.id, s]));
      expect(Object.keys(byId).sort()).toEqual([ids.A, ids.B, ids.C, ids.X].sort());
      expect(byId[ids.A]).toMatchObject({ status: 'RECEIVED', report: null, worstFlag: null });
      expect(byId[ids.B]!.status).toBe('IN_TESTING');
      // In a report awaiting review: still "in testing", report not shown.
      expect(byId[ids.C]).toMatchObject({ status: 'IN_TESTING', report: null });
      expect(byId[ids.X]).toMatchObject({
        status: 'PUBLISHED',
        report: { id: reports.published, code: 'LR26-00002' },
        worstFlag: 'CAUTION',
        vessel: null,
      });

      const published = (await get('/portal/samples?status=PUBLISHED', olivia).expect(200)).body;
      expect(published.data.map((s: PortalSampleDto) => s.id)).toEqual([ids.X]);
      const testing = (await get('/portal/samples?status=IN_TESTING', olivia).expect(200)).body;
      expect(testing.meta.total).toBe(2);
      const options = (await get('/portal/options', olivia).expect(200)).body.data;
      expect(options.vessels.map((v: { name: string }) => v.name)).toEqual([
        'Aegean Star',
        'Baltic Wind',
      ]);
      const wind = options.vessels[1].id;
      const onWind = (await get(`/portal/samples?vesselId=${wind}`, olivia).expect(200)).body.data;
      expect(onWind.map((s: PortalSampleDto) => s.id)).toEqual([ids.C]);
      await get('/portal/samples?status=GREEN', olivia).expect(400);
    });

    it('sample detail: results only once published; other clients’ samples are not found', async () => {
      const x = (await get(`/portal/samples/${ids.X}`, olivia).expect(200)).body
        .data as PortalSampleDetailDto;
      expect(x.results).toEqual([
        expect.objectContaining({ parameter: 'E. coli', value: '3', flag: 'CAUTION' }),
      ]);
      const c = (await get(`/portal/samples/${ids.C}`, olivia).expect(200)).body
        .data as PortalSampleDetailDto;
      expect(c.results).toBeNull();
      await get(`/portal/samples/${ids.D}`, olivia).expect(404);
    });

    it('reports: published only, limited to the client’s own samples', async () => {
      const list = (await get('/portal/reports', olivia).expect(200)).body
        .data as PortalReportDto[];
      expect(list).toEqual([
        expect.objectContaining({
          id: reports.published,
          code: 'LR26-00002',
          sampleCount: 1,
          vessels: [],
          worstFlag: 'CAUTION',
        }),
      ]);
      const detail = (await get(`/portal/reports/${reports.published}`, olivia).expect(200)).body
        .data as PortalReportDetailDto;
      expect(detail.samples.map((s) => s.id)).toEqual([ids.X]);
      const link = (
        await get(`/portal/reports/${reports.published}/download-link`, olivia).expect(200)
      ).body.data;
      expect(link.path).toMatch(/^\/files\/[0-9a-f-]+\/download\?expires=\d+&token=/);

      await get(`/portal/reports/${reports.submitted}`, olivia).expect(404);
      await get(`/portal/reports/${reports.submitted}/download-link`, olivia).expect(404);

      // Beta sees the same report with only its own sample.
      await addPortalUser(beta, 'ben@beta.test');
      const ben = await portalLogin('ben@beta.test');
      const forBeta = (await get(`/portal/reports/${reports.published}`, ben).expect(200)).body
        .data as PortalReportDetailDto;
      expect(forBeta.samples.map((s) => s.id)).toEqual([ids.D]);
      expect(forBeta.worstFlag).toBeNull();
      const betaSamples = (await get('/portal/samples', ben).expect(200)).body.data;
      expect(betaSamples.map((s: PortalSampleDto) => s.id)).toEqual([ids.D]);
    });

    it('loses access when the client is made inactive', async () => {
      await patch(`/clients/${alpha.id}`, { status: 'INACTIVE' }).expect(200);
      await get('/portal/overview', olivia).expect(401);
      const res = await post('/auth/login', {
        email: 'olivia@alpha.test',
        password: PORTAL_PASSWORD,
      }).expect(403);
      expect(res.body.error.message).toBe('Portal access for your company is not active');
    });
  });

  it('staff cannot use the portal API, even with the permission', async () => {
    const res = await get('/portal/overview', admin).expect(403);
    expect(res.body.error.message).toBe('The client portal is for client users');
  });
});
