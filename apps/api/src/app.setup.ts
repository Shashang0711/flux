import { INestApplication, VersioningType } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { EnvelopeInterceptor } from './common/interceptors/envelope.interceptor';

/**
 * Global HTTP pipeline. Shared by main.ts and the tests so both run identical behaviour.
 * Routes are served at /api/v{n}/... (default v1).
 */
export function configureApp(app: INestApplication, options: { corsOrigins: string[] }): void {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.use(helmet());
  app.enableCors({ origin: options.corsOrigins, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new EnvelopeInterceptor(app.get(Reflector)));
  app.enableShutdownHooks();
}
