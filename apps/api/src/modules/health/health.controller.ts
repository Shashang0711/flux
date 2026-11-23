import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ErrorCode, type HealthStatus } from '@flux/shared';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/errors/app.exception';
import { APP_VERSION } from '../../common/app-info/app-version';
import { Public } from '../auth/decorators';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(): Promise<HealthStatus> {
    try {
      await this.prisma.ping();
    } catch {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Database is unreachable',
      );
    }
    return {
      status: 'ok',
      version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database: 'up' },
    };
  }
}
