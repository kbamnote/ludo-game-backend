import { Controller, Get } from '@nestjs/common';

/**
 * Liveness probe.
 *
 * Deployment platforms poll a URL to decide whether a container came up. With
 * no such route every path 404s, which some platforms read as a failed deploy.
 * Deliberately unauthenticated and free of any detail about the service.
 */
@Controller()
export class HealthController {
  @Get()
  root() {
    return { service: 'ludo-server', status: 'ok' };
  }

  @Get('health')
  health() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }
}
