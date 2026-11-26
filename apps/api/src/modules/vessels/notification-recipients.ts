import type { NotificationEventKey } from '@flux/shared';
import type { TenantTx } from '../../database/tenant-db.service';
import { loadClientRules } from '../clients/notification-rules';

export interface EffectiveRecipients {
  enabled: boolean;
  /** Unique by address (case-insensitive); contacts without an address are left out. */
  recipients: { email: string; name: string | null }[];
}

/**
 * Who receives an event's notification for a client and (optionally) a vessel, by the M8
 * precedence: the client's rule is the default; an active vessel–client relationship's override
 * changes on/off and/or the recipients; client contacts hidden for that vessel drop out of the
 * inherited recipients. Same rules as OverridesService (vessel Notifications tab).
 */
export async function effectiveRecipients(
  tx: TenantTx,
  clientId: string,
  vesselId: string | null,
  event: NotificationEventKey,
): Promise<EffectiveRecipients> {
  const rule = (await loadClientRules(tx, clientId)).find((r) => r.event === event)!;
  const link = vesselId
    ? await tx.vesselClientRelationship.findFirst({
        where: { vesselId, clientId, status: 'ACTIVE' },
        orderBy: { isPrimary: 'desc' },
        include: {
          hiddenClientContacts: { select: { contactId: true } },
          notificationOverrides: {
            where: { event },
            include: {
              clientContacts: { include: { contact: true } },
              vesselContacts: { include: { contact: true } },
            },
          },
        },
      })
    : null;
  const override = link?.notificationOverrides[0] ?? null;
  const hidden = new Set(link?.hiddenClientContacts.map((h) => h.contactId) ?? []);

  const enabled = override?.enabled ?? rule.enabled;
  const contacts = override?.customRecipients
    ? [
        ...override.clientContacts.map((c) => c.contact),
        ...override.vesselContacts.map((c) => c.contact),
      ]
    : rule.contacts.filter((c) => !hidden.has(c.id));
  const emails = override?.customRecipients ? override.extraEmails : rule.emails;

  const unique = new Map<string, { email: string; name: string | null }>();
  for (const c of contacts) {
    if (c.email && !unique.has(c.email.toLowerCase()))
      unique.set(c.email.toLowerCase(), { email: c.email, name: c.name });
  }
  for (const e of emails)
    if (!unique.has(e.toLowerCase())) unique.set(e.toLowerCase(), { email: e, name: null });
  return { enabled, recipients: [...unique.values()] };
}
