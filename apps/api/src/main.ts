import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import type { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  configureApp(app, { corsOrigins: config.get('CORS_ORIGINS', { infer: true }) });

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  app.get(Logger).log(`FLUX API listening on http://localhost:${port}/api/v1`);
}

void bootstrap();
