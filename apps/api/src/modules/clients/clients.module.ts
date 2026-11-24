import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [CustomFieldsModule],
  controllers: [ClientsController],
  providers: [ClientsService],
})
export class ClientsModule {}
