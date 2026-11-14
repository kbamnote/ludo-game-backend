/**
 * Colyseus bootstrap.
 *
 * Shares the HTTP server with Nest rather than listening on a second port, so
 * the WebSocket endpoint lives at the same origin as the REST API. That means
 * one domain, one TLS certificate, and no CORS surprises — and on a platform
 * that exposes a single port, the alternative simply does not work.
 */
import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Server as HttpServer } from 'node:http';
import { Logger } from '@nestjs/common';

import { LudoRoom } from './rooms/LudoRoom';
import type { AuthService } from '../modules/auth/auth.service';

export const ROOM_LUDO = 'ludo';

let gameServer: Server | null = null;

export function attachRealtime(httpServer: HttpServer, auth: AuthService) {
  // One verification path for sockets and HTTP. Two would eventually
  // disagree, and the one that drifted would be the security hole.
  LudoRoom.authService = auth;

  gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  /**
   * Quick match: Colyseus fills an existing open room before creating one, so
   * players land together without a lobby server.
   */
  gameServer.define(ROOM_LUDO, LudoRoom).filterBy(['entryFee']);

  /** Private rooms, found by their 4-character code. */
  gameServer.define(`${ROOM_LUDO}_private`, LudoRoom).filterBy(['roomCode']);

  Logger.log('Colyseus attached on the same port as HTTP', 'Realtime');
  return gameServer;
}

export function getGameServer() {
  return gameServer;
}
