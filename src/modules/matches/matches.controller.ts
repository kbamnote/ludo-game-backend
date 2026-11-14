import { BadRequestException, Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { JwtGuard } from '../auth/jwt.guard';
import type { TokenPayload } from '../auth/auth.service';
import { ROOM_LUDO } from '../../realtime/realtime';

const createSchema = z.object({
  entryFee: z.number().int().min(0).max(100000).default(0),
  maxPlayers: z.number().int().min(2).max(4).default(4),
});

/**
 * Match discovery.
 *
 * The client connects to Colyseus directly over WebSocket; these routes only
 * hand out the room name and code it needs to do so. Keeping discovery on
 * HTTP means a player can create or look up a room before paying the cost of
 * opening a socket.
 */
@Controller('v1/matches')
@UseGuards(JwtGuard)
export class MatchesController {
  /** Room codes avoid vowels and lookalikes so they survive being read aloud. */
  private newCode() {
    const alphabet = '23456789ACDEFGHJKLMNPQRSTUVWXYZ';
    return Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }

  @Post('private')
  createPrivate(@Req() req: Request & { user: TokenPayload }, @Body() body: unknown) {
    const parsed = createSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException('Invalid match options.');

    return {
      room: `${ROOM_LUDO}_private`,
      roomCode: this.newCode(),
      entryFee: parsed.data.entryFee,
      maxPlayers: parsed.data.maxPlayers,
      host: req.user.sub,
    };
  }

  /** Everything the client needs to join quick match. */
  @Get('quick')
  quick() {
    return { room: ROOM_LUDO, entryFee: 0 };
  }
}
