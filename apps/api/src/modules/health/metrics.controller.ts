import { createHash, timingSafeEqual } from 'node:crypto';
import { Controller, Get, Headers, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { Gauge } from 'prom-client';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { AppException } from '../../common/errors/app.exception';
import { registry } from '../../common/metrics/metrics';
import type { Env } from '../../config/env';
import { PrismaService } from '../../database/prisma.service';
import { Public } from '../auth/decorators';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Prometheus metrics (process, HTTP, notification queue). Off unless METRICS_TOKEN is set;
 * scrapers send `Authorization: Bearer <token>`. Queue figures are read at scrape time and
 * cover all tenants (counts only, no tenant data).
 */
@Public()
@Controller('metrics')
export class MetricsController {
  private readonly token?: Buffer;

  constructor(prisma: PrismaService, config: ConfigService<Env, true>) {
    const token = config.get('METRICS_TOKEN', { infer: true });
    this.token = token ? digest(token) : undefined;
    if (registry.getSingleMetric('flux_notification_deliveries')) return;
    new Gauge({
      name: 'flux_notification_deliveries',
      help: 'Notification deliveries by status',
      labelNames: ['status'] as const,
      registers: [registry],
      async collect() {
        const rows = await prisma.notificationDelivery.groupBy({
          by: ['status'],
          _count: { _all: true },
        });
        this.reset();
        for (const status of ['PENDING', 'SENDING', 'SENT', 'FAILED']) {
          const row = rows.find((r) => r.status === status);
          this.set({ status }, row?._count._all ?? 0);
        }
      },
    });
  }

  @Get()
  @RawResponse()
  async metrics(
    @Headers('authorization') authorization: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.token) throw AppException.notFound('Route');
    const given = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    // Compare digests: constant time, whatever the length of the given token.
    if (!timingSafeEqual(digest(given), this.token)) throw AppException.unauthenticated();
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
