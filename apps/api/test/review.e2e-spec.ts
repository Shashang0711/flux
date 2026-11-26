import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  FileDto,
  LabReportDto,
  ReceiveRegisterOptionsDto,
  SampleDto,
  ServiceTypeDto,
  UploadIntentDto,
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

const PDF = Buffer.from('%PDF-1.7\n%%EOF\n');
const PASSING = { org_50: 2, org_10_50: 1, e_coli: 10, enterococci: 5, v_cholerae: 'pass' };

describe('Admin review (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let lab: string; // tenant admin: uploads reports
  let reviewer: string;
  let batch: BatchDto;
  let st: ServiceTypeDto;
  let report: LabReportDto;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
  });
  const upload = async (cookie = lab): Promise<FileDto> => {
    const intent = (
      await as(cookie)
        .post('/api/v1/files', { purpose: 'LAB_REPORT', name: 'r.pdf', size: PDF.length })
        .expect(201)
    ).body.data as UploadIntentDto;
    return (
      await api()
        .put(`/api/v1${intent.uploadPath}`)
        .set('Cookie', cookie)
        .set('Content-Type', 'application/octet-stream')
        .send(PDF)
        .expect(200)
    ).body.data;
  };
  const complete = async (sampleId: string) => {
    await as(lab)
      .put(`/api/v1/samples/${sampleId}/results`, {
        results: st.parameters.map((p) => ({
          parameterId: p.id,
          value: PASSING[p.key as keyof typeof PASSING],
        })),
      })
      .expect(200);
    await as(lab).post(`/api/v1/samples/${sampleId}/complete-results`).expect(201);
  };
  const R = (path = '') => `/api/v1/lab-reports/${report.id}${path}`;
  const sample = async (i: number): Promise<SampleDto> =>
    (await as(lab).get(`/api/v1/samples/${batch.samples[i]!.id}`).expect(200)).body.data;
  const reviewerUser = async (email: string) => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'Reviewer' } });
    await createUser(prisma, { email, tenantId, roleIds: [role.id] });
    return loginCookie(app, email);
  };

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
    await createUser(prisma, { email: 'lab@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    lab = await loginCookie(app, 'lab@acme.test');
    await createRole(prisma, {
      tenantId,
      name: 'Reviewer',
      modules: ['reports'],
      permissions: ['report.review'],
    });
    reviewer = await reviewerUser('reviewer@acme.test');

    await as(lab).post('/api/v1/lab/starter-catalogue').expect(201);
    const client = (await as(lab).post('/api/v1/clients', { name: 'Alpha' }).expect(201)).body.data;
    const vessel = (
      await as(lab)
        .post('/api/v1/vessels', {
          name: 'Aegean Star',
          relationship: { clientId: client.id, relationshipTypeId: owner.id, isPrimary: true },
        })
        .expect(201)
    ).body.data;
    const options = (await as(lab).get('/api/v1/samples/receive-register-options').expect(200)).body
      .data as ReceiveRegisterOptionsDto;
    const bwk = options.kits.find((k) => k.code === 'BWK')!;
    const bw = options.serviceTypes.find((s) => s.code === 'BW')!;
    batch = (
      await as(lab)
        .post('/api/v1/samples/receive-and-register', {
          airwayBill: { number: 'AWB-V' },
          serviceTypeId: bw.id,
          samples: [1, 2].map((n) => ({
            productId: bwk.id,
            variantId: bwk.variants[0]!.id,
            vesselId: vessel.id,
            serialNumber: `V-${n}`,
            values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
          })),
        })
        .expect(201)
    ).body.data;
    st = (await as(lab).get(`/api/v1/lab/service-types/${bw.id}`).expect(200)).body.data;
    for (const s of batch.samples) await complete(s.id);
    report = (
      await as(lab)
        .post('/api/v1/lab-reports', {
          batchId: batch.id,
          sampleIds: batch.samples.map((s) => s.id),
          fileId: (await upload()).id,
        })
        .expect(201)
    ).body.data;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects with a required comment, by someone other than the uploader', async () => {
    const own = await as(lab).post(R('/reject'), { comment: 'Fix' }).expect(403);
    expect(own.body.error.message).toBe(
      'You uploaded this version; another reviewer must review it',
    );
    await as(lab).post(R('/ready-to-publish'), {}).expect(403);
    const noComment = await as(reviewer).post(R('/reject'), { comment: '  ' }).expect(400);
    expect(noComment.body.error.details[0].path).toBe('comment');

    const rejected = (
      await as(reviewer).post(R('/reject'), { comment: 'E. coli unit missing' }).expect(201)
    ).body.data as LabReportDto;
    expect(rejected.status).toBe('REJECTED');
    expect(rejected.reviews).toEqual([
      expect.objectContaining({
        decision: 'REJECTED',
        version: 1,
        comment: 'E. coli unit missing',
        reviewer: expect.any(String),
      }),
    ]);
    // Back to the lab: the samples are red again, with the report still linked.
    expect(await sample(0)).toMatchObject({ colour: 'red', labReport: { status: 'REJECTED' } });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'report.rejected' } });
    expect(audit.changes).toMatchObject({ comment: { to: 'E. coli unit missing' } });
    expect(audit.relatedIds).toEqual(expect.arrayContaining(batch.samples.map((s) => s.id)));
  });

  it('lets the lab correct results after a rejection and resubmit a new version', async () => {
    await as(reviewer).post(R('/reject'), { comment: 'Recount organisms' }).expect(201);
    const id = batch.samples[0]!.id;
    await as(lab).post(`/api/v1/samples/${id}/reopen-results`).expect(201);
    await as(lab)
      .put(`/api/v1/samples/${id}/results`, {
        results: [{ parameterId: st.parameters[0]!.id, value: 3 }],
      })
      .expect(200);

    const early = await as(lab)
      .post(R('/versions'), { fileId: (await upload()).id })
      .expect(400);
    expect(early.body.error.message).toMatch(
      /^Complete the results of S\d{2}-\d{6} before uploading/,
    );

    await as(lab).post(`/api/v1/samples/${id}/complete-results`).expect(201);
    const resubmitted = (
      await as(lab)
        .post(R('/versions'), { fileId: (await upload()).id, note: 'Recounted' })
        .expect(201)
    ).body.data as LabReportDto;
    expect(resubmitted).toMatchObject({ status: 'SUBMITTED', currentVersion: 2 });
    expect(await sample(0)).toMatchObject({ colour: 'yellow' });
    // Locked again while the corrected version is in review.
    await as(lab).post(`/api/v1/samples/${id}/reopen-results`).expect(400);
  });

  it('marks ready to publish, which freezes the report until sent back with a reason', async () => {
    const ready = (
      await as(reviewer).post(R('/ready-to-publish'), { comment: 'Looks good' }).expect(201)
    ).body.data as LabReportDto;
    expect(ready.status).toBe('READY_TO_PUBLISH');
    const listed = (
      await as(reviewer).get('/api/v1/lab-reports?status=READY_TO_PUBLISH').expect(200)
    ).body.data;
    expect(listed.map((r: { id: string }) => r.id)).toEqual([report.id]);

    await as(lab)
      .post(R('/versions'), { fileId: (await upload()).id })
      .expect(400);
    const again = await as(reviewer).post(R('/reject'), { comment: 'x' }).expect(409);
    expect(again.body.error.message).toBe('This report is ready to publish');

    await as(reviewer).post(R('/reopen-review'), { reason: '' }).expect(400);
    const reopened = (
      await as(reviewer)
        .post(R('/reopen-review'), { reason: 'Client asked for re-check' })
        .expect(201)
    ).body.data as LabReportDto;
    expect(reopened.status).toBe('SUBMITTED');
    expect(reopened.reviews.map((r) => r.decision)).toEqual(['REOPENED', 'READY_TO_PUBLISH']);
  });

  it('only one of two simultaneous decisions wins', async () => {
    const second = await reviewerUser('reviewer2@acme.test');
    const results = await Promise.all([
      as(reviewer).post(R('/ready-to-publish'), {}),
      as(second).post(R('/reject'), { comment: 'Not yet' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.labReportReview.count()).toBe(1);
  });

  it('needs report.review; other organisations cannot review', async () => {
    const role = await createRole(prisma, {
      tenantId,
      name: 'Reader',
      modules: ['reports'],
      permissions: ['report.view'],
    });
    await createUser(prisma, { email: 'read@acme.test', tenantId, roleIds: [role.id] });
    const reader = await loginCookie(app, 'read@acme.test');
    await as(reader).post(R('/ready-to-publish'), {}).expect(403);

    const other = await createTenant(prisma, { slug: 'other', modules: ['reports'] });
    await createUser(prisma, {
      email: 'admin@other.test',
      tenantId: other.id,
      roleIds: [other.adminRoleId],
    });
    const outsider = await loginCookie(app, 'admin@other.test');
    await as(outsider).post(R('/ready-to-publish'), {}).expect(404);
  });
});
