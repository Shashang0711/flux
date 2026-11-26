import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { LabReportsController } from './lab-reports.controller';
import { LabReportsService } from './lab-reports.service';

@Module({
  imports: [FilesModule, NotificationsModule],
  controllers: [LabReportsController],
  providers: [LabReportsService],
})
export class ReportsModule {}
