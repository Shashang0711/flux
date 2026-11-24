import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { ClientDto, FleetDto, VesselDto, VesselRelationshipDto } from '@flux/shared';
import { PrismaService } from '../src/database/prisma.service';
import { TenantDb } from '../src/database/tenant-db.service';
import {
  createE2eApp,
  createReferenceItem,
  createRole,
  createTenant,
  createUser,
  loginCookie,
  resetDatabase,
} from './e2e-app';

describe('Vessel–client relationships and fleets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let ownerType: string;
  let managerType: string;
  let vessel: VesselDto;
  let alpha: ClientDto;
  let beta: ClientDto;

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
  const link = async (body: object, vesselId = vessel.id): Promise<VesselRelationshipDto> =>
    (await as(admin).post(`/api/v1/vessels/${vesselId}/relationships`, body).expect(201)).body.data;
  const fleet = async (clientId: string, name: string): Promise<FleetDto> =>
    (await as(admin).post('/api/v1/fleets', { clientId, name }).expect(201)).body.data;
  const relationships = async (query = '') =>
    (await as(admin).get(`/api/v1/vessels/${vessel.id}/relationships${query}`).expect(200)).body
      .data as VesselRelationshipDto[];

  beforeAll(async () => {
    ({ app, prisma } = await createE2eApp());
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    ownerType = (
      await createReferenceItem(prisma, {
        list: 'vessel-relationship-type',
        code: 'OWNER',
        name: 'Ship Owner',
      })
    ).id;
    managerType = (
      await createReferenceItem(prisma, {
        list: 'vessel-relationship-type',
        code: 'MANAGER',
        name: 'Ship Manager',
      })
    ).id;
    const tenant = await createTenant(prisma, { slug: 'acme', modules: ['clients', 'vessels'] });
    tenantId = tenant.id;
    await createUser(prisma, { email: 'admin@acme.test', tenantId, roleIds: [tenant.adminRoleId] });
    admin = await loginCookie(app, 'admin@acme.test');
    vessel = (await as(admin).post('/api/v1/vessels', { name: 'Aegean Star' }).expect(201)).body
      .data;
    alpha = (await as(admin).post('/api/v1/clients', { name: 'Alpha Owners' }).expect(201)).body
      .data;
    beta = (await as(admin).post('/api/v1/clients', { name: 'Beta Management' }).expect(201)).body
      .data;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('relationships', () => {
    it('links one vessel master to several clients (no duplicate vessels)', async () => {
      await link({
        clientId: alpha.id,
        relationshipTypeId: ownerType,
        isPrimary: true,
        startDate: '2020-01-01',
      });
      await link({ clientId: beta.id, relationshipTypeId: managerType });
      const rels = await relationships();
      expect(rels.map((r) => [r.client.name, r.relationshipType.name, r.isPrimary])).toEqual([
        ['Alpha Owners', 'Ship Owner', true],
        ['Beta Management', 'Ship Manager', false],
      ]);
      expect(rels[0]!.startDate).toBe('2020-01-01');
      expect(await prisma.vessel.count()).toBe(1);

      const fromClient = await as(admin).get(`/api/v1/clients/${beta.id}/vessels`).expect(200);
      expect(fromClient.body.data.map((r: VesselRelationshipDto) => r.vessel.name)).toEqual([
        'Aegean Star',
      ]);
    });

    it('keeps one primary relationship per vessel', async () => {
      await link({ clientId: alpha.id, relationshipTypeId: ownerType, isPrimary: true });
      const b = await link({ clientId: beta.id, relationshipTypeId: managerType, isPrimary: true });
      expect((await relationships()).filter((r) => r.isPrimary).map((r) => r.id)).toEqual([b.id]);
    });

    it('rejects a duplicate active link of the same type, but allows another type', async () => {
      await link({ clientId: alpha.id, relationshipTypeId: ownerType });
      await as(admin)
        .post(`/api/v1/vessels/${vessel.id}/relationships`, {
          clientId: alpha.id,
          relationshipTypeId: ownerType,
        })
        .expect(409);
      await link({ clientId: alpha.id, relationshipTypeId: managerType });
    });

    it('validates client and type', async () => {
      const wrongList = (
        await createReferenceItem(prisma, { list: 'vessel-type', code: 'BULK', name: 'Bulk' })
      ).id;
      const res = await as(admin)
        .post(`/api/v1/vessels/${vessel.id}/relationships`, {
          clientId: alpha.id,
          relationshipTypeId: wrongList,
        })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('relationshipTypeId');
      await as(admin).patch(`/api/v1/clients/${alpha.id}`, { status: 'INACTIVE' }).expect(200);
      const inactive = await as(admin)
        .post(`/api/v1/vessels/${vessel.id}/relationships`, {
          clientId: alpha.id,
          relationshipTypeId: ownerType,
        })
        .expect(400);
      expect(inactive.body.error.details[0].message).toBe('This client is inactive');
    });

    it('ends a relationship, keeping history; end date cannot precede the start', async () => {
      const r = await link({
        clientId: alpha.id,
        relationshipTypeId: ownerType,
        isPrimary: true,
        startDate: '2020-06-01',
      });
      const bad = await as(admin)
        .post(`/api/v1/relationships/${r.id}/end`, { endDate: '2020-01-01' })
        .expect(400);
      expect(bad.body.error.details[0].path).toBe('endDate');

      const ended = await as(admin)
        .post(`/api/v1/relationships/${r.id}/end`, { endDate: '2024-12-31' })
        .expect(201);
      expect(ended.body.data).toMatchObject({
        status: 'ENDED',
        isPrimary: false,
        endDate: '2024-12-31',
      });
      expect(await relationships()).toEqual([]);
      expect((await relationships('?status=ALL')).map((x) => x.status)).toEqual(['ENDED']);
      // Ended relationships cannot be changed; the same link can be created again.
      await as(admin).patch(`/api/v1/relationships/${r.id}`, { isPrimary: true }).expect(400);
      await link({ clientId: alpha.id, relationshipTypeId: ownerType });
    });
  });

  describe('fleets', () => {
    it('creates client fleets with codes and unique names per client', async () => {
      const f = await fleet(alpha.id, 'Dry Bulk');
      expect(f).toMatchObject({ code: 'FL-00001', client: { id: alpha.id }, vessels: [] });
      await as(admin).post('/api/v1/fleets', { clientId: alpha.id, name: 'dry bulk' }).expect(409);
      expect((await fleet(beta.id, 'Dry Bulk')).code).toBe('FL-00002');
    });

    it('a vessel joins a fleet through its relationship, one fleet per client at a time', async () => {
      const dry = await fleet(alpha.id, 'Dry Bulk');
      const handy = await fleet(alpha.id, 'Handysize');
      const r = await link({ clientId: alpha.id, relationshipTypeId: ownerType, fleetId: dry.id });
      expect(r.fleet?.name).toBe('Dry Bulk');

      await as(admin).put(`/api/v1/relationships/${r.id}/fleet`, { fleetId: handy.id }).expect(200);
      const clientFleets = (await as(admin).get(`/api/v1/clients/${alpha.id}/fleets`)).body
        .data as FleetDto[];
      expect(clientFleets.map((f) => [f.name, f.vessels.map((v) => v.name)])).toEqual([
        ['Dry Bulk', []],
        ['Handysize', ['Aegean Star']],
      ]);

      // A second relationship with the same client cannot put the vessel in a second fleet.
      const m = await link({ clientId: alpha.id, relationshipTypeId: managerType });
      await as(admin).put(`/api/v1/relationships/${m.id}/fleet`, { fleetId: dry.id }).expect(200);
      const after = (await as(admin).get(`/api/v1/clients/${alpha.id}/fleets`)).body
        .data as FleetDto[];
      expect(after.flatMap((f) => f.vessels.map((v) => `${f.name}:${v.name}`))).toEqual([
        'Dry Bulk:Aegean Star',
      ]);
    });

    it('separate fleet assignments per client, with no cross-client leakage', async () => {
      const alphaFleet = await fleet(alpha.id, 'Alpha Fleet');
      const betaFleet = await fleet(beta.id, 'Beta Fleet');
      const ra = await link({
        clientId: alpha.id,
        relationshipTypeId: ownerType,
        fleetId: alphaFleet.id,
      });
      await link({ clientId: beta.id, relationshipTypeId: managerType, fleetId: betaFleet.id });

      // A relationship with Alpha cannot use Beta's fleet.
      const res = await as(admin)
        .put(`/api/v1/relationships/${ra.id}/fleet`, { fleetId: betaFleet.id })
        .expect(400);
      expect(res.body.error.details[0].message).toBe("Choose one of this client's fleets");
      // Nor can the database be made to do it: free the slot first so only the FK can object.
      await as(admin).put(`/api/v1/relationships/${ra.id}/fleet`, { fleetId: null }).expect(200);
      await expect(
        app.get(TenantDb).run(tenantId, (tx) =>
          tx.fleetVessel.create({
            data: {
              tenantId,
              fleetId: betaFleet.id,
              clientId: alpha.id,
              vesselId: vessel.id,
              relationshipId: ra.id,
            },
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/i);
    });

    it('ending a relationship takes the vessel out of the fleet; fleets with vessels cannot be deactivated', async () => {
      const f = await fleet(alpha.id, 'Dry Bulk');
      const r = await link({ clientId: alpha.id, relationshipTypeId: ownerType, fleetId: f.id });
      await as(admin).patch(`/api/v1/fleets/${f.id}`, { status: 'INACTIVE' }).expect(400);
      await as(admin).post(`/api/v1/relationships/${r.id}/end`, {}).expect(201);
      expect((await as(admin).get(`/api/v1/fleets/${f.id}`)).body.data.vessels).toEqual([]);
      await as(admin).patch(`/api/v1/fleets/${f.id}`, { status: 'INACTIVE' }).expect(200);
      await as(admin)
        .post(`/api/v1/vessels/${vessel.id}/relationships`, {
          clientId: alpha.id,
          relationshipTypeId: ownerType,
          fleetId: f.id,
        })
        .expect(400);
    });
  });

  describe('creating a vessel with its first client link', () => {
    it('creates vessel, relationship and fleet membership in one step', async () => {
      const f = await fleet(alpha.id, 'Dry Bulk');
      const created = await as(admin)
        .post('/api/v1/vessels', {
          name: 'Baltic Wind',
          relationship: {
            clientId: alpha.id,
            relationshipTypeId: ownerType,
            isPrimary: true,
            fleetId: f.id,
          },
        })
        .expect(201);
      const rels = (await as(admin).get(`/api/v1/vessels/${created.body.data.id}/relationships`))
        .body.data;
      expect(rels[0]).toMatchObject({
        client: { name: 'Alpha Owners' },
        isPrimary: true,
        fleet: { name: 'Dry Bulk' },
      });
    });

    it('creates nothing (and takes no number) if the link is invalid', async () => {
      const otherFleet = await fleet(beta.id, 'Beta Fleet');
      const res = await as(admin)
        .post('/api/v1/vessels', {
          name: 'Broken',
          relationship: {
            clientId: alpha.id,
            relationshipTypeId: ownerType,
            fleetId: otherFleet.id,
          },
        })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('relationship.fleetId');
      expect(await prisma.vessel.count({ where: { name: 'Broken' } })).toBe(0);
      expect(
        (await as(admin).post('/api/v1/vessels', { name: 'Next' }).expect(201)).body.data.code,
      ).toBe('VS-00002');
    });
  });

  describe('access', () => {
    it('needs the Clients module too', async () => {
      const t = await createTenant(prisma, { slug: 'vessels-only', modules: ['vessels'] });
      await createUser(prisma, { email: 'a@vo.test', tenantId: t.id, roleIds: [t.adminRoleId] });
      const cookie = await loginCookie(app, 'a@vo.test');
      const v = (await as(cookie).post('/api/v1/vessels', { name: 'Solo' }).expect(201)).body.data;
      const res = await as(cookie).get(`/api/v1/vessels/${v.id}/relationships`).expect(403);
      expect(res.body.error.code).toBe('MODULE_NOT_ENABLED');
    });

    it('vessel.manage links; fleet.manage manages fleets', async () => {
      const role = await createRole(prisma, {
        tenantId,
        name: 'Vessel clerk',
        modules: ['vessels', 'clients'],
        permissions: ['vessel.manage', 'client.view'],
      });
      await createUser(prisma, { email: 'c@acme.test', tenantId, roleIds: [role.id] });
      const clerk = await loginCookie(app, 'c@acme.test');
      const r = (
        await as(clerk)
          .post(`/api/v1/vessels/${vessel.id}/relationships`, {
            clientId: alpha.id,
            relationshipTypeId: ownerType,
          })
          .expect(201)
      ).body.data;
      await as(clerk).post('/api/v1/fleets', { clientId: alpha.id, name: 'Nope' }).expect(403);
      await as(clerk).put(`/api/v1/relationships/${r.id}/fleet`, { fleetId: null }).expect(403);
    });

    it('another tenant sees nothing', async () => {
      const r = await link({ clientId: alpha.id, relationshipTypeId: ownerType });
      const other = await createTenant(prisma, { slug: 'other', modules: ['clients', 'vessels'] });
      await createUser(prisma, {
        email: 'a@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const otherAdmin = await loginCookie(app, 'a@other.test');
      await as(otherAdmin).get(`/api/v1/vessels/${vessel.id}/relationships`).expect(404);
      await as(otherAdmin).post(`/api/v1/relationships/${r.id}/end`, {}).expect(404);
      await as(otherAdmin).get(`/api/v1/clients/${alpha.id}/fleets`).expect(404);
    });
  });

  it('audits on the vessel, client and fleet histories', async () => {
    const f = await fleet(alpha.id, 'Dry Bulk');
    const r = await link({ clientId: alpha.id, relationshipTypeId: ownerType, fleetId: f.id });
    await as(admin)
      .post(`/api/v1/relationships/${r.id}/end`, { endDate: '2030-01-01' })
      .expect(201);

    const actions = async (id: string) =>
      (await as(admin).get(`/api/v1/audit-logs?entityId=${id}`)).body.data.map(
        (e: { action: string }) => e.action,
      );
    expect(await actions(vessel.id)).toEqual([
      'vessel.relationship_ended',
      'vessel.client_linked',
      'vessel.created',
    ]);
    expect(await actions(alpha.id)).toEqual([
      'vessel.relationship_ended',
      'vessel.client_linked',
      'fleet.created',
      'client.created',
    ]);
    expect(await actions(f.id)).toEqual([
      'vessel.relationship_ended',
      'vessel.client_linked',
      'fleet.created',
    ]);
    const linked = (
      await as(admin).get(`/api/v1/audit-logs?entityId=${vessel.id}&action=vessel.client_linked`)
    ).body.data[0];
    expect(linked.changes).toEqual({
      client: { from: null, to: `${alpha.code} Alpha Owners` },
      relationshipType: { from: null, to: 'Ship Owner' },
      fleet: { from: null, to: 'FL-00001 Dry Bulk' },
    });
  });
});
