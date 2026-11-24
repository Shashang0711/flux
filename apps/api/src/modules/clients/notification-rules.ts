import { HttpStatus } from '@nestjs/common';
import {
  ErrorCode,
  NOTIFICATION_EVENTS,
  type ClientNotificationRuleDto,
  type NotificationContactDto,
  type NotificationEventKey,
} from '@flux/shared';
import { AppException } from '../../common/errors/app.exception';
import type { TenantTx } from '../../database/tenant-db.service';

export function fieldError(path: string, message: string): AppException {
  return new AppException(
    HttpStatus.BAD_REQUEST,
    ErrorCode.VALIDATION_ERROR,
    'Request validation failed',
    [{ path, message }],
  );
}

const contactRef = (c: { id: string; name: string; email: string | null }) =>
  ({ id: c.id, name: c.name, email: c.email, source: 'client' }) satisfies NotificationContactDto;

/**
 * The client's rule for every event in the catalogue, in catalogue order. Events without a
 * stored rule come back switched off with no recipients. Used by the client's Notifications tab
 * and as the defaults a vessel inherits.
 */
export async function loadClientRules(
  tx: TenantTx,
  clientId: string,
): Promise<ClientNotificationRuleDto[]> {
  const rows = await tx.clientNotificationRule.findMany({
    where: { clientId },
    include: { contacts: { include: { contact: true } } },
  });
  return NOTIFICATION_EVENTS.map(({ key }) => {
    const row = rows.find((r) => r.event === key);
    return {
      event: key as NotificationEventKey,
      enabled: row?.enabled ?? false,
      configured: Boolean(row),
      contacts: (row?.contacts ?? [])
        .map((c) => contactRef(c.contact))
        .sort((a, b) => a.name.localeCompare(b.name)),
      emails: row?.extraEmails ?? [],
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  });
}

/** Recipients as readable strings for the audit log: contact names, then addresses. */
export function recipientLabels(r: { contacts: { name: string }[]; emails: string[] }): string[] {
  return [...r.contacts.map((c) => c.name), ...r.emails];
}
