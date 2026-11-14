import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { json, raw } from 'express';
import { AppModule } from './app.module';
import { AuthService } from './modules/auth/auth.service';
import { attachRealtime } from './realtime/realtime';

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

  // Colyseus shares Nest's HTTP server rather than opening a second port, so
  // the WebSocket endpoint sits at the same origin as the REST API. Most
  // hosts expose exactly one port, which makes this the only option that
  // works in production.
  attachRealtime(app.getHttpServer(), app.get(AuthService));

  Logger.log(`ludo-server listening on 0.0.0.0:${port}`, 'Bootstrap');

  warnOnInsecureDefault('LUDO_SIGNING_KEY', 'dev-only-insecure-key', 'media URLs are forgeable');
  warnOnInsecureDefault(
    'LUDO_JWT_SECRET',
    'dev-only-insecure-jwt-secret',
    'anyone can mint a valid session token',
  );
}

/**
 * A development default left in a deployed environment is a security hole, not
 * a style issue. Say so loudly at boot rather than leaving it to be noticed.
 */
function warnOnInsecureDefault(name: string, devValue: string, consequence: string) {
  const value = process.env[name];
  if (value === undefined || value === devValue) {
    Logger.warn(
      `${name} is unset or still the development default — ${consequence}. ` +
        `Generate one with: openssl rand -hex 32`,
      'Bootstrap',
    );
  }
}

void bootstrap();
