import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AccessCatalogueController, RolesController } from './roles.controller';
import { RolesService } from './roles.service';

@Module({
  imports: [AuthModule],
  controllers: [AccessCatalogueController, RolesController],
  providers: [RolesService],
})
export class RolesModule {}
