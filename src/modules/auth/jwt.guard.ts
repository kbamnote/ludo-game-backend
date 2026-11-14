import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';

/**
 * Requires a valid bearer token and attaches the payload to the request.
 *
 * This is what finally removes the `x-user-id` header. Identity is now
 * something the server minted and can verify, not something the client
 * asserts — which is the precondition for trusting anything else it sends.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    request.user = await this.auth.verify(header.slice(7));
    return true;
  }
}
