import { Module } from '@nestjs/common';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { NotificationRulesController } from './notification-rules.controller';
import { NotificationRulesService } from './notification-rules.service';

@Module({
  imports: [CustomFieldsModule],
  controllers: [ClientsController, NotificationRulesController],
  providers: [ClientsService, NotificationRulesService],
})
export class ClientsModule {}
