import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { VesselsController } from './vessels.controller';
import { VesselsService } from './vessels.service';

@Module({
  imports: [CustomFieldsModule],
  controllers: [VesselsController],
  providers: [VesselsService],
})
export class VesselsModule {}
