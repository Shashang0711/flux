import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { FleetsService } from './fleets.service';
import { OverridesController } from './overrides.controller';
import { OverridesService } from './overrides.service';
import { RelationshipsController } from './relationships.controller';
import { RelationshipsService } from './relationships.service';
import { VesselsController } from './vessels.controller';
import { VesselsService } from './vessels.service';

@Module({
  imports: [CustomFieldsModule],
  controllers: [VesselsController, RelationshipsController, OverridesController],
  providers: [VesselsService, RelationshipsService, FleetsService, OverridesService],
})
export class VesselsModule {}
