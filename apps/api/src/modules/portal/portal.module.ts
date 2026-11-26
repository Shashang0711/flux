import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FilesModule } from '../files/files.module';
import { PortalUsersController } from './portal-users.controller';
import { PortalUsersService } from './portal-users.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';

@Module({
  imports: [AuthModule, FilesModule],
  controllers: [PortalController, PortalUsersController],
  providers: [PortalService, PortalUsersService],
})
export class PortalModule {}
