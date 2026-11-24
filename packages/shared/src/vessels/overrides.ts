import { z } from 'zod';
import type { BillingPartyDto, ClientContactDto } from '../clients/clients';
import { emailSchema } from '../identity/users';
import {
  notificationRecipientsSchema,
  type NotificationEventKey,
  type NotificationRecipientsDto,
} from '../notifications/notifications';
import type { VesselRelationshipDto } from './relationships';

/**
 * Vessel-level overrides (design pack §15), stored per vessel–client relationship.
 *
 * Precedence, decided for M8:
 * - Billing: the relationship may name one of the client's active billing parties; otherwise the
 *   client's default billing party is used. No billing data is copied.
 * - Contacts: the client's contacts plus vessel-only contacts; individual client contacts can be
 *   hidden for this vessel.
 * - Notifications: the client's rule per event is the default. An override stores only what
 *   differs: on/off (null = as the client) and/or its own recipients (null = the client's,
 *   without contacts hidden for this vessel).
 */

/** A contact who exists only for this vessel (e.g. the ship's master), under one client. */
export interface VesselContactDto {
  id: string;
  name: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
}

export type SettingSource = 'client' | 'vessel';

export interface VesselBillingDto {
  /** The party chosen for this vessel, or null when the client default applies. */
  override: BillingPartyDto | null;
  clientDefault: BillingPartyDto | null;
  /** The party that will be invoiced. */
  effective: BillingPartyDto | null;
  source: SettingSource | null;
  /** The chosen party was deactivated after it was chosen, so the default applies again. */
  overrideInactive: boolean;
}

export interface VesselContactsDto {
  /** All of the client's contacts, with whether each is hidden for this vessel. */
  client: (ClientContactDto & { hidden: boolean })[];
  vessel: VesselContactDto[];
}

export interface VesselNotificationDto {
  event: NotificationEventKey;
  client: { enabled: boolean } & NotificationRecipientsDto;
  /** Null when this vessel follows the client's rule. */
  override: { enabled: boolean | null; recipients: NotificationRecipientsDto | null } | null;
  effective: { enabled: boolean } & NotificationRecipientsDto;
  source: { enabled: SettingSource; recipients: SettingSource };
}

/** Everything the vessel's Billing, Contacts and Notifications tabs show for one client link. */
export interface VesselLinkSettingsDto {
  relationship: VesselRelationshipDto;
  /** False for ended relationships: shown as history, not editable. */
  editable: boolean;
  billing: VesselBillingDto;
  /** The client's active billing parties, to choose from. */
  billingParties: BillingPartyDto[];
  contacts: VesselContactsDto;
  notifications: VesselNotificationDto[];
}

// ─── Validation ─────────────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** null: use the client's default billing party. */
export const setVesselBillingSchema = z.object({ billingPartyId: z.uuid().nullable() });

export const vesselContactSchema = z.object({
  name: z.string().trim().min(1, 'Required').max(200),
  jobTitle: optionalText(100),
  email: z
    .union([z.literal(''), emailSchema])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  phone: optionalText(50),
});
export const updateVesselContactSchema = vesselContactSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

export const setClientContactVisibilitySchema = z.object({ hidden: z.boolean() });

/**
 * Both null removes the override (the vessel follows the client again).
 * `recipients.contactIds` may name the client's contacts and this vessel's own contacts.
 */
export const vesselNotificationOverrideSchema = z.object({
  enabled: z.boolean().nullable(),
  recipients: notificationRecipientsSchema.nullable(),
});
export type VesselNotificationOverrideRequest = z.input<typeof vesselNotificationOverrideSchema>;
