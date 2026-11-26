import type { Readable } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { Gauge } from 'prom-client';
import { registry } from '../../common/metrics/metrics';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { FILE_STORAGE, type FileStorage } from '../files/storage';
import { Mailer } from './mailer';

/** Minutes to wait after the 1st, 2nd, 3rd and 4th failure; the 5th failure is final. */
const BACKOFF_MINUTES = [1, 5, 30, 120];
const MAX_ATTEMPTS = BACKOFF_MINUTES.length + 1;
const BATCH = 20;
/** A delivery stuck in SENDING this long (e.g. the process died) is put back in the queue. */
const STUCK_MINUTES = 10;

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}

const lastTick = new Gauge({
  name: 'flux_notifications_worker_last_tick_timestamp_seconds',
  help: 'When the notification worker last checked for due deliveries (Unix time)',
  registers: [registry],
});

interface Claimed {
  id: string;
  notification_id: string;
  email: string;
  name: string | null;
  attempts: number;
}

/**
 * Sends queued notification deliveries. Runs in the API process every NOTIFICATIONS_POLL_SECONDS
 * (NOTIFICATIONS_WORKER=on). Claims work with FOR UPDATE SKIP LOCKED, so several API instances
 * never send the same delivery twice; failures are retried with back-off and then marked FAILED
 * (a user can retry them). Works across tenants with system access.
 */
@Injectable()
export class NotificationsWorker implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(NotificationsWorker.name);
  private timer?: NodeJS.Timeout;
  private current?: Promise<void>;
  /** Last completed check (readiness: a stuck worker shows as stale). Null until the first. */
  lastTickAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: Mailer,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('NOTIFICATIONS_WORKER', { infer: true }) !== 'on') return;
    const seconds = this.config.get('NOTIFICATIONS_POLL_SECONDS', { infer: true });
    this.timer = setInterval(() => void this.tick(), seconds * 1000);
  }

  get enabled(): boolean {
    return this.config.get('NOTIFICATIONS_WORKER', { infer: true }) === 'on';
  }

  /** Stops polling and lets a batch in progress finish before the database closes. */
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.current;
  }

  private tick(): void {
    if (this.current) return;
    this.current = this.runOnce()
      .then(() => {
        this.lastTickAt = new Date();
        lastTick.setToCurrentTime();
      })
      .catch((error: Error) => this.logger.error(`Notification worker failed: ${error.message}`))
      .finally(() => (this.current = undefined));
  }

  /** Sends what is due now. Returns counts (also used by tests). */
  async runOnce(): Promise<{ sent: number; retrying: number; failed: number }> {
    await this.prisma.notificationDelivery.updateMany({
      where: {
        status: 'SENDING',
        updatedAt: { lt: new Date(Date.now() - STUCK_MINUTES * 60_000) },
      },
      data: { status: 'PENDING' },
    });
    const claimed = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE notification_deliveries
         SET status = 'SENDING', attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM notification_deliveries
          WHERE status = 'PENDING' AND next_attempt_at <= now()
          ORDER BY next_attempt_at
          LIMIT ${BATCH}
          FOR UPDATE SKIP LOCKED)
      RETURNING id, notification_id, email, name, attempts`;

    const counts = { sent: 0, retrying: 0, failed: 0 };
    const attachments = new Map<
      string,
      { filename: string; content: Buffer; contentType: string }
    >();
    for (const d of claimed) {
      try {
        const n = await this.prisma.notification.findUniqueOrThrow({
          where: { id: d.notification_id },
          include: { attachment: true },
        });
        const files = [];
        if (n.attachment) {
          if (!attachments.has(n.attachment.id)) {
            attachments.set(n.attachment.id, {
              filename: n.attachment.name,
              content: await toBuffer(await this.storage.get(n.attachment.storageKey)),
              contentType: n.attachment.contentType ?? 'application/octet-stream',
            });
          }
          files.push(attachments.get(n.attachment.id)!);
        }
        await this.mailer.send({
          to: { email: d.email, name: d.name },
          subject: n.subject,
          text: n.bodyText,
          html: n.bodyHtml,
          attachments: files,
        });
        await this.prisma.notificationDelivery.update({
          where: { id: d.id },
          data: { status: 'SENT', sentAt: new Date(), lastError: null },
        });
        counts.sent++;
      } catch (error) {
        const message = ((error as Error).message ?? String(error)).slice(0, 500);
        const final = d.attempts >= MAX_ATTEMPTS;
        await this.prisma.notificationDelivery.update({
          where: { id: d.id },
          data: final
            ? { status: 'FAILED', lastError: message }
            : {
                status: 'PENDING',
                lastError: message,
                nextAttemptAt: new Date(Date.now() + BACKOFF_MINUTES[d.attempts - 1]! * 60_000),
              },
        });
        if (final) counts.failed++;
        else counts.retrying++;
        // The delivery id, not the address: logs must not collect personal data.
        this.logger.warn(`Delivery ${d.id} failed (attempt ${d.attempts}): ${message}`);
      }
    }
    return counts;
  }
}
