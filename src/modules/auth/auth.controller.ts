import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService, TokenPayload } from './auth.service';
import { JwtGuard } from './jwt.guard';

const guestSchema = z.object({
  /**
   * Omitted on a first run: the server mints one and returns it. A client that
   * has signed in before sends back what it was given.
   */
  deviceId: z.string().min(8).max(128).optional(),
  name: z.string().max(20).optional(),
});

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Device-backed guest sign-in. Returns a bearer token. */
  @Post('guest')
  guest(@Body() body: unknown) {
    const parsed = guestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid sign-in request.');
    return this.auth.signInGuest(parsed.data.deviceId, parsed.data.name);
  }

  /** Confirms a token is still valid and returns who it belongs to. */
  @Get('me')
  @UseGuards(JwtGuard)
  me(@Req() req: Request & { user: TokenPayload }) {
    return { id: req.user.sub, name: req.user.name, guest: req.user.guest };
  }
}
