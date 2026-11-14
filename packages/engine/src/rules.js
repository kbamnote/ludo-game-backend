/**
 * Ludo rules.
 *
 * Pure functions over state. Nothing here mutates, logs, or reaches outside
 * its arguments — which is what lets the server run it as the authority and
 * the client run it for prediction and get the same answer.
 *
 * ── House rules this implementation uses ────────────────────────────────────
 * These vary between regions, so they are stated explicitly rather than left
 * implicit in the code:
 *
 *   - A token leaves the house only on a 6.
 *   - A 6 grants another turn. So does capturing, and so does getting a token
 *     home.
 *   - Three 6s in a row forfeits the turn (stops a player chaining forever).
 *   - Home entry needs an EXACT count. Overshooting is not a legal move.
 *   - Landing on an opponent sends it back to its house, except on a safe
 *     square.
 *   - Two or more tokens of the same player on one square form a block that
 *     opponents cannot pass. (A common rule and the one the "STRIKE" language
 *     in the design implies.)
 */
import { HOME, IN_HOUSE, TRACK_LENGTH, isSafeIndex, trackIndexFor } from './board.js';

export const MAX_CONSECUTIVE_SIXES = 3;

/** All tokens belonging to a seat. */
export function tokensOf(state, seat) {
  return state.tokens.filter((t) => t.seat === seat);
}

/** Absolute ring index of a token, or null if not on the ring. */
function ringIndex(token) {
  return trackIndexFor(token.seat, token.progress);
}

/**
 * Squares blocked against `seat` — a ring index holding 2+ tokens of ANOTHER
 * player. A block cannot be passed or landed on.
 */
export function blockedIndices(state, seat) {
  const counts = new Map();
  for (const t of state.tokens) {
    if (t.seat === seat) continue;
    const index = ringIndex(t);
    if (index === null) continue;
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  const blocked = new Set();
  for (const [index, count] of counts) if (count >= 2) blocked.add(index);
  return blocked;
}

/**
 * Where a token would land, or null if the move is illegal.
 * Does not consider blocks — `isPathClear` handles those.
 */
export function destinationOf(token, roll) {
  if (token.progress === HOME) return null;

  if (token.progress === IN_HOUSE) {
    // Only a 6 opens the gate.
    return roll === 6 ? 0 : null;
  }

  const next = token.progress + roll;
  // Exact count required to finish; overshooting is not a legal move.
  if (next > HOME) return null;
  return next;
}

/**
 * True if nothing blocks the path from `token` to `destination`.
 * Only ring squares can block; the home column is private to its owner.
 */
export function isPathClear(state, token, destination) {
  const blocked = blockedIndices(state, token.seat);
  if (blocked.size === 0) return true;

  const from = token.progress === IN_HOUSE ? 0 : token.progress + 1;
  for (let p = from; p <= Math.min(destination, TRACK_LENGTH - 1); p += 1) {
    const index = trackIndexFor(token.seat, p);
    if (index !== null && blocked.has(index)) return false;
  }
  return true;
}

/**
 * Tokens that would be captured by landing on `destination`.
 * Empty on a safe square, or when the square holds a block.
 */
export function capturesAt(state, seat, destination) {
  if (destination >= TRACK_LENGTH) return []; // home column is private
  const index = trackIndexFor(seat, destination);
  if (index === null || isSafeIndex(index)) return [];

  const victims = state.tokens.filter(
    (t) => t.seat !== seat && t.progress >= 0 && t.progress < TRACK_LENGTH && ringIndex(t) === index
  );
  // A block of 2+ is not capturable — it blocks instead.
  return victims.length >= 2 ? [] : victims;
}

/** Every legal move for `seat` with `roll`. */
export function legalMoves(state, seat, roll) {
  const moves = [];
  for (const token of tokensOf(state, seat)) {
    const destination = destinationOf(token, roll);
    if (destination === null) continue;
    if (!isPathClear(state, token, destination)) continue;

    const captures = capturesAt(state, seat, destination);
    moves.push({
      tokenId: token.id,
      seat,
      from: token.progress,
      to: destination,
      captures: captures.map((c) => c.id),
      entersHome: destination === HOME,
      leavesHouse: token.progress === IN_HOUSE,
    });
  }
  return moves;
}

/** A player has won when all their tokens are home. */
export function hasWon(state, seat) {
  return tokensOf(state, seat).every((t) => t.progress === HOME);
}

/** Tokens home, for scoreboards. */
export function tokensHome(state, seat) {
  return tokensOf(state, seat).filter((t) => t.progress === HOME).length;
}

/**
 * Does this roll earn another turn?
 * A 6, a capture, or getting a token home — but never after three 6s.
 */
export function grantsExtraTurn({ roll, captured, enteredHome, consecutiveSixes }) {
  if (consecutiveSixes >= MAX_CONSECUTIVE_SIXES) return false;
  return roll === 6 || captured || enteredHome;
}

/** Next seat in play order, skipping anyone who has finished. */
export function nextSeat(state, seat) {
  const total = state.seats.length;
  for (let step = 1; step <= total; step += 1) {
    const candidate = state.seats[(state.seats.indexOf(seat) + step) % total];
    if (!hasWon(state, candidate)) return candidate;
  }
  return seat;
}

export default {
  legalMoves,
  destinationOf,
  isPathClear,
  capturesAt,
  blockedIndices,
  hasWon,
  tokensHome,
  tokensOf,
  grantsExtraTurn,
  nextSeat,
  MAX_CONSECUTIVE_SIXES,
};
