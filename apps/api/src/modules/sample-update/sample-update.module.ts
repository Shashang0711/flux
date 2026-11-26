import { Module } from '@nestjs/common';
import { SampleUpdateController } from './sample-update.controller';
import { SampleUpdateService } from './sample-update.service';

@Module({
  controllers: [SampleUpdateController],
  providers: [SampleUpdateService],
})
export class SampleUpdateModule {}
