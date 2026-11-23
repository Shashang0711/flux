import { INestApplication, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { Express } from 'express';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';
import { parseTrustProxy } from './config/env';

/**
 * Global HTTP pipeline. Shared by main.ts and the tests so both run identical behaviour.
 * Routes are served at /api/v{n}/... (default v1).
 */
export interface AppOptions {
  corsOrigins: string[];
  /** Raw TRUST_PROXY value; see config/env.ts. */
  trustProxy?: string;
}

export function configureApp(app: INestApplication, options: AppOptions): void {
  const express: Express = app.getHttpAdapter().getInstance();
  express.set('trust proxy', parseTrustProxy(options.trustProxy ?? 'loopback'));
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: options.corsOrigins, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();
}
