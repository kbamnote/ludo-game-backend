/**
 * Colyseus room state.
 *
 * Colyseus syncs only what changes, so this schema is the contract for what
 * every client sees. Two rules shape it:
 *
 *   1. It mirrors engine state rather than duplicating logic. The engine
 *      decides; this reports.
 *   2. It carries nothing a client should not know. There is no hidden
 *      information in Ludo, so that is simple here — but the RNG seed stays
 *      off the wire, because publishing it would let a client predict every
 *      future roll and that is exactly the advantage the server exists to
 *      prevent.
 *
 * ── Why `defineTypes` and not `@type` decorators ────────────────────────────
 * @colyseus/schema 5 decorators are STANDARD (stage-3) decorators and record
 * field types under `Symbol.metadata`. NestJS needs LEGACY decorators —
 * `experimentalDecorators` plus `emitDecoratorMetadata` — for its dependency
 * injection, and the two forms cannot be enabled in one compilation.
 *
 * Compiled as legacy, `@type` silently records nothing, and the encoder then
 * throws "Cannot read properties of undefined (reading 'Symbol(Symbol.metadata)')"
 * on every patch: matchmaking succeeds, clients join, and no state ever
 * arrives. `defineTypes` is the supported decorator-free API and sidesteps the
 * conflict completely.
 *
 * Field initializers below rely on `useDefineForClassFields: false` (set in
 * tsconfig). With it on, each initializer would redefine the field as a plain
 * own property and shadow the accessors `defineTypes` installs on the
 * prototype — which breaks change tracking the same silent way.
 */
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

export class TokenState extends Schema {
  id = '';
  seat = 0;
  slot = 0;
  /** -1 house, 0..51 ring, 52..56 home column, 57 finished. */
  progress = -1;
}

defineTypes(TokenState, {
  id: 'string',
  seat: 'number',
  slot: 'number',
  progress: 'number',
});

export class PlayerState extends Schema {
  userId = '';
  name = '';
  seat = 0;
  connected = true;
  ready = false;
  /** True when a CPU plays this seat — either filled or after a timeout. */
  bot = false;
  tokensHome = 0;
}

defineTypes(PlayerState, {
  userId: 'string',
  name: 'string',
  seat: 'number',
  connected: 'boolean',
  ready: 'boolean',
  bot: 'boolean',
  tokensHome: 'number',
});

export class LudoState extends Schema {
  roomCode = '';
  phase = 'lobby';
  /** Whose turn it is, by seat. */
  turn = 0;
  /** Last roll, or 0 when nothing has been rolled this turn. */
  roll = 0;
  /**
   * The engine's own phase for the active turn: awaitingRoll, awaitingMove or
   * finished.
   *
   * Sent explicitly rather than left for the client to infer from `roll` and
   * `legalTokenIds`. The inference is nearly right, which is the problem — it
   * breaks on exactly the transient states (a roll with no legal move) that
   * are hardest to reproduce, and a client that guesses the phase wrong shows
   * a dice button the server will refuse.
   */
  turnPhase = 'awaitingRoll';
  entryFee = 0;
  pot = 0;
  turnDeadline = 0;
  winner = '';

  tokens = new ArraySchema<TokenState>();
  players = new MapSchema<PlayerState>();
  /** Token ids the current player may legally move. */
  legalTokenIds = new ArraySchema<string>();
  /**
   * Seats in finishing order. Needed in state, not only in the final
   * `gameOver` message, so a player who joins or reconnects mid-match sees the
   * standings everyone else can see.
   */
  ranking = new ArraySchema<number>();
}

defineTypes(LudoState, {
  roomCode: 'string',
  phase: 'string',
  turn: 'number',
  roll: 'number',
  turnPhase: 'string',
  entryFee: 'number',
  pot: 'number',
  turnDeadline: 'number',
  winner: 'string',
  tokens: [TokenState],
  players: { map: PlayerState },
  legalTokenIds: ['string'],
  ranking: ['number'],
});
