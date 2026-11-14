import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody lets the upload route read the photo bytes directly.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // No global ValidationPipe: request shapes are validated with zod at each
  // controller boundary. Running class-validator alongside it would mean two
  // sources of truth for the same contract, and only one of them documented.

  app.use(json({ limit: '1mb' }));
  // Photo uploads arrive as raw bytes, not JSON.
  app.use('/v1/avatars/uploads', raw({ type: '*/*', limit: '8mb' }));

  app.enableCors({ origin: true });

  const port = Number(process.env.PORT ?? 3000);

  // Bind to 0.0.0.0, not the default loopback. A container platform routes
  // traffic in from outside the container, so a process listening only on
  // localhost accepts nothing and the deploy is marked unhealthy.
  await app.listen(port, '0.0.0.0');

  Logger.log(`ludo-server listening on 0.0.0.0:${port}`, 'Bootstrap');

  if (process.env.LUDO_SIGNING_KEY === undefined || process.env.LUDO_SIGNING_KEY === 'dev-only-insecure-key') {
    Logger.warn(
      'LUDO_SIGNING_KEY is unset or still the development default. ' +
        'Media URLs signed with it are forgeable. Generate one with: openssl rand -hex 32',
      'Bootstrap',
    );
  }
}

void bootstrap();
