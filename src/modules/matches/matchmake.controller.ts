/**
 * Colyseus matchmaking, served by Nest.
 *
 * ── Why this file has to exist ──────────────────────────────────────────────
 * A Colyseus client does not open a socket first. `joinOrCreate()` begins with
 * an HTTP POST to `/matchmake/joinOrCreate/<room>`; only once that responds
 * with a seat reservation does the SDK open the WebSocket. Colyseus normally
 * serves those routes from its own HTTP listener — but this deployment shares
 * Nest's single HTTP server (one port is all most hosts expose), and
 * WebSocketTransport attached to an existing server handles the `upgrade`
 * event only. Express answers everything else, so without this controller
 * every matchmaking request returned 404 and no match could ever start.
 *
 * `matchMaker.controller` is the framework-agnostic entry point Colyseus
 * publishes for exactly this situation. The logic stays Colyseus's; this file
 * only translates between an Express request and `invokeMethod`.
 *
 * ── Why there is no JwtGuard here ───────────────────────────────────────────
 * Authentication happens in LudoRoom.onAuth, which the matchmaker calls while
 * handling the request below. Adding a guard would mean two places that decide
 * who may play, and a Nest 401 would reach the SDK as a transport failure
 * rather than the auth error it knows how to report. One gate, inside the room.
 */
import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ErrorCode, matchMaker, type AuthContext } from '@colyseus/core';
import type { Request, Response } from 'express';

const { controller } = matchMaker;

/**
 * Anchored room-name check. `controller.allowedRoomNameChars` is a global
 * regex, so it carries `lastIndex` between calls and is unanchored — testing
 * with it directly would accept `../../etc` and would also give different
 * answers for the same input on consecutive calls.
 */
const ROOM_NAME = /^[a-zA-Z_\-0-9]+$/;

@Controller(controller.matchmakeRoute)
export class MatchmakeController {
  /**
   * `POST /matchmake/:method/:roomName`
   *
   * The two path segments are attacker-controlled, so both are checked against
   * an allowlist before anything is invoked: `method` must be one Colyseus
   * actually exposes, not any property reachable on the matchmaker.
   */
  @Post(':method/:roomName')
  async matchmake(@Req() req: Request, @Res() res: Response, @Body() body: unknown) {
    const method = String(req.params.method ?? '');
    const roomName = String(req.params.roomName ?? '');

    if (!controller.exposedMethods.includes(method) || !ROOM_NAME.test(roomName)) {
      res.status(404).json({ code: ErrorCode.MATCHMAKE_NO_HANDLER, error: 'Not found.' });
      return;
    }

    const options = (body ?? {}) as Record<string, unknown>;

    try {
      const seat = await controller.invokeMethod(
        method,
        roomName,
        options,
        this.authContext(req, options),
      );
      res.status(200).json(seat);
    } catch (err) {
      const code = this.errorCode(err);
      // Mirror stock Colyseus: while `standardHttpStatus` is off, the SDK reads
      // the error code from the status line, so sending our own status here
      // would turn "room is full" into an unexplained transport failure.
      const status = controller.standardHttpStatus ? controller.getHttpStatus(code) : code;
      res.status(status).json({ code, error: this.errorMessage(err) });
    }
  }

  /**
   * Builds the context `onAuth` receives.
   *
   * The token is read from the `Authorization` header first — that is where
   * the SDK puts `client.auth.token` — and from the request body second, so a
   * client that passes it as a join option still authenticates. Supporting
   * both is what keeps one verification path rather than two.
   */
  private authContext(req: Request, options: Record<string, unknown>): AuthContext {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(', '));
    }

    const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    const fromBody = typeof options.token === 'string' ? options.token : undefined;

    return {
      token: bearer ?? fromBody,
      ip: req.ip,
      headers,
      req,
    };
  }

  private errorCode(err: unknown): number {
    const code = (err as { code?: unknown })?.code;
    return typeof code === 'number' ? code : ErrorCode.MATCHMAKE_UNHANDLED;
  }

  private errorMessage(err: unknown): string {
    const message = (err as { message?: unknown })?.message;
    return typeof message === 'string' && message ? message : 'Could not join a match.';
  }
}
