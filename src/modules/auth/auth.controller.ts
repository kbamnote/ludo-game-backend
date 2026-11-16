import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthService, TokenPayload } from './auth.service';
import { JwtGuard } from './jwt.guard';
import { AvatarsService } from '../avatars/avatars.service';

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
  constructor(
    private readonly auth: AuthService,
    private readonly avatars: AvatarsService,
  ) {}

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

  /**
   * Deletes the caller's account and everything attached to it.
   *
   * Required by Google Play for any app that creates accounts, which this one
   * does on first launch. The order matters: avatars and stored photos go
   * first, then the identity. Reversed, a failure midway would leave orphaned
   * images belonging to a user id nothing can resolve any more — undeletable,
   * because the only handle on them was just thrown away.
   */
  @Delete('me')
  @UseGuards(JwtGuard)
  @HttpCode(204)
  async deleteMe(@Req() req: Request & { user: TokenPayload }) {
    await this.avatars.removeAll(req.user.sub);
    await this.auth.deleteAccount(req.user.sub);
  }
}
