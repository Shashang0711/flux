import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BatchDto,
  DownloadLinkDto,
  FileDto,
  LabReportDto,
  ReceiveRegisterOptionsDto,
  SampleAttachmentDto,
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

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('Files, lab reports and attachments (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let batch: BatchDto;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
    del: (url: string) => api().delete(url).set('Cookie', cookie),
  });

  /** Staged upload: intent, then the raw bytes. */
  const upload = async (
    purpose: 'LAB_REPORT' | 'RESULT_ATTACHMENT',
    name: string,
    body: Buffer,
    cookie = admin,
  ): Promise<FileDto> => {
    const intent = (
      await as(cookie).post('/api/v1/files', { purpose, name, size: body.length }).expect(201)
    ).body.data as UploadIntentDto;
    const res = await api()
      .put(`/api/v1${intent.uploadPath}`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(body);
    expect(res.status).toBe(200);
    return res.body.data;
  };
  const download = (link: DownloadLinkDto) =>
    api()
      .get(`/api/v1${link.path}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
  const report = (sampleIndexes: number[], fileId: string) =>
    as(admin).post('/api/v1/lab-reports', {
      batchId: batch.id,
      sampleIds: sampleIndexes.map((i) => batch.samples[i]!.id),
      fileId,
      note: 'First issue',
    });

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
    await as(admin).post('/api/v1/lab/starter-catalogue').expect(201);
    const client = (await as(admin).post('/api/v1/clients', { name: 'Alpha' }).expect(201)).body
      .data;
    const vessel = (
      await as(admin)
        .post('/api/v1/vessels', {
          name: 'Aegean Star',
          relationship: { clientId: client.id, relationshipTypeId: owner.id, isPrimary: true },
        })
        .expect(201)
    ).body.data;
    const options = (await as(admin).get('/api/v1/samples/receive-register-options').expect(200))
      .body.data as ReceiveRegisterOptionsDto;
    const bwk = options.kits.find((k) => k.code === 'BWK')!;
    const bw = options.serviceTypes.find((s) => s.code === 'BW')!;
    batch = (
      await as(admin)
        .post('/api/v1/samples/receive-and-register', {
          airwayBill: { number: 'AWB-R' },
          serviceTypeId: bw.id,
          samples: [1, 2, 3].map((n) => ({
            productId: bwk.id,
            variantId: bwk.variants[0]!.id,
            vesselId: vessel.id,
            serialNumber: `R-${n}`,
            values: { sampling_point: 'intake', date_sampled: '2026-11-20' },
          })),
        })
        .expect(201)
    ).body.data;
    // Complete the results of the first two samples.
    const st = (await as(admin).get(`/api/v1/lab/service-types/${bw.id}`).expect(200)).body
      .data as ServiceTypeDto;
    const values = { org_50: 2, org_10_50: 1, e_coli: 10, enterococci: 5, v_cholerae: 'pass' };
    for (const s of batch.samples.slice(0, 2)) {
      await as(admin)
        .put(`/api/v1/samples/${s.id}/results`, {
          results: st.parameters.map((p) => ({
            parameterId: p.id,
            value: values[p.key as keyof typeof values],
          })),
        })
        .expect(200);
      await as(admin).post(`/api/v1/samples/${s.id}/complete-results`).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('files', () => {
    it('stages an upload, checks the content and records size and checksum', async () => {
      const file = await upload('LAB_REPORT', 'report.pdf', PDF);
      expect(file).toMatchObject({
        status: 'READY',
        contentType: 'application/pdf',
        size: PDF.length,
      });
      const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: file.id } });
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.storageKey).toBe(`${tenantId}/${file.id}`);
    });

    it('rejects the wrong type, empty files, a second upload and other users', async () => {
      const intent = (
        await as(admin)
          .post('/api/v1/files', { purpose: 'LAB_REPORT', name: 'r.pdf', size: 10 })
          .expect(201)
      ).body.data as UploadIntentDto;
      const put = (body: Buffer, cookie = admin) =>
        api()
          .put(`/api/v1${intent.uploadPath}`)
          .set('Cookie', cookie)
          .set('Content-Type', 'application/octet-stream')
          .send(body);

      const wrong = await put(PNG).expect(400);
      expect(wrong.body.error.details[0]).toMatchObject({
        path: 'file',
        message: expect.stringMatching(/not an accepted type/),
      });
      await put(Buffer.alloc(0)).expect(400);

      await createUser(prisma, {
        email: 'other@acme.test',
        tenantId,
        roleIds: [(await prisma.role.findFirstOrThrow()).id],
      });
      await put(PDF, await loginCookie(app, 'other@acme.test')).expect(404);

      await put(PDF).expect(200);
      await put(PDF).expect(409);
      await as(admin)
        .post('/api/v1/files', { purpose: 'LAB_REPORT', name: 'big.pdf', size: 30 * 1024 * 1024 })
        .expect(400);
    });
  });

  describe('lab reports', () => {
    it('submits a report for completed samples; they turn yellow; downloads are signed', async () => {
      const file = await upload('LAB_REPORT', 'BW report.pdf', PDF);
      const created = (await report([0, 1], file.id).expect(201)).body.data as LabReportDto;
      const yy = String(new Date().getUTCFullYear() % 100).padStart(2, '0');
      expect(created).toMatchObject({
        code: `LR${yy}-00001`,
        status: 'SUBMITTED',
        sampleCount: 2,
        currentVersion: 1,
        batch: { id: batch.id },
      });
      expect(created.versions[0]).toMatchObject({
        version: 1,
        note: 'First issue',
        file: { name: 'BW report.pdf' },
      });

      const sample = (await as(admin).get(`/api/v1/samples/${batch.samples[0]!.id}`).expect(200))
        .body.data as SampleDto;
      expect(sample).toMatchObject({
        colour: 'yellow',
        labReport: { code: created.code, status: 'SUBMITTED' },
      });
      const third = (await as(admin).get(`/api/v1/samples/${batch.samples[2]!.id}`).expect(200))
        .body.data as SampleDto;
      expect(third.colour).toBe('red');

      const link = (
        await as(admin).get(`/api/v1/lab-reports/${created.id}/download-link`).expect(200)
      ).body.data as DownloadLinkDto;
      const res = await download(link).expect(200);
      expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment; filename="BW report.pdf"');
      await api()
        .get(`/api/v1${link.path.replace(/token=./, 'token=X')}`)
        .expect(403);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'report.submitted' },
      });
      expect(audit.relatedIds).toEqual(expect.arrayContaining([batch.id, batch.samples[0]!.id]));
    });

    it('only completed samples of one batch, each in one report, with a fresh lab-report file', async () => {
      const f1 = await upload('LAB_REPORT', 'a.pdf', PDF);
      const notDone = await report([2], f1.id).expect(400);
      expect(notDone.body.error.details[0].message).toMatch(/results are not complete yet/);

      await report([0], f1.id).expect(201);
      const f2 = await upload('LAB_REPORT', 'b.pdf', PDF);
      const twice = await report([0, 1], f2.id).expect(400);
      expect(twice.body.error.details[0].message).toMatch(/is already in report LR/);

      const reused = await report([1], f1.id).expect(400);
      expect(reused.body.error.details[0]).toEqual({
        path: 'fileId',
        message: 'This file is already attached',
      });
      const attachmentFile = await upload('RESULT_ATTACHMENT', 'photo.png', PNG);
      const wrongPurpose = await report([1], attachmentFile.id).expect(400);
      expect(wrongPurpose.body.error.details[0].message).toBe(
        'This file was uploaded for something else',
      );
    });

    it('replaces the file as a new version and keeps the history', async () => {
      const created = (
        await report([0, 1], (await upload('LAB_REPORT', 'v1.pdf', PDF)).id).expect(201)
      ).body.data as LabReportDto;
      const v2 = (
        await as(admin)
          .post(`/api/v1/lab-reports/${created.id}/versions`, {
            fileId: (await upload('LAB_REPORT', 'v2.pdf', PDF)).id,
            note: 'Typo fixed',
          })
          .expect(201)
      ).body.data as LabReportDto;
      expect(v2.currentVersion).toBe(2);
      expect(v2.versions.map((v) => [v.version, v.file.name, v.note])).toEqual([
        [2, 'v2.pdf', 'Typo fixed'],
        [1, 'v1.pdf', 'First issue'],
      ]);
      const old = (
        await as(admin)
          .get(`/api/v1/lab-reports/${created.id}/versions/1/download-link`)
          .expect(200)
      ).body.data;
      await download(old).expect(200);
    });

    it('locks the results and attachments of reported samples', async () => {
      await report([0], (await upload('LAB_REPORT', 'r.pdf', PDF)).id).expect(201);
      const reopen = await as(admin)
        .post(`/api/v1/samples/${batch.samples[0]!.id}/reopen-results`)
        .expect(400);
      expect(reopen.body.error.message).toMatch(/is in lab report LR.*cannot be reopened/);
      const attach = await as(admin)
        .post(`/api/v1/samples/${batch.samples[0]!.id}/attachments`, {
          fileId: (await upload('RESULT_ATTACHMENT', 'p.png', PNG)).id,
        })
        .expect(400);
      expect(attach.body.error.message).toMatch(/Attachments can no longer change/);
    });
  });

  describe('attachments', () => {
    it('adds, downloads and removes supporting files, with an audit trail', async () => {
      const id = batch.samples[2]!.id;
      const file = await upload('RESULT_ATTACHMENT', 'printout.png', PNG);
      let list = (
        await as(admin)
          .post(`/api/v1/samples/${id}/attachments`, { fileId: file.id, note: 'Microscope' })
          .expect(201)
      ).body.data as SampleAttachmentDto[];
      expect(list.map((a) => [a.file.name, a.file.contentType, a.note])).toEqual([
        ['printout.png', 'image/png', 'Microscope'],
      ]);
      const link = (
        await as(admin)
          .get(`/api/v1/samples/${id}/attachments/${list[0]!.id}/download-link`)
          .expect(200)
      ).body.data;
      expect(Buffer.compare((await download(link).expect(200)).body as Buffer, PNG)).toBe(0);
      list = (await as(admin).del(`/api/v1/samples/${id}/attachments/${list[0]!.id}`).expect(200))
        .body.data;
      expect(list).toEqual([]);
      const actions = (
        await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { occurredAt: 'asc' } })
      ).map((a) => a.action);
      expect(actions.slice(-2)).toEqual(['sample.attachment_added', 'sample.attachment_removed']);
    });
  });

  describe('access', () => {
    it('report viewers can read and download but not upload; the Reports module is required', async () => {
      const created = (await report([0], (await upload('LAB_REPORT', 'r.pdf', PDF)).id).expect(201))
        .body.data as LabReportDto;
      const role = await createRole(prisma, {
        tenantId,
        name: 'Reviewer',
        modules: ['reports'],
        permissions: ['report.view'],
      });
      await createUser(prisma, { email: 'view@acme.test', tenantId, roleIds: [role.id] });
      const viewer = await loginCookie(app, 'view@acme.test');
      await as(viewer).get('/api/v1/lab-reports').expect(200);
      await as(viewer).get(`/api/v1/lab-reports/${created.id}/download-link`).expect(200);
      const file = await upload('LAB_REPORT', 'mine.pdf', PDF, viewer);
      await as(viewer)
        .post('/api/v1/lab-reports', {
          batchId: batch.id,
          sampleIds: [batch.samples[1]!.id],
          fileId: file.id,
        })
        .expect(403);
      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'reports' } });
      await as(admin).get('/api/v1/lab-reports').expect(403);
    });

    it('other organisations cannot read reports or claim our files', async () => {
      const file = await upload('LAB_REPORT', 'r.pdf', PDF);
      const created = (await report([0], file.id).expect(201)).body.data as LabReportDto;
      const other = await createTenant(prisma, { slug: 'other', modules: ['reports', 'samples'] });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const outsider = await loginCookie(app, 'admin@other.test');
      await as(outsider).get(`/api/v1/lab-reports/${created.id}`).expect(404);
      await as(outsider).get(`/api/v1/lab-reports/${created.id}/download-link`).expect(404);
      await api()
        .put(`/api/v1/files/${file.id}/content`)
        .set('Cookie', outsider)
        .set('Content-Type', 'application/octet-stream')
        .send(PDF)
        .expect(404);
    });
  });
});
