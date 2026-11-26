import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MaintenanceService } from './maintenance.service';

@Module({
  imports: [FilesModule],
  providers: [MaintenanceService],
  exports: [MaintenanceService],
})
export class MaintenanceModule {}
