import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import {
  PlatformReferenceDataController,
  ReferenceDataController,
} from './reference-data.controller';
import { PlatformReferenceDataService } from './platform-reference-data.service';
import { ReferenceDataService } from './reference-data.service';

@Module({
  imports: [AuditModule],
  controllers: [ReferenceDataController, PlatformReferenceDataController],
  providers: [ReferenceDataService, PlatformReferenceDataService],
})
export class ReferenceDataModule {}
