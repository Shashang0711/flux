import { Controller, Get, HttpStatus, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode, type HealthStatus } from '@flux/shared';
import { APP_VERSION } from '../../common/app-info/app-version';
import { AppException } from '../../common/errors/app.exception';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../auth/decorators';
import { FILE_STORAGE, type FileStorage } from '../files/storage';
import { NotificationsWorker } from '../notifications/notifications.worker';

/** A worker that has not checked in for this many poll intervals counts as stale. */
const STALE_INTERVALS = 5;

@Public()
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    private readonly worker: NotificationsWorker,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Liveness: the process answers. No dependencies, so a slow database never restarts it. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: send traffic here only while the database and file storage are reachable. */
  @Get()
  async check(): Promise<HealthStatus> {
    await this.require('Database', () => this.prisma.ping());
    await this.require('File storage', () => this.storage.check());
    const notifications = this.notificationsState();
    return {
      status: notifications === 'stale' ? 'degraded' : 'ok',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: 'up', storage: 'up', notifications },
    };
  }

  private notificationsState(): HealthStatus['checks']['notifications'] {
    if (!this.worker.enabled) return 'off';
    const seconds = this.config.get('NOTIFICATIONS_POLL_SECONDS', { infer: true });
    const limit = Math.max(STALE_INTERVALS * seconds * 1000, 60_000);
    const last = this.worker.lastTickAt?.getTime() ?? this.startedAt;
    return Date.now() - last > limit ? 'stale' : 'up';
  }

  private async require(name: string, check: () => Promise<unknown>): Promise<void> {
    try {
      await check();
    } catch (error) {
      this.logger.error(`${name} check failed: ${(error as Error).message}`);
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        `${name} is unreachable`,
      );
    }
  }
}
