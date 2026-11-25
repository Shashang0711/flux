import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BottleTypeDto,
  LabCategoryDto,
  ProductDto,
  ProductSummaryDto,
  ServiceTypeDto,
  ServiceTypeSummaryDto,
  StarterImportResultDto,
} from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import {
  createE2eApp,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Laboratory master data (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;

  const api = () => request(app.getHttpServer());
  const as = (cookie: string) => ({
    get: (url: string) => api().get(url).set('Cookie', cookie),
    post: (url: string, body?: object) =>
      api()
        .post(url)
        .set('Cookie', cookie)
        .send(body ?? {}),
    patch: (url: string, body: object) => api().patch(url).set('Cookie', cookie).send(body),
    put: (url: string, body: object) => api().put(url).set('Cookie', cookie).send(body),
  });
  const L = '/api/v1/lab';
  const importStarter = async (): Promise<StarterImportResultDto> =>
    (await as(admin).post(`${L}/starter-catalogue`).expect(201)).body.data;
  const serviceTypes = async (q = ''): Promise<ServiceTypeSummaryDto[]> =>
    (await as(admin).get(`${L}/service-types${q}`).expect(200)).body.data;
  const byCode = <T extends { code: string }>(list: T[], code: string) =>
    list.find((x) => x.code === code)!;
  const serviceType = async (code: string): Promise<ServiceTypeDto> =>
    (
      await as(admin)
        .get(`${L}/service-types/${byCode(await serviceTypes(), code).id}`)
        .expect(200)
    ).body.data;
  const product = async (code: string): Promise<ProductDto> => {
    const list: ProductSummaryDto[] = (await as(admin).get(`${L}/products`).expect(200)).body.data;
    return (
      await as(admin)
        .get(`${L}/products/${byCode(list, code).id}`)
        .expect(200)
    ).body.data;
  };
  const category = async (code: string, name = code): Promise<LabCategoryDto> =>
    byCode(
      (await as(admin).post(`${L}/categories`, { code, name }).expect(201)).body
        .data as LabCategoryDto[],
      code.toUpperCase(),
    );

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['lab-setup'] });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('starter catalogue', () => {
    it('imports categories, service types with fields, bottles and kits', async () => {
      expect(await importStarter()).toEqual({
        created: { categories: 3, serviceTypes: 5, bottleTypes: 4, products: 4 },
        skipped: 0,
      });
      const bw = await serviceType('BW');
      expect(bw.category.name).toBe('Water');
      expect(bw.fields.map((f) => [f.key, f.scope, f.required])).toEqual([
        ['port_of_sampling', 'BATCH', false],
        ['sampling_point', 'SAMPLE', true],
        ['date_sampled', 'SAMPLE', true],
        ['treatment_running', 'SAMPLE', false],
      ]);

      // Many-to-many: one water kit serves potable and grey water.
      const wqk = await product('WQK');
      expect(wqk.serviceTypes.map((s) => s.code)).toEqual(['GW', 'PW']);

      // A variant uses the kit's bottles unless it has its own.
      const bwk = await product('BWK');
      const uv = byCode(bwk.variants, 'UV');
      const elec = byCode(bwk.variants, 'ELEC');
      expect(uv.bottles).toEqual([]);
      expect(uv.effectiveBottles.map((b) => [b.bottleType.code, b.quantity])).toEqual([
        ['PET-1000', 2],
      ]);
      expect(elec.effectiveBottles.map((b) => [b.bottleType.code, b.quantity])).toEqual([
        ['PET-1000', 2],
        ['STER-250', 1],
      ]);
      expect(await prisma.auditLog.count({ where: { action: 'lab.starter_imported' } })).toBe(1);
    });

    it('importing again only adds what is missing and never overwrites edits', async () => {
      await importStarter();
      const bw = await serviceType('BW');
      await as(admin)
        .patch(`${L}/service-types/${bw.id}`, { name: 'Ballast Water (D-2)' })
        .expect(200);
      expect(await importStarter()).toEqual({
        created: { categories: 0, serviceTypes: 0, bottleTypes: 0, products: 0 },
        skipped: 16,
      });
      expect((await serviceType('BW')).name).toBe('Ballast Water (D-2)');
      expect(await prisma.auditLog.count({ where: { action: 'lab.starter_imported' } })).toBe(1);
    });
  });

  describe('categories and service types', () => {
    it('stores codes upper-case and rejects duplicates on the code field', async () => {
      const water = await category('water', 'Water');
      expect(water.code).toBe('WATER');
      const dup = await as(admin)
        .post(`${L}/categories`, { code: 'Water', name: 'Again' })
        .expect(400);
      expect(dup.body.error.details).toEqual([
        { path: 'code', message: 'This code is already in use' },
      ]);
      await as(admin).post(`${L}/categories`, { code: 'BAD CODE', name: 'x' }).expect(400);

      const st = (
        await as(admin)
          .post(`${L}/service-types`, { categoryId: water.id, code: 'bw', name: 'Ballast Water' })
          .expect(201)
      ).body.data as ServiceTypeDto;
      expect(st).toMatchObject({ code: 'BW', fieldCount: 0, category: { code: 'WATER' } });
      await as(admin)
        .post(`${L}/service-types`, { categoryId: water.id, code: 'BW', name: 'Other' })
        .expect(400);
    });

    it('inactive categories take no new service types and drop out of the active list', async () => {
      const water = await category('WATER');
      await as(admin)
        .post(`${L}/service-types`, { categoryId: water.id, code: 'BW', name: 'Ballast Water' })
        .expect(201);
      await as(admin).patch(`${L}/categories/${water.id}`, { isActive: false }).expect(200);
      const res = await as(admin)
        .post(`${L}/service-types`, { categoryId: water.id, code: 'PW', name: 'Potable' })
        .expect(400);
      expect(res.body.error.details[0]).toEqual({
        path: 'categoryId',
        message: 'This category is inactive',
      });
      expect(await serviceTypes('?view=active')).toEqual([]);
      expect((await serviceTypes()).map((s) => [s.code, s.category.isActive])).toEqual([
        ['BW', false],
      ]);
    });
  });

  describe('registration fields', () => {
    let st: ServiceTypeDto;
    const add = (body: object) => as(admin).post(`${L}/service-types/${st.id}/fields`, body);

    beforeEach(async () => {
      const water = await category('WATER');
      st = (
        await as(admin)
          .post(`${L}/service-types`, { categoryId: water.id, code: 'BW', name: 'Ballast Water' })
          .expect(201)
      ).body.data;
    });

    it('derives keys from labels, orders batch before sample fields and audits', async () => {
      await add({ label: 'Sampling point', type: 'TEXT', scope: 'SAMPLE', required: true }).expect(
        201,
      );
      const res = await add({ label: 'Port of sampling', type: 'TEXT', scope: 'BATCH' }).expect(
        201,
      );
      const fields = (res.body.data as ServiceTypeDto).fields;
      expect(fields.map((f) => [f.key, f.scope])).toEqual([
        ['port_of_sampling', 'BATCH'],
        ['sampling_point', 'SAMPLE'],
      ]);
      expect(
        await prisma.auditLog.count({ where: { action: 'lab.field_added', entityId: st.id } }),
      ).toBe(2);
    });

    it('rejects duplicate keys, dropdowns without options and options on other types', async () => {
      await add({ label: 'Sampling point', type: 'TEXT', scope: 'SAMPLE' }).expect(201);
      const dup = await add({ label: 'Sampling Point', type: 'TEXT', scope: 'BATCH' }).expect(400);
      expect(dup.body.error.details[0].path).toBe('label');
      await add({ label: 'Grade', type: 'SELECT', scope: 'SAMPLE', options: [] }).expect(400);
      const text = (await serviceType('BW')).fields[0]!;
      await as(admin)
        .patch(`${L}/registration-fields/${text.id}`, { options: [{ value: 'a', label: 'A' }] })
        .expect(400);
    });

    it('validates registration values like sample registration will', async () => {
      await add({ label: 'Port of sampling', type: 'TEXT', scope: 'BATCH', required: true }).expect(
        201,
      );
      await add({
        label: 'Sampling point',
        type: 'SELECT',
        scope: 'SAMPLE',
        required: true,
        options: [
          { value: 'intake', label: 'Intake' },
          { value: 'discharge', label: 'Discharge' },
        ],
      }).expect(201);
      await add({ label: 'Volume', type: 'NUMBER', scope: 'SAMPLE' }).expect(201);
      const check = (body: object) =>
        as(admin).post(`${L}/service-types/${st.id}/registration-check`, body);

      const ok = await check({
        batch: { port_of_sampling: 'Rotterdam' },
        samples: [{ sampling_point: 'intake', volume: '1.5' }, { sampling_point: 'discharge' }],
      }).expect(201);
      expect(ok.body.data).toEqual({
        batch: { port_of_sampling: 'Rotterdam' },
        samples: [{ sampling_point: 'intake', volume: 1.5 }, { sampling_point: 'discharge' }],
      });

      const bad = await check({
        batch: {},
        samples: [{ sampling_point: 'intake' }, { sampling_point: 'tank', colour: 'red' }],
      }).expect(400);
      expect(bad.body.error.details).toEqual(
        expect.arrayContaining([
          { path: 'batch.port_of_sampling', message: 'Port of sampling is required' },
          { path: 'samples.1.sampling_point', message: 'Choose one of the listed options' },
          { path: 'samples.1.colour', message: 'Unknown custom field' },
        ]),
      );

      // Deactivated fields are no longer asked for.
      const port = (await serviceType('BW')).fields.find((f) => f.key === 'port_of_sampling')!;
      await as(admin).patch(`${L}/registration-fields/${port.id}`, { isActive: false }).expect(200);
      await check({ batch: {}, samples: [{ sampling_point: 'intake' }] }).expect(201);
    });
  });

  describe('kits, variants and bottles', () => {
    let st: ServiceTypeDto;
    let bottles: BottleTypeDto[];

    beforeEach(async () => {
      const water = await category('WATER');
      st = (
        await as(admin)
          .post(`${L}/service-types`, { categoryId: water.id, code: 'BW', name: 'Ballast Water' })
          .expect(201)
      ).body.data;
      await as(admin)
        .post(`${L}/bottle-types`, { code: 'pet-1000', name: '1 L PET', volumeMl: 1000 })
        .expect(201);
      bottles = (
        await as(admin)
          .post(`${L}/bottle-types`, { code: 'STER-250', name: '250 ml sterile', volumeMl: '250' })
          .expect(201)
      ).body.data;
    });

    it('creates a kit with service types, bottles and variants', async () => {
      const kit = (
        await as(admin)
          .post(`${L}/products`, {
            code: 'BWK',
            name: 'Ballast Water Kit',
            serviceTypeIds: [st.id],
          })
          .expect(201)
      ).body.data as ProductDto;
      const [pet, ster] = [byCode(bottles, 'PET-1000'), byCode(bottles, 'STER-250')];
      await as(admin)
        .put(`${L}/products/${kit.id}/bottles`, {
          bottles: [{ bottleTypeId: pet.id, quantity: 2 }],
        })
        .expect(200);
      let p = (
        await as(admin)
          .post(`${L}/products/${kit.id}/variants`, { code: 'uv', name: 'UV' })
          .expect(201)
      ).body.data as ProductDto;
      const uv = byCode(p.variants, 'UV');
      expect(uv.effectiveBottles.map((b) => b.quantity)).toEqual([2]);

      p = (
        await as(admin)
          .put(`${L}/variants/${uv.id}/bottles`, {
            bottles: [
              { bottleTypeId: pet.id, quantity: 1 },
              { bottleTypeId: ster.id, quantity: 1 },
            ],
          })
          .expect(200)
      ).body.data;
      expect(byCode(p.variants, 'UV').effectiveBottles.map((b) => b.bottleType.code)).toEqual([
        'PET-1000',
        'STER-250',
      ]);
      // Clearing the variant's bottles returns it to the kit's.
      p = (await as(admin).put(`${L}/variants/${uv.id}/bottles`, { bottles: [] }).expect(200)).body
        .data;
      expect(byCode(p.variants, 'UV').bottles).toEqual([]);
      expect(byCode(p.variants, 'UV').effectiveBottles.map((b) => b.quantity)).toEqual([2]);

      const history = await prisma.auditLog.findMany({
        where: { entityId: kit.id },
        orderBy: { occurredAt: 'asc' },
      });
      expect(history.map((h) => h.action)).toEqual([
        'lab.product_created',
        'lab.product_bottles_changed',
        'lab.variant_added',
        'lab.variant_bottles_changed',
        'lab.variant_bottles_changed',
      ]);
      expect(history[1]!.changes).toEqual({ bottles: { added: ['2 × 1 L PET'], removed: [] } });
    });

    it('validates kit input', async () => {
      await as(admin)
        .post(`${L}/products`, { code: 'K', name: 'No service', serviceTypeIds: [] })
        .expect(400);
      const kit = (
        await as(admin)
          .post(`${L}/products`, { code: 'K', name: 'Kit', serviceTypeIds: [st.id] })
          .expect(201)
      ).body.data as ProductDto;
      const pet = byCode(bottles, 'PET-1000');
      await as(admin)
        .put(`${L}/products/${kit.id}/bottles`, {
          bottles: [
            { bottleTypeId: pet.id, quantity: 1 },
            { bottleTypeId: pet.id, quantity: 2 },
          ],
        })
        .expect(400);
      await as(admin)
        .put(`${L}/products/${kit.id}/bottles`, {
          bottles: [{ bottleTypeId: pet.id, quantity: 0 }],
        })
        .expect(400);

      // Variant codes are unique per kit only.
      await as(admin)
        .post(`${L}/products/${kit.id}/variants`, { code: 'UV', name: 'UV' })
        .expect(201);
      await as(admin)
        .post(`${L}/products/${kit.id}/variants`, { code: 'uv', name: 'Again' })
        .expect(400);
      const other = (
        await as(admin)
          .post(`${L}/products`, { code: 'K2', name: 'Kit 2', serviceTypeIds: [st.id] })
          .expect(201)
      ).body.data as ProductDto;
      await as(admin)
        .post(`${L}/products/${other.id}/variants`, { code: 'UV', name: 'UV' })
        .expect(201);

      // Inactive service types and bottle types cannot be newly added.
      await as(admin).patch(`${L}/service-types/${st.id}`, { isActive: false }).expect(200);
      await as(admin)
        .post(`${L}/products`, { code: 'K3', name: 'Kit 3', serviceTypeIds: [st.id] })
        .expect(400);
      await as(admin).patch(`${L}/products/${kit.id}`, { name: 'Renamed' }).expect(200);
      await as(admin).patch(`${L}/bottle-types/${pet.id}`, { isActive: false }).expect(200);
      await as(admin)
        .put(`${L}/products/${kit.id}/bottles`, {
          bottles: [{ bottleTypeId: pet.id, quantity: 1 }],
        })
        .expect(400);
    });

    it('lists kits by service type and counts bottle usage', async () => {
      await as(admin)
        .post(`${L}/products`, { code: 'K', name: 'Kit', serviceTypeIds: [st.id] })
        .expect(201);
      const list = (await as(admin).get(`${L}/products?serviceTypeId=${st.id}`).expect(200)).body
        .data;
      expect(list.map((p: ProductSummaryDto) => p.code)).toEqual(['K']);
      expect((await serviceType('BW')).products.map((p) => p.code)).toEqual(['K']);
    });
  });

  describe('access', () => {
    it('needs the Laboratory Setup module and lab-setup.manage to change', async () => {
      const viewer = await createRole(prisma, {
        tenantId,
        name: 'Lab viewer',
        modules: ['lab-setup'],
        permissions: ['lab-setup.view'],
      });
      await createUser(prisma, { email: 'viewer@acme.test', tenantId, roleIds: [viewer.id] });
      const cookie = await loginCookie(app, 'viewer@acme.test');
      await as(cookie).get(`${L}/service-types`).expect(200);
      await as(cookie).post(`${L}/categories`, { code: 'X', name: 'X' }).expect(403);
      await as(cookie).post(`${L}/starter-catalogue`).expect(403);

      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'lab-setup' } });
      await as(admin).get(`${L}/service-types`).expect(403);
    });

    it("keeps each organisation's catalogue separate, also in the database", async () => {
      await importStarter();
      const bw = await serviceType('BW');
      const other = await createTenant(prisma, { slug: 'other', modules: ['lab-setup'] });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const outsider = await loginCookie(app, 'admin@other.test');
      expect((await as(outsider).get(`${L}/service-types`).expect(200)).body.data).toEqual([]);
      await as(outsider).get(`${L}/service-types/${bw.id}`).expect(404);
      await as(outsider)
        .post(`${L}/products`, { code: 'STEAL', name: 'Steal', serviceTypeIds: [bw.id] })
        .expect(400);

      const theirs = await prisma.product.create({
        data: { tenantId: other.id, code: 'THEIRS', name: 'Theirs' },
      });
      await expect(
        prisma.productServiceType.create({
          data: { tenantId: other.id, productId: theirs.id, serviceTypeId: bw.id },
        }),
      ).rejects.toThrow();
    });
  });
});
