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
  await app.listen(port);
  Logger.log(`ludo-server listening on http://localhost:${port}`, 'Bootstrap');
}

void bootstrap();
