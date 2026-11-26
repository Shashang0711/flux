import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { Gauge } from 'prom-client';
import { registry } from '../../common/metrics/metrics';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { FILE_STORAGE, type FileStorage } from '../files/storage';

const lastRun = new Gauge({
  name: 'flux_maintenance_last_run_timestamp_seconds',
  help: 'When the maintenance job last finished (Unix time)',
  registers: [registry],
});

/** An upload nothing uses: never finished, or finished but never attached to anything. */
function abandonedUploads(cutoff: Date): Prisma.StoredFileWhereInput {
  return {
    OR: [
      { status: 'PENDING', createdAt: { lt: cutoff } },
      {
        status: 'READY',
        uploadedAt: { lt: cutoff },
        reportVersions: { none: {} },
        attachments: { none: {} },
        finalReports: { none: {} },
        notifications: { none: {} },
      },
    ],
  };
}

export interface MaintenanceResult {
  sessions: number;
  files: number;
}

/**
 * Housekeeping, every MAINTENANCE_INTERVAL_MINUTES (MAINTENANCE_WORKER=on): deletes sessions
 * that ended more than SESSION_RETENTION_DAYS ago and uploads abandoned for
 * UPLOAD_ABANDON_HOURS (rows and stored objects). With several API instances, a database
 * advisory lock makes sure only one runs it at a time.
 */
@Injectable()
export class MaintenanceService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(MaintenanceService.name);
  private first?: NodeJS.Timeout;
  private timer?: NodeJS.Timeout;
  private current?: Promise<unknown>;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.get('MAINTENANCE_WORKER', { infer: true }) !== 'on') return;
    const minutes = this.config.get('MAINTENANCE_INTERVAL_MINUTES', { infer: true });
    const tick = () => {
      if (this.current) return;
      this.current = this.runOnce()
        .catch((error: Error) => this.logger.error(`Maintenance failed: ${error.message}`))
        .finally(() => (this.current = undefined));
    };
    // First run shortly after start-up, then on the interval.
    this.first = setTimeout(tick, 30_000);
    this.timer = setInterval(tick, minutes * 60_000);
  }

  /** Lets a run in progress finish before the database connection closes. */
  async beforeApplicationShutdown(): Promise<void> {
    clearTimeout(this.first);
    clearInterval(this.timer);
    await this.current;
  }

  async runOnce(now = new Date()): Promise<MaintenanceResult> {
    const days = this.config.get('SESSION_RETENTION_DAYS', { infer: true });
    const hours = this.config.get('UPLOAD_ABANDON_HOURS', { infer: true });
    const sessionCutoff = new Date(now.getTime() - days * 86_400_000);
    const uploadCutoff = new Date(now.getTime() - hours * 3_600_000);

    const outcome = await this.prisma.$transaction(async (tx) => {
      const lock = await tx.$queryRaw<{ locked: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(hashtext('flux.maintenance')) AS locked`;
      if (!lock[0]?.locked) return null;
      const sessions = await tx.session.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: sessionCutoff } },
            { revokedAt: { lt: sessionCutoff } },
            { lastSeenAt: { lt: sessionCutoff } },
          ],
        },
      });
      const candidates = await tx.storedFile.findMany({
        where: abandonedUploads(uploadCutoff),
        select: { id: true, storageKey: true },
        take: 1000,
      });
      const removed: string[] = [];
      for (const file of candidates) {
        // Re-checked in the delete itself, so a file attached meanwhile is kept.
        const deleted = await tx.storedFile.deleteMany({
          where: { id: file.id, ...abandonedUploads(uploadCutoff) },
        });
        if (deleted.count === 1) removed.push(file.storageKey);
      }
      return { sessions: sessions.count, removed };
    });
    if (!outcome) return { sessions: 0, files: 0 };

    // Objects go after the rows are gone for good; a failure only leaves an unreachable object.
    for (const key of outcome.removed) {
      await this.storage.remove(key).catch((error: Error) => {
        this.logger.warn(`Could not remove stored object ${key}: ${error.message}`);
      });
    }
    lastRun.setToCurrentTime();
    if (outcome.sessions > 0 || outcome.removed.length > 0) {
      this.logger.log(
        `Maintenance: removed ${outcome.sessions} old sessions and ${outcome.removed.length} abandoned uploads`,
      );
    }
    return { sessions: outcome.sessions, files: outcome.removed.length };
  }
}
