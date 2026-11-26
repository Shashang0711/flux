import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { ReceivingModule } from '../receiving/receiving.module';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';
import { TestingController } from './testing.controller';
import { TestingService } from './testing.service';

@Module({
  imports: [ReceivingModule, FilesModule],
  controllers: [SamplesController, TestingController],
  providers: [SamplesService, TestingService],
})
export class SamplesModule {}
