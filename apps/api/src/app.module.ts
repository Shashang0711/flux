import { randomUUID } from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv, type Env } from './config/env';
import { PrismaModule } from './database/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { PlatformModule } from './modules/platform/platform.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsersModule } from './modules/users/users.module';

export const REQUEST_ID_HEADER = 'x-request-id';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        // Nest 11 route syntax; the library default ('*') triggers a legacy-route warning.
        forRoutes: [{ path: '{*splat}', method: RequestMethod.ALL }],
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // Correlation ID: honour an inbound header, otherwise generate one; echo it back.
          genReqId: (req, res) => {
            const inbound = req.headers[REQUEST_ID_HEADER];
            const id =
              typeof inbound === 'string' && inbound.length <= 128 ? inbound : randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    PlatformModule,
    RolesModule,
    AuditModule,
  ],
})
export class AppModule {}
