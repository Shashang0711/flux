import { Module } from '@nestjs/common';
import { CatalogueService } from './catalogue.service';
import { KitsService } from './kits.service';
import { LabController } from './lab.controller';
import { StarterService } from './starter.service';

@Module({
  controllers: [LabController],
  providers: [CatalogueService, KitsService, StarterService],
  exports: [CatalogueService],
})
export class LabModule {}
