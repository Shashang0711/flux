import { z } from 'zod';
import { emailSchema } from '../identity/users';

/**
 * Events a client can be notified about. Keys are stored: add or retire, never rename.
 * Sending starts with the sample workflow; M8 stores who should receive what.
 */
export const NOTIFICATION_EVENTS = [
  {
    key: 'sample.received',
    name: 'Sample received',
    description: 'A sample for this client arrives at the laboratory.',
  },
  {
    key: 'report.published',
    name: 'Report published',
    description: 'A test report is published to the client.',
  },
  {
    key: 'report.critical',
    name: 'Critical result',
    description: 'A published report contains a critical (alarm) result.',
  },
  {
    key: 'sample.delayed',
    name: 'Sample delayed',
    description: 'Testing of a sample is running past its expected turnaround.',
  },
] as const satisfies readonly { key: string; name: string; description: string }[];

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number]['key'];
export const NOTIFICATION_EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key) as [
  NotificationEventKey,
  ...NotificationEventKey[],
];

export function notificationEventName(key: string): string {
  return NOTIFICATION_EVENTS.find((e) => e.key === key)?.name ?? key;
}

/** A contact receiving a notification. `source` tells client contacts from vessel-only ones. */
export interface NotificationContactDto {
  id: string;
  name: string;
  email: string | null;
  source: 'client' | 'vessel';
}

export interface NotificationRecipientsDto {
  contacts: NotificationContactDto[];
  /** Extra addresses that are not contacts. */
  emails: string[];
}

/** The client's rule for one event. Events never configured are returned switched off. */
export interface ClientNotificationRuleDto extends NotificationRecipientsDto {
  event: NotificationEventKey;
  enabled: boolean;
  /** False when the client has no stored rule for this event yet. */
  configured: boolean;
  updatedAt: string | null;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** Extra email addresses: trimmed, lower-cased, de-duplicated; at most 20. */
export const notificationEmailsSchema = z
  .array(emailSchema)
  .max(20, 'At most 20 extra addresses')
  .transform((list) => [...new Set(list.map((e) => e.toLowerCase()))]);

export const notificationRecipientsSchema = z.object({
  contactIds: z
    .array(z.uuid())
    .max(50)
    .transform((ids) => [...new Set(ids)]),
  emails: notificationEmailsSchema,
});
export type NotificationRecipientsInput = z.output<typeof notificationRecipientsSchema>;

export const clientNotificationRuleSchema = notificationRecipientsSchema.extend({
  enabled: z.boolean(),
});
export type ClientNotificationRuleRequest = z.input<typeof clientNotificationRuleSchema>;

export const notificationEventParamSchema = z.enum(NOTIFICATION_EVENT_KEYS, {
  message: 'Unknown notification event',
});

/**
 * One line per address in the UI's textarea → list. Splits on new lines, commas and semicolons.
 */
export function parseEmailList(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((v) => v.trim())
    .filter(Boolean);
}
