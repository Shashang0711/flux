import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';

/** Health checks (liveness, readiness) and Prometheus metrics. */
@Module({
  imports: [FilesModule, NotificationsModule],
  controllers: [HealthController, MetricsController],
})
export class HealthModule {}
