import { Injectable } from '@nestjs/common';
import {
  notificationEventName,
  type NotificationDto,
  type NotificationEventKey,
} from '@flux/shared';
import type { TenantTx } from '../../database/tenant-db.service';
import { effectiveRecipients } from '../vessels/notification-recipients';

interface PublishedSample {
  id: string;
  code: string;
  clientId: string;
  clientName: string;
  vesselId: string | null;
  vesselName: string | null;
  serial: string | null;
  critical: { parameter: string; value: string; unit: string | null }[];
}

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Notifications raised by publishing (design pack: notifications, notification_deliveries). They
 * are written in the publishing transaction (an outbox) and sent later by NotificationsWorker, so
 * a report is never published without its emails being queued, and no email goes out for a
 * publication that rolled back.
 */
@Injectable()
export class NotificationsService {
  /**
   * One notification per event and client/vessel group of the report's samples:
   * "Report published" (final PDF attached) for every group, plus "Critical result" for groups
   * with critical results. Recipients follow each vessel's effective rules (M8).
   */
  async queueForPublication(
    tx: TenantTx,
    tenantId: string,
    report: {
      id: string;
      code: string;
      serviceType: string;
      finalFileId: string;
      finalFileName: string;
    },
    samples: PublishedSample[],
  ): Promise<void> {
    const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const lab = tenant?.name ?? 'FLUX';
    const groups = new Map<string, PublishedSample[]>();
    for (const s of samples) {
      const key = `${s.clientId}|${s.vesselId ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), s]);
    }
    for (const group of groups.values()) {
      const first = group[0]!;
      const critical = group.filter((s) => s.critical.length > 0);
      const events: [NotificationEventKey, PublishedSample[]][] = [['report.published', group]];
      if (critical.length > 0) events.push(['report.critical', critical]);
      for (const [event, list] of events) {
        const who = await effectiveRecipients(tx, first.clientId, first.vesselId, event);
        const content = this.render(event, lab, report, first, list);
        const skippedReason = !who.enabled
          ? `The “${notificationEventName(event)}” notification is switched off for this client/vessel`
          : who.recipients.length === 0
            ? 'No recipients with an email address'
            : null;
        await tx.notification.create({
          data: {
            tenantId,
            event,
            reportId: report.id,
            clientName: first.clientName,
            vesselName: first.vesselName,
            sampleCodes: list.map((s) => s.code),
            subject: content.subject,
            bodyText: content.text,
            bodyHtml: content.html,
            attachmentFileId: event === 'report.published' ? report.finalFileId : null,
            skippedReason,
            deliveries: skippedReason
              ? undefined
              : {
                  // tenant_id comes from the parent notification (composite relation).
                  create: who.recipients.map((r) => ({ email: r.email, name: r.name })),
                },
          },
        });
      }
    }
  }

  async forReport(tx: TenantTx, reportId: string): Promise<NotificationDto[]> {
    const rows = await tx.notification.findMany({
      where: { reportId },
      include: { deliveries: { orderBy: { email: 'asc' } } },
      orderBy: [{ createdAt: 'asc' }, { event: 'desc' }],
    });
    return rows.map((n) => ({
      id: n.id,
      event: n.event,
      subject: n.subject,
      samples: n.sampleCodes,
      vessel: n.vesselName,
      client: n.clientName,
      skippedReason: n.skippedReason,
      createdAt: n.createdAt.toISOString(),
      deliveries: n.deliveries.map((d) => ({
        id: d.id,
        email: d.email,
        name: d.name,
        status: d.status,
        attempts: d.attempts,
        lastError: d.lastError,
        sentAt: d.sentAt?.toISOString() ?? null,
      })),
    }));
  }

  /** Failed deliveries of a report go back in the queue (fresh attempts). Returns how many. */
  async retryFailed(tx: TenantTx, reportId: string): Promise<number> {
    const res = await tx.notificationDelivery.updateMany({
      where: { status: 'FAILED', notification: { reportId } },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    return res.count;
  }

  private render(
    event: NotificationEventKey,
    lab: string,
    report: { code: string; serviceType: string; finalFileName: string },
    first: PublishedSample,
    list: PublishedSample[],
  ): { subject: string; text: string; html: string } {
    const about = first.vesselName ?? first.clientName;
    const sampleLines = list.map((s) => `${s.code}${s.serial ? ` (kit ${s.serial})` : ''}`);
    if (event === 'report.critical') {
      const lines = list.flatMap((s) =>
        s.critical.map((c) => `${s.code}: ${c.parameter} ${c.value}${c.unit ? ` ${c.unit}` : ''}`),
      );
      const subject = `Critical result – ${about} – ${report.serviceType} (${report.code})`;
      const intro = `${lab} has published report ${report.code} for ${about} (${report.serviceType}). It contains critical results:`;
      return {
        subject,
        text: `${intro}\n\n${lines.map((l) => `• ${l}`).join('\n')}\n\nThe full report was sent separately.\n\n${lab}`,
        html: `<p>${escape(intro)}</p><ul>${lines.map((l) => `<li><strong>${escape(l)}</strong></li>`).join('')}</ul><p>The full report was sent separately.</p><p>${escape(lab)}</p>`,
      };
    }
    const subject = `Report ${report.code} published – ${about} – ${report.serviceType}`;
    const intro = `${lab} has published report ${report.code} (${report.serviceType}) for ${about}. The report is attached (${report.finalFileName}).`;
    return {
      subject,
      text: `${intro}\n\nSamples:\n${sampleLines.map((l) => `• ${l}`).join('\n')}\n\n${lab}`,
      html: `<p>${escape(intro)}</p><p>Samples:</p><ul>${sampleLines.map((l) => `<li>${escape(l)}</li>`).join('')}</ul><p>${escape(lab)}</p>`,
    };
  }
}
