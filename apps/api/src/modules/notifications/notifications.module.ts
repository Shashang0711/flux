import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { Mailer } from './mailer';
import { NotificationsService } from './notifications.service';
import { NotificationsWorker } from './notifications.worker';

@Module({
  imports: [FilesModule],
  providers: [Mailer, NotificationsService, NotificationsWorker],
  exports: [NotificationsService, NotificationsWorker, Mailer],
})
export class NotificationsModule {}
