import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type {
  BillingPartyDto,
  ClientDto,
  ClientNotificationRuleDto,
  VesselDto,
  VesselLinkSettingsDto,
  VesselRelationshipDto,
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

describe('Notification rules and vessel overrides (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;
  let admin: string;
  let ownerType: string;
  let vessel: VesselDto;
  let alpha: ClientDto;
  let beta: ClientDto;
  let rel: VesselRelationshipDto;

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
    delete: (url: string) => api().delete(url).set('Cookie', cookie),
  });
  const settings = async (id = rel.id): Promise<VesselLinkSettingsDto> =>
    (await as(admin).get(`/api/v1/relationships/${id}/settings`).expect(200)).body.data;
  const contact = async (clientId: string, name: string, email: string | null, isPrimary = false) =>
    (
      (
        await as(admin)
          .post(`/api/v1/clients/${clientId}/contacts`, { name, email, isPrimary })
          .expect(201)
      ).body.data as ClientDto
    ).contacts.find((c) => c.name === name)!;
  const party = async (clientId: string, name: string, isDefault = false) =>
    (
      (
        await as(admin)
          .post(`/api/v1/clients/${clientId}/billing-parties`, { name, isDefault })
          .expect(201)
      ).body.data as ClientDto
    ).billingParties.find((p: BillingPartyDto) => p.name === name)!;
  const rule = (clientId: string, event: string, body: object) =>
    as(admin).put(`/api/v1/clients/${clientId}/notification-rules/${event}`, body);
  const notification = (s: VesselLinkSettingsDto, event: string) =>
    s.notifications.find((n) => n.event === event)!;

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
    rel = (
      await as(admin)
        .post(`/api/v1/vessels/${vessel.id}/relationships`, {
          clientId: alpha.id,
          relationshipTypeId: ownerType,
          isPrimary: true,
        })
        .expect(201)
    ).body.data;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('client notification rules', () => {
    it('lists every event, switched off until configured', async () => {
      const res = await as(admin).get(`/api/v1/clients/${alpha.id}/notification-rules`).expect(200);
      const rules = res.body.data as ClientNotificationRuleDto[];
      expect(rules.map((r) => [r.event, r.enabled, r.configured])).toEqual([
        ['sample.received', false, false],
        ['report.published', false, false],
        ['report.critical', false, false],
        ['sample.delayed', false, false],
      ]);
    });

    it('stores recipients (contacts + extra emails) and audits the change', async () => {
      const maria = await contact(alpha.id, 'Maria', 'maria@alpha.test', true);
      const res = await rule(alpha.id, 'report.published', {
        enabled: true,
        contactIds: [maria.id],
        emails: ['Lab@Alpha.test', 'lab@alpha.test'],
      }).expect(200);
      const saved = res.body.data as ClientNotificationRuleDto;
      expect(saved).toMatchObject({ enabled: true, configured: true, emails: ['lab@alpha.test'] });
      expect(saved.contacts.map((c) => c.name)).toEqual(['Maria']);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'client.notification_rule_updated' },
      });
      expect(audit).toMatchObject({ entityType: 'client', entityId: alpha.id });
      expect(audit!.changes).toMatchObject({
        event: { to: 'Report published' },
        enabled: { from: false, to: true },
        recipients: { added: ['Maria', 'lab@alpha.test'], removed: [] },
      });
    });

    it("rejects another client's contacts, unknown events and bad emails", async () => {
      const other = await contact(beta.id, 'Bob', 'bob@beta.test');
      const res = await rule(alpha.id, 'report.published', {
        enabled: true,
        contactIds: [other.id],
        emails: [],
      }).expect(400);
      expect(res.body.error.details).toEqual([
        { path: 'contactIds', message: "Choose from this client's contacts" },
      ]);
      await rule(alpha.id, 'nope', { enabled: true, contactIds: [], emails: [] }).expect(400);
      await rule(alpha.id, 'report.published', {
        enabled: true,
        contactIds: [],
        emails: ['not-an-email'],
      }).expect(400);
    });

    it('deleting a contact removes it from rules', async () => {
      const maria = await contact(alpha.id, 'Maria', 'maria@alpha.test');
      await rule(alpha.id, 'sample.received', {
        enabled: true,
        contactIds: [maria.id],
        emails: [],
      }).expect(200);
      await as(admin).delete(`/api/v1/clients/${alpha.id}/contacts/${maria.id}`).expect(200);
      const rules = (await as(admin).get(`/api/v1/clients/${alpha.id}/notification-rules`)).body
        .data as ClientNotificationRuleDto[];
      expect(rules[0]!.contacts).toEqual([]);
    });

    it('needs client.manage to change rules', async () => {
      const viewer = await createRole(prisma, {
        tenantId,
        name: 'Viewer',
        modules: ['clients', 'vessels'],
        permissions: ['client.view', 'vessel.view'],
      });
      await createUser(prisma, { email: 'viewer@acme.test', tenantId, roleIds: [viewer.id] });
      const cookie = await loginCookie(app, 'viewer@acme.test');
      await as(cookie).get(`/api/v1/clients/${alpha.id}/notification-rules`).expect(200);
      await as(cookie)
        .put(`/api/v1/clients/${alpha.id}/notification-rules/sample.received`, {
          enabled: true,
          contactIds: [],
          emails: [],
        })
        .expect(403);
      await as(cookie).get(`/api/v1/relationships/${rel.id}/settings`).expect(200);
      await as(cookie)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: null })
        .expect(403);
    });
  });

  describe('billing', () => {
    it("uses the client's default party unless the vessel picks another", async () => {
      const main = await party(alpha.id, 'Alpha HQ', true);
      const ops = await party(alpha.id, 'Alpha Ops Pte');
      let s = await settings();
      expect(s.billing).toMatchObject({
        override: null,
        source: 'client',
        overrideInactive: false,
      });
      expect(s.billing.effective!.id).toBe(main.id);
      expect(s.billingParties.map((p) => p.name)).toEqual(['Alpha HQ', 'Alpha Ops Pte']);

      s = (
        await as(admin)
          .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: ops.id })
          .expect(200)
      ).body.data;
      expect(s.billing.source).toBe('vessel');
      expect(s.billing.effective!.id).toBe(ops.id);
      expect(s.billing.clientDefault!.id).toBe(main.id);

      s = (
        await as(admin)
          .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: null })
          .expect(200)
      ).body.data;
      expect(s.billing).toMatchObject({ override: null, source: 'client' });
      expect(await prisma.vesselBillingOverride.count()).toBe(0);

      const history = await prisma.auditLog.findMany({
        where: { action: 'vessel.billing_changed' },
        orderBy: { occurredAt: 'asc' },
      });
      expect(history.map((h) => h.changes)).toEqual([
        {
          client: { from: null, to: `${alpha.code} Alpha Owners` },
          billingParty: { from: 'Client default', to: 'Alpha Ops Pte' },
        },
        {
          client: { from: null, to: `${alpha.code} Alpha Owners` },
          billingParty: { from: 'Alpha Ops Pte', to: 'Client default' },
        },
      ]);
      expect(history[0]!.relatedIds).toEqual(expect.arrayContaining([alpha.id, rel.id]));
    });

    it("rejects another client's party and inactive parties", async () => {
      const other = await party(beta.id, 'Beta Finance', true);
      const res = await as(admin)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: other.id })
        .expect(400);
      expect(res.body.error.details[0].path).toBe('billingPartyId');

      const old = await party(alpha.id, 'Old Entity');
      await as(admin)
        .patch(`/api/v1/clients/${alpha.id}/billing-parties/${old.id}`, { isActive: false })
        .expect(200);
      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: old.id })
        .expect(400);
    });

    it('the database refuses a party of another client', async () => {
      const other = await party(beta.id, 'Beta Finance');
      await expect(
        prisma.vesselBillingOverride.create({
          data: {
            tenantId,
            relationshipId: rel.id,
            vesselId: vessel.id,
            clientId: alpha.id,
            billingPartyId: other.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('falls back to the default when the chosen party is deactivated', async () => {
      const main = await party(alpha.id, 'Alpha HQ', true);
      const ops = await party(alpha.id, 'Alpha Ops Pte');
      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: ops.id })
        .expect(200);
      await as(admin)
        .patch(`/api/v1/clients/${alpha.id}/billing-parties/${ops.id}`, { isActive: false })
        .expect(200);
      const s = await settings();
      expect(s.billing).toMatchObject({ source: 'client', overrideInactive: true });
      expect(s.billing.effective!.id).toBe(main.id);
    });
  });

  describe('contacts', () => {
    it('supplements client contacts with vessel contacts; client contacts can be hidden', async () => {
      const maria = await contact(alpha.id, 'Maria', 'maria@alpha.test', true);
      await contact(alpha.id, 'Nikos', 'nikos@alpha.test');
      let s = (
        await as(admin)
          .post(`/api/v1/relationships/${rel.id}/contacts`, {
            name: 'Capt. Andersen',
            jobTitle: 'Master',
            email: 'master@aegean-star.test',
          })
          .expect(201)
      ).body.data as VesselLinkSettingsDto;
      expect(s.contacts.vessel.map((c) => [c.name, c.jobTitle])).toEqual([
        ['Capt. Andersen', 'Master'],
      ]);
      expect(s.contacts.client.map((c) => [c.name, c.hidden])).toEqual([
        ['Maria', false],
        ['Nikos', false],
      ]);

      s = (
        await as(admin)
          .put(`/api/v1/relationships/${rel.id}/client-contacts/${maria.id}`, { hidden: true })
          .expect(200)
      ).body.data;
      expect(s.contacts.client.find((c) => c.id === maria.id)!.hidden).toBe(true);

      const master = s.contacts.vessel[0]!;
      s = (
        await as(admin)
          .patch(`/api/v1/vessel-contacts/${master.id}`, { phone: '+47 000' })
          .expect(200)
      ).body.data;
      expect(s.contacts.vessel[0]!.phone).toBe('+47 000');
      s = (await as(admin).delete(`/api/v1/vessel-contacts/${master.id}`).expect(200)).body.data;
      expect(s.contacts.vessel).toEqual([]);

      const actions = (
        await prisma.auditLog.findMany({
          where: { entityId: vessel.id },
          orderBy: { occurredAt: 'asc' },
        })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'vessel.contact_added',
          'vessel.client_contact_hidden',
          'vessel.contact_updated',
          'vessel.contact_removed',
        ]),
      );
    });

    it("cannot hide another client's contact", async () => {
      const bob = await contact(beta.id, 'Bob', 'bob@beta.test');
      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/client-contacts/${bob.id}`, { hidden: true })
        .expect(404);
    });
  });

  describe('notification overrides', () => {
    let maria: { id: string };
    let nikos: { id: string };

    beforeEach(async () => {
      maria = await contact(alpha.id, 'Maria', 'maria@alpha.test', true);
      nikos = await contact(alpha.id, 'Nikos', 'nikos@alpha.test');
      await rule(alpha.id, 'report.published', {
        enabled: true,
        contactIds: [maria.id, nikos.id],
        emails: ['lab@alpha.test'],
      }).expect(200);
    });

    const override = (event: string, body: object, id = rel.id) =>
      as(admin).put(`/api/v1/relationships/${id}/notifications/${event}`, body);

    it('inherits the client rule, without contacts hidden for the vessel', async () => {
      let n = notification(await settings(), 'report.published');
      expect(n.override).toBeNull();
      expect(n.source).toEqual({ enabled: 'client', recipients: 'client' });
      expect(n.effective.enabled).toBe(true);
      expect(n.effective.contacts.map((c) => c.name)).toEqual(['Maria', 'Nikos']);

      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/client-contacts/${nikos.id}`, { hidden: true })
        .expect(200);
      n = notification(await settings(), 'report.published');
      expect(n.effective.contacts.map((c) => c.name)).toEqual(['Maria']);
      expect(n.client.contacts.map((c) => c.name)).toEqual(['Maria', 'Nikos']);
    });

    it('stores only what differs: switching off keeps the client recipients', async () => {
      const s = (
        await override('report.published', { enabled: false, recipients: null }).expect(200)
      ).body.data as VesselLinkSettingsDto;
      const n = notification(s, 'report.published');
      expect(n.override).toEqual({ enabled: false, recipients: null });
      expect(n.effective.enabled).toBe(false);
      expect(n.source).toEqual({ enabled: 'vessel', recipients: 'client' });
      expect(n.effective.emails).toEqual(['lab@alpha.test']);

      // The client later changes its rule; the vessel keeps its own on/off but follows recipients.
      await rule(alpha.id, 'report.published', {
        enabled: true,
        contactIds: [maria.id],
        emails: [],
      }).expect(200);
      const after = notification(await settings(), 'report.published');
      expect(after.effective).toMatchObject({ enabled: false, emails: [] });
      expect(after.effective.contacts.map((c) => c.name)).toEqual(['Maria']);
    });

    it('replaces recipients with client and vessel contacts and extra emails', async () => {
      const withMaster = (
        await as(admin)
          .post(`/api/v1/relationships/${rel.id}/contacts`, {
            name: 'Capt. Andersen',
            email: 'master@aegean-star.test',
          })
          .expect(201)
      ).body.data as VesselLinkSettingsDto;
      const master = withMaster.contacts.vessel[0]!;
      const s = (
        await override('report.critical', {
          enabled: true,
          recipients: { contactIds: [master.id, nikos.id], emails: ['superintendent@alpha.test'] },
        }).expect(200)
      ).body.data as VesselLinkSettingsDto;
      const n = notification(s, 'report.critical');
      expect(n.client.enabled).toBe(false);
      expect(n.effective.enabled).toBe(true);
      expect(n.effective.contacts.map((c) => [c.name, c.source])).toEqual([
        ['Capt. Andersen', 'vessel'],
        ['Nikos', 'client'],
      ]);
      expect(n.effective.emails).toEqual(['superintendent@alpha.test']);
      expect(n.source).toEqual({ enabled: 'vessel', recipients: 'vessel' });

      // Removing the vessel contact drops it from the override.
      const afterRemoval = (
        await as(admin).delete(`/api/v1/vessel-contacts/${master.id}`).expect(200)
      ).body.data as VesselLinkSettingsDto;
      expect(
        notification(afterRemoval, 'report.critical').effective.contacts.map((c) => c.name),
      ).toEqual(['Nikos']);
    });

    it('clearing both parts removes the override and is audited', async () => {
      await override('sample.received', { enabled: true, recipients: null }).expect(200);
      const s = (await override('sample.received', { enabled: null, recipients: null }).expect(200))
        .body.data as VesselLinkSettingsDto;
      expect(notification(s, 'sample.received').override).toBeNull();
      expect(await prisma.vesselNotificationOverride.count()).toBe(0);
      const actions = (
        await prisma.auditLog.findMany({
          where: { action: { startsWith: 'vessel.notification' } },
          orderBy: { occurredAt: 'asc' },
        })
      ).map((a) => [a.action, a.changes]);
      expect(actions).toEqual([
        [
          'vessel.notification_override_changed',
          expect.objectContaining({
            event: { from: null, to: 'Sample received' },
            enabled: { from: 'As client', to: 'On' },
          }),
        ],
        [
          'vessel.notification_override_removed',
          expect.objectContaining({ enabled: { from: 'On', to: 'As client' } }),
        ],
      ]);
    });

    it('rejects recipients from another client or another vessel link', async () => {
      const bob = await contact(beta.id, 'Bob', 'bob@beta.test');
      const res = await override('report.published', {
        enabled: null,
        recipients: { contactIds: [bob.id], emails: [] },
      }).expect(400);
      expect(res.body.error.details[0].path).toBe('recipients.contactIds');
    });

    it('the database refuses an override that changes nothing', async () => {
      await expect(
        prisma.vesselNotificationOverride.create({
          data: {
            tenantId,
            relationshipId: rel.id,
            vesselId: vessel.id,
            clientId: alpha.id,
            event: 'sample.received',
            enabled: null,
            customRecipients: false,
          },
        }),
      ).rejects.toThrow(/vno_changes_something_chk/);
    });
  });

  describe('scope', () => {
    it('keeps separate settings per client link of the same vessel', async () => {
      const betaRel = (
        await as(admin)
          .post(`/api/v1/vessels/${vessel.id}/relationships`, {
            clientId: beta.id,
            relationshipTypeId: (
              await createReferenceItem(prisma, {
                list: 'vessel-relationship-type',
                code: 'MANAGER',
                name: 'Ship Manager',
              })
            ).id,
          })
          .expect(201)
      ).body.data as VesselRelationshipDto;
      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/notifications/sample.received`, {
          enabled: true,
          recipients: null,
        })
        .expect(200);
      expect(notification(await settings(rel.id), 'sample.received').effective.enabled).toBe(true);
      expect(notification(await settings(betaRel.id), 'sample.received').effective.enabled).toBe(
        false,
      );
    });

    it('ended relationships stay readable but cannot change', async () => {
      await as(admin).post(`/api/v1/relationships/${rel.id}/end`, {}).expect(201);
      const s = await settings();
      expect(s.editable).toBe(false);
      await as(admin)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: null })
        .expect(400);
      await as(admin)
        .post(`/api/v1/relationships/${rel.id}/contacts`, { name: 'Late' })
        .expect(400);
    });

    it('other organisations cannot see or change the settings', async () => {
      const other = await createTenant(prisma, { slug: 'other', modules: ['clients', 'vessels'] });
      await createUser(prisma, {
        email: 'admin@other.test',
        tenantId: other.id,
        roleIds: [other.adminRoleId],
      });
      const outsider = await loginCookie(app, 'admin@other.test');
      await as(outsider).get(`/api/v1/relationships/${rel.id}/settings`).expect(404);
      await as(outsider)
        .put(`/api/v1/relationships/${rel.id}/billing`, { billingPartyId: null })
        .expect(404);
      await as(outsider).get(`/api/v1/clients/${alpha.id}/notification-rules`).expect(404);
    });

    it('needs the Clients module', async () => {
      await prisma.tenantModule.deleteMany({ where: { tenantId, moduleKey: 'clients' } });
      await as(admin).get(`/api/v1/relationships/${rel.id}/settings`).expect(403);
    });
  });
});
