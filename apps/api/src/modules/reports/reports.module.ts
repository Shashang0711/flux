import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { LabReportsController } from './lab-reports.controller';
import { LabReportsService } from './lab-reports.service';

@Module({
  imports: [FilesModule],
  controllers: [LabReportsController],
  providers: [LabReportsService],
})
export class ReportsModule {}
