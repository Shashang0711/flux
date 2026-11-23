import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../../config/env';
import { AuthController } from './auth.controller';
import { loginAccountTracker } from './login-throttle';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  imports: [
    // Only applied where @UseGuards(ThrottlerGuard) is used (currently: login).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          // Per client IP (req.ip, which honours TRUST_PROXY).
          {
            name: 'login-ip',
            ttl: 60_000,
            limit: config.get('LOGIN_RATE_LIMIT', { infer: true }),
          },
          // Per target account, regardless of IP.
          {
            name: 'login-account',
            ttl: 60_000,
            limit: config.get('LOGIN_ACCOUNT_RATE_LIMIT', { infer: true }),
            getTracker: (req: Record<string, unknown>) => loginAccountTracker(req.body),
          },
        ],
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, SessionService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [SessionService],
})
export class AuthModule {}
