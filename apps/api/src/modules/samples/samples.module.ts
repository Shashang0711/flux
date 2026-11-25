import { Module } from '@nestjs/common';
import { ReceivingModule } from '../receiving/receiving.module';
import { SamplesController } from './samples.controller';
import { SamplesService } from './samples.service';

@Module({
  imports: [ReceivingModule],
  controllers: [SamplesController],
  providers: [SamplesService],
})
export class SamplesModule {}
