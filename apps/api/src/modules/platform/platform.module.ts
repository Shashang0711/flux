import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { PlatformController } from './platform.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [PlatformController],
  providers: [TenantsService],
})
export class PlatformModule {}
