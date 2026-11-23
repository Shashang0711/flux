import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type UserDto,
} from '@flux/shared';
import { ZodValidationPipe } from '../../common/validation/zod-validation.pipe';
import { isCookieSecure, type Env } from '../../config/env';
import { AuthService } from './auth.service';
import type { AuthUser, AuthenticatedRequest } from './auth.types';
import { CurrentSessionId, CurrentUser, Public } from './decorators';
import { clearSessionCookie, readSessionToken, setSessionCookie } from './session-cookie';
import { SessionService } from './session.service';

@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = isCookieSecure({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      COOKIE_SECURE: config.get('COOKIE_SECURE', { infer: true }),
    });
  }

  @Public()
  // Applies both login throttlers (per IP and per account); see AuthModule.
  @UseGuards(ThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginRequest,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<UserDto> {
    const { user, token, expiresAt } = await this.auth.login(body, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    setSessionCookie(res, token, expiresAt, this.secureCookie);
    return user;
  }

  /** Public so an expired or invalid cookie can still be cleared. */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = readSessionToken(req.cookies);
    if (token) await this.sessions.revokeByToken(token);
    clearSessionCookie(res, this.secureCookie);
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): Promise<UserDto> {
    return this.auth.me(user.id);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @CurrentSessionId() sessionId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(user.id, sessionId, body);
  }
}
