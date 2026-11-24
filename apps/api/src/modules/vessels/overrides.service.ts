import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  notificationEventName,
  type NotificationContactDto,
  type NotificationEventKey,
  type VesselContactDto,
  type VesselLinkSettingsDto,
  type VesselNotificationDto,
  type updateVesselContactSchema,
  type vesselContactSchema,
  type vesselNotificationOverrideSchema,
} from '@flux/shared';
import type { z } from 'zod';
import { AppException } from '../../common/errors/app.exception';
import { TenantDb, type TenantTx } from '../../database/tenant-db.service';
import {
  compactChanges,
  fieldChanges,
  listChange,
  recordAudit,
  type AuditEntry,
} from '../audit/audit';
import type { AuthUser, TenantContext } from '../auth/auth.types';
import { BILLING_PARTY_ORDER, toBillingPartyDto, toContactDto } from '../clients/client.mapper';
import { fieldError, loadClientRules, recipientLabels } from '../clients/notification-rules';
import { RELATIONSHIP_INCLUDE, toRelationshipDto } from './relationships.service';

const SETTINGS_INCLUDE = {
  ...RELATIONSHIP_INCLUDE,
  billingOverrides: { include: { billingParty: true } },
  vesselContacts: { orderBy: { name: 'asc' } },
  hiddenClientContacts: true,
  notificationOverrides: {
    include: {
      clientContacts: { include: { contact: true } },
      vesselContacts: { include: { contact: true } },
    },
  },
} satisfies Prisma.VesselClientRelationshipInclude;

type LinkRow = Prisma.VesselClientRelationshipGetPayload<{ include: typeof SETTINGS_INCLUDE }>;

const VESSEL_CONTACT_FIELDS = ['name', 'jobTitle', 'email', 'phone'] as const;

function toVesselContactDto(c: VesselContactDto): VesselContactDto {
  return { id: c.id, name: c.name, jobTitle: c.jobTitle, email: c.email, phone: c.phone };
}

const ref = (
  c: { id: string; name: string; email: string | null },
  source: NotificationContactDto['source'],
): NotificationContactDto => ({ id: c.id, name: c.name, email: c.email, source });

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Vessel-level overrides per vessel–client relationship (design pack §15). The client's settings
 * are the default; these records hold only what differs for one vessel, and `settings()` resolves
 * the effective values (with their source) for the vessel's Billing, Contacts and Notifications
 * tabs. Changes are audited on the vessel, with the client and relationship as related records.
 */
@Injectable()
export class OverridesService {
  constructor(private readonly db: TenantDb) {}

  settings(ctx: TenantContext, relationshipId: string): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, (tx) => this.resolve(tx, relationshipId));
  }

  // ─── Billing ──────────────────────────────────────────────────────────────

  setBilling(
    ctx: TenantContext,
    relationshipId: string,
    billingPartyId: string | null,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const link = await this.findEditable(tx, relationshipId);
      const current = link.billingOverrides[0]?.billingParty ?? null;
      if ((current?.id ?? null) === billingPartyId) return this.resolve(tx, relationshipId);
      let toName = 'Client default';
      if (billingPartyId) {
        const party = await tx.billingParty.findFirst({
          where: { id: billingPartyId, clientId: link.clientId },
        });
        if (!party)
          throw fieldError('billingPartyId', "Choose one of this client's billing parties");
        if (!party.isActive) throw fieldError('billingPartyId', 'This billing party is inactive');
        await tx.vesselBillingOverride.upsert({
          where: { relationshipId },
          create: {
            tenantId: ctx.tenantId,
            relationshipId,
            vesselId: link.vesselId,
            clientId: link.clientId,
            billingPartyId,
          },
          update: { billingPartyId },
        });
        toName = party.name;
      } else {
        await tx.vesselBillingOverride.deleteMany({ where: { relationshipId } });
      }
      await this.audit(tx, ctx, actor, link, 'vessel.billing_changed', {
        billingParty: { from: current?.name ?? 'Client default', to: toName },
      });
      return this.resolve(tx, relationshipId);
    });
  }

  // ─── Contacts ─────────────────────────────────────────────────────────────

  addContact(
    ctx: TenantContext,
    relationshipId: string,
    input: z.output<typeof vesselContactSchema>,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const link = await this.findEditable(tx, relationshipId);
      const contact = await tx.vesselContact.create({
        data: {
          tenantId: ctx.tenantId,
          relationshipId,
          vesselId: link.vesselId,
          clientId: link.clientId,
          name: input.name,
          jobTitle: input.jobTitle ?? null,
          email: input.email ?? null,
          phone: input.phone ?? null,
        },
      });
      await this.audit(
        tx,
        ctx,
        actor,
        link,
        'vessel.contact_added',
        fieldChanges(null, contact, VESSEL_CONTACT_FIELDS),
        [contact.id],
      );
      return this.resolve(tx, relationshipId);
    });
  }

  updateContact(
    ctx: TenantContext,
    contactId: string,
    input: z.output<typeof updateVesselContactSchema>,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const before = await this.findVesselContact(tx, contactId);
      const link = await this.findEditable(tx, before.relationshipId);
      const updated = await tx.vesselContact.update({ where: { id: contactId }, data: input });
      const changes = fieldChanges(before, updated, VESSEL_CONTACT_FIELDS);
      if (Object.keys(changes).length > 0) {
        await this.audit(
          tx,
          ctx,
          actor,
          link,
          'vessel.contact_updated',
          { contact: { from: null, to: updated.name }, ...changes },
          [contactId],
        );
      }
      return this.resolve(tx, link.id);
    });
  }

  removeContact(
    ctx: TenantContext,
    contactId: string,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const contact = await this.findVesselContact(tx, contactId);
      const link = await this.findEditable(tx, contact.relationshipId);
      // Also drops the contact from this vessel's notification overrides (cascade).
      await tx.vesselContact.delete({ where: { id: contactId } });
      await this.audit(
        tx,
        ctx,
        actor,
        link,
        'vessel.contact_removed',
        { contact: { from: contact.name, to: null } },
        [contactId],
      );
      return this.resolve(tx, link.id);
    });
  }

  /** Hides one of the client's contacts for this vessel, or shows it again. */
  setClientContactHidden(
    ctx: TenantContext,
    relationshipId: string,
    contactId: string,
    hidden: boolean,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const link = await this.findEditable(tx, relationshipId);
      const contact = await tx.clientContact.findFirst({
        where: { id: contactId, clientId: link.clientId },
      });
      if (!contact) throw AppException.notFound('Contact', contactId);
      const isHidden = link.hiddenClientContacts.some((h) => h.contactId === contactId);
      if (isHidden === hidden) return this.resolve(tx, relationshipId);
      if (hidden) {
        await tx.vesselHiddenClientContact.create({
          data: {
            tenantId: ctx.tenantId,
            relationshipId,
            vesselId: link.vesselId,
            clientId: link.clientId,
            contactId,
          },
        });
      } else {
        await tx.vesselHiddenClientContact.deleteMany({ where: { relationshipId, contactId } });
      }
      await this.audit(
        tx,
        ctx,
        actor,
        link,
        hidden ? 'vessel.client_contact_hidden' : 'vessel.client_contact_shown',
        { contact: { from: null, to: contact.name } },
        [contactId],
      );
      return this.resolve(tx, relationshipId);
    });
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  /** Stores what differs from the client's rule for one event; both parts null removes it. */
  setNotification(
    ctx: TenantContext,
    relationshipId: string,
    event: NotificationEventKey,
    input: z.output<typeof vesselNotificationOverrideSchema>,
    actor: AuthUser,
  ): Promise<VesselLinkSettingsDto> {
    return this.db.run(ctx.tenantId, async (tx) => {
      const link = await this.findEditable(tx, relationshipId);
      const before = (await this.resolve(tx, relationshipId)).notifications.find(
        (n) => n.event === event,
      )!;

      if (input.enabled === null && input.recipients === null) {
        await tx.vesselNotificationOverride.deleteMany({ where: { relationshipId, event } });
      } else {
        const ids = input.recipients?.contactIds ?? [];
        const clientIds = (
          await tx.clientContact.findMany({
            where: { clientId: link.clientId, id: { in: ids } },
            select: { id: true },
          })
        ).map((c) => c.id);
        const vesselIds = link.vesselContacts.filter((c) => ids.includes(c.id)).map((c) => c.id);
        if (clientIds.length + vesselIds.length !== ids.length) {
          throw fieldError(
            'recipients.contactIds',
            "Choose from the client's contacts and this vessel's contacts",
          );
        }
        const data = {
          enabled: input.enabled,
          customRecipients: input.recipients !== null,
          extraEmails: input.recipients?.emails ?? [],
        };
        const override = await tx.vesselNotificationOverride.upsert({
          where: { relationshipId_event: { relationshipId, event } },
          create: {
            tenantId: ctx.tenantId,
            relationshipId,
            vesselId: link.vesselId,
            clientId: link.clientId,
            event,
            ...data,
          },
          update: data,
        });
        const where = { overrideId: override.id };
        await tx.vesselNotificationOverrideContact.deleteMany({ where });
        await tx.vesselNotificationOverrideVesselContact.deleteMany({ where });
        const pin = {
          tenantId: ctx.tenantId,
          overrideId: override.id,
          relationshipId,
          clientId: link.clientId,
        };
        await tx.vesselNotificationOverrideContact.createMany({
          data: clientIds.map((contactId) => ({ ...pin, contactId })),
        });
        await tx.vesselNotificationOverrideVesselContact.createMany({
          data: vesselIds.map((contactId) => ({ ...pin, contactId })),
        });
      }

      const after = (await this.resolve(tx, relationshipId)).notifications.find(
        (n) => n.event === event,
      )!;
      const changes = compactChanges({
        enabled:
          before.override?.enabled !== after.override?.enabled
            ? { from: describeEnabled(before), to: describeEnabled(after) }
            : undefined,
        recipients: listChange(describeRecipients(before), describeRecipients(after)),
      });
      if (changes) {
        await this.audit(
          tx,
          ctx,
          actor,
          link,
          after.override
            ? 'vessel.notification_override_changed'
            : 'vessel.notification_override_removed',
          { event: { from: null, to: notificationEventName(event) }, ...changes },
        );
      }
      return this.resolve(tx, relationshipId);
    });
  }

  // ─── Resolution ───────────────────────────────────────────────────────────

  private async resolve(tx: TenantTx, relationshipId: string): Promise<VesselLinkSettingsDto> {
    const link = await this.findLink(tx, relationshipId);
    const [parties, clientContacts, rules] = await Promise.all([
      tx.billingParty.findMany({
        where: { clientId: link.clientId },
        orderBy: BILLING_PARTY_ORDER,
      }),
      tx.clientContact.findMany({
        where: { clientId: link.clientId },
        orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      }),
      loadClientRules(tx, link.clientId),
    ]);

    // Billing: the chosen party while it is active, else the client's default.
    const chosen = link.billingOverrides[0]?.billingParty ?? null;
    const clientDefault = parties.find((p) => p.isDefault && p.isActive) ?? null;
    const useChosen = chosen !== null && chosen.isActive;
    const effective = useChosen ? chosen : clientDefault;

    // Contacts: the client's (minus hidden ones) plus this vessel's own.
    const hidden = new Set(link.hiddenClientContacts.map((h) => h.contactId));

    const notifications: VesselNotificationDto[] = rules.map((rule) => {
      const o = link.notificationOverrides.find((n) => n.event === rule.event) ?? null;
      const inherited = {
        contacts: rule.contacts.filter((c) => !hidden.has(c.id)),
        emails: rule.emails,
      };
      const own = o?.customRecipients
        ? {
            contacts: [
              ...o.clientContacts.map((c) => ref(c.contact, 'client')),
              ...o.vesselContacts.map((c) => ref(c.contact, 'vessel')),
            ].sort(byName),
            emails: o.extraEmails,
          }
        : null;
      return {
        event: rule.event,
        client: { enabled: rule.enabled, contacts: rule.contacts, emails: rule.emails },
        override: o ? { enabled: o.enabled, recipients: own } : null,
        effective: { enabled: o?.enabled ?? rule.enabled, ...(own ?? inherited) },
        source: {
          enabled: o?.enabled !== null && o?.enabled !== undefined ? 'vessel' : 'client',
          recipients: own ? 'vessel' : 'client',
        },
      };
    });

    return {
      relationship: toRelationshipDto(link),
      editable: link.status === 'ACTIVE',
      billing: {
        override: chosen ? toBillingPartyDto(chosen) : null,
        clientDefault: clientDefault ? toBillingPartyDto(clientDefault) : null,
        effective: effective ? toBillingPartyDto(effective) : null,
        source: effective ? (useChosen ? 'vessel' : 'client') : null,
        overrideInactive: chosen !== null && !chosen.isActive,
      },
      billingParties: parties.filter((p) => p.isActive).map(toBillingPartyDto),
      contacts: {
        client: clientContacts.map((c) => ({ ...toContactDto(c), hidden: hidden.has(c.id) })),
        vessel: link.vesselContacts.map(toVesselContactDto),
      },
      notifications,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findLink(tx: TenantTx, id: string): Promise<LinkRow> {
    const link = await tx.vesselClientRelationship.findUnique({
      where: { id },
      include: SETTINGS_INCLUDE,
    });
    if (!link) throw AppException.notFound('Relationship', id);
    return link;
  }

  /** Overrides of ended relationships are kept as history and cannot change. */
  private async findEditable(tx: TenantTx, id: string): Promise<LinkRow> {
    const link = await this.findLink(tx, id);
    if (link.status !== 'ACTIVE') throw AppException.badRequest('This relationship has ended');
    return link;
  }

  private async findVesselContact(tx: TenantTx, id: string) {
    const contact = await tx.vesselContact.findUnique({ where: { id } });
    if (!contact) throw AppException.notFound('Vessel contact', id);
    return contact;
  }

  private audit(
    tx: TenantTx,
    ctx: TenantContext,
    actor: AuthUser,
    link: LinkRow,
    action: AuditEntry['action'],
    changes: AuditEntry['changes'],
    extraRelated: string[] = [],
  ): Promise<void> {
    return recordAudit(tx, {
      tenantId: ctx.tenantId,
      actor,
      action,
      entity: {
        type: 'vessel',
        id: link.vesselId,
        label: `${link.vessel.code} ${link.vessel.name}`,
      },
      relatedIds: [link.clientId, link.id, ...extraRelated],
      changes: {
        client: { from: null, to: `${link.client.code} ${link.client.name}` },
        ...(changes ?? {}),
      },
    });
  }
}

function describeEnabled(n: VesselNotificationDto): string {
  const e = n.override?.enabled;
  return e === null || e === undefined ? 'As client' : e ? 'On' : 'Off';
}

function describeRecipients(n: VesselNotificationDto): string[] {
  return n.override?.recipients ? recipientLabels(n.override.recipients) : ['(as client)'];
}
