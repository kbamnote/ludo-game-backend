/**
 * The one place in the server that says where the rules engine lives.
 *
 * `packages/engine` is the canonical Ludo implementation — the app vendors a
 * copy of it for local prediction, and if the two ever diverged, clients would
 * propose moves the server rejects (risk R11). Routing every server import
 * through this file means the path appears once: when the engine later becomes
 * an installed package, only this module changes.
 *
 * It is a re-export and nothing more. No rules, no adaptation, no defaults —
 * logic added here would be logic the app does not have.
 */
export {
  Phase,
  createGame,
  roll,
  move,
  restart,
  chooseCpuMove,
  summarise,
} from '../../packages/engine/src/engine.js';

export { tokensHome, legalMoves, hasWon } from '../../packages/engine/src/rules.js';

export { PLAYERS, TOKENS_PER_PLAYER } from '../../packages/engine/src/board.js';

import { createGame } from '../../packages/engine/src/engine.js';

/** A complete, immutable engine state. The engine returns new ones; it never mutates. */
export type GameState = ReturnType<typeof createGame>;

/**
 * One narration event. Clients animate from these rather than diffing state.
 *
 * Only `type` is guaranteed; the rest of each event's shape depends on what
 * happened, and the engine is the authority on that.
 */
export interface EngineEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * What every engine transition returns: the next state, and what happened.
 *
 * `events` is deliberately `readonly unknown[]` rather than `EngineEvent[]`.
 * The engine is plain JavaScript, so TypeScript infers a different literal
 * union for each of `roll` and `move` — writing either one's inferred type
 * here makes the other fail to assign. Callers narrow with a cast to
 * `EngineEvent[]`, which is the shape the engine's own tests pin down.
 */
export interface EngineResult {
  state: GameState;
  events: readonly unknown[];
}
