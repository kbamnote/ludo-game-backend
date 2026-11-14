/**
 * The game state machine.
 *
 * `(state, action) -> { state, events }`. Pure: the same state and action
 * always produce the same result, so the server can run it as the authority
 * and the client can run it for prediction and reach the same answer.
 *
 * State is never mutated. Callers hold the previous state safely, which is
 * what makes replay, undo and desync diffing possible later.
 *
 * `events` is the narration layer — captures, extra turns, wins. The UI reads
 * those to drive animation, haptics and reactions instead of diffing state
 * and guessing what happened.
 */
import { IN_HOUSE, PLAYERS, TOKENS_PER_PLAYER } from './board.js';
import { createRng, rollDie, seedFromString } from './dice.js';
import {
  MAX_CONSECUTIVE_SIXES,
  grantsExtraTurn,
  hasWon,
  legalMoves,
  nextSeat,
  tokensHome,
} from './rules.js';

export const Phase = {
  /** Waiting for the active seat to roll. */
  awaitingRoll: 'awaitingRoll',
  /** Rolled; waiting for the active seat to choose a token. */
  awaitingMove: 'awaitingMove',
  /** Someone has won. */
  finished: 'finished',
};

/**
 * Creates a game.
 *
 * `seed` makes a match reproducible. Pass the match id and the whole game
 * replays identically — which is how a desync gets diagnosed rather than
 * guessed at.
 */
export function createGame({ seats = [0, 1, 2, 3], seed = 1, startingSeat = seats[0] } = {}) {
  const tokens = [];
  for (const seat of seats) {
    for (let i = 0; i < TOKENS_PER_PLAYER; i += 1) {
      tokens.push({ id: `${seat}-${i}`, seat, slot: i, progress: IN_HOUSE });
    }
  }

  return {
    seats,
    tokens,
    turn: startingSeat,
    phase: Phase.awaitingRoll,
    roll: null,
    legalMoves: [],
    consecutiveSixes: 0,
    rngState: typeof seed === 'string' ? seedFromString(seed) : seed >>> 0,
    rollCount: 0,
    winner: null,
    ranking: [],
  };
}

/**
 * Advances the RNG deterministically.
 *
 * The seed is re-derived from (seed, rollCount) rather than holding a live
 * closure, so state stays a plain serialisable object — it has to survive
 * being sent over a wire and stored.
 */
function nextRoll(state) {
  const rng = createRng((state.rngState + state.rollCount * 0x9e3779b9) >>> 0);
  return rollDie(rng);
}

function clone(state) {
  return { ...state, tokens: state.tokens.map((t) => ({ ...t })), ranking: [...state.ranking] };
}

/**
 * Roll the dice.
 *
 * `forcedValue` exists for the server to replay an authoritative roll and for
 * tests to drive a specific sequence. A client must never pass it in a real
 * match — Phase 5 wires the server as the only caller that may.
 */
export function roll(state, { forcedValue } = {}) {
  if (state.phase !== Phase.awaitingRoll) {
    return { state, events: [{ type: 'rejected', reason: 'not_awaiting_roll' }] };
  }

  const value = forcedValue ?? nextRoll(state);
  const next = clone(state);
  next.rollCount += 1;
  next.roll = value;
  next.consecutiveSixes = value === 6 ? state.consecutiveSixes + 1 : 0;

  const events = [{ type: 'rolled', seat: state.turn, value }];

  // Three sixes burns the turn. Without this a lucky streak never ends.
  if (next.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
    events.push({ type: 'forfeit', seat: state.turn, reason: 'three_sixes' });
    return { state: endTurn(next, { forfeited: true }), events };
  }

  const moves = legalMoves(next, next.turn, value);
  next.legalMoves = moves;

  if (moves.length === 0) {
    events.push({ type: 'noMoves', seat: next.turn, value });
    return { state: endTurn(next, {}), events };
  }

  next.phase = Phase.awaitingMove;
  return { state: next, events };
}

/** Move a token. `tokenId` must be one of state.legalMoves. */
export function move(state, tokenId) {
  if (state.phase !== Phase.awaitingMove) {
    return { state, events: [{ type: 'rejected', reason: 'not_awaiting_move' }] };
  }

  const chosen = state.legalMoves.find((m) => m.tokenId === tokenId);
  if (!chosen) {
    return { state, events: [{ type: 'rejected', reason: 'illegal_move' }] };
  }

  const next = clone(state);
  const events = [];

  const token = next.tokens.find((t) => t.id === tokenId);
  token.progress = chosen.to;
  events.push({
    type: 'moved',
    seat: chosen.seat,
    tokenId,
    from: chosen.from,
    to: chosen.to,
    leftHouse: chosen.leavesHouse,
  });

  for (const victimId of chosen.captures) {
    const victim = next.tokens.find((t) => t.id === victimId);
    victim.progress = IN_HOUSE;
    events.push({ type: 'captured', by: chosen.seat, tokenId: victimId, seat: victim.seat });
  }

  if (chosen.entersHome) {
    events.push({ type: 'home', seat: chosen.seat, tokenId });
  }

  // Win check before handing the turn on, so the winner is recorded against
  // the move that achieved it.
  if (hasWon(next, chosen.seat)) {
    next.ranking = [...next.ranking, chosen.seat];
    events.push({ type: 'won', seat: chosen.seat, place: next.ranking.length });

    const remaining = next.seats.filter((s) => !hasWon(next, s));
    if (remaining.length <= 1) {
      next.ranking = [...next.ranking, ...remaining];
      next.phase = Phase.finished;
      next.winner = next.ranking[0];
      next.legalMoves = [];
      next.roll = null;
      events.push({ type: 'gameOver', ranking: next.ranking });
      return { state: next, events };
    }
  }

  const extra = grantsExtraTurn({
    roll: next.roll,
    captured: chosen.captures.length > 0,
    enteredHome: chosen.entersHome,
    consecutiveSixes: next.consecutiveSixes,
  });

  if (extra) {
    events.push({ type: 'extraTurn', seat: chosen.seat });
    next.phase = Phase.awaitingRoll;
    next.legalMoves = [];
    next.roll = null;
    return { state: next, events };
  }

  return { state: endTurn(next, {}), events };
}

function endTurn(state, { forfeited }) {
  const next = clone(state);
  next.phase = Phase.awaitingRoll;
  next.legalMoves = [];
  next.roll = null;
  next.consecutiveSixes = forfeited ? 0 : next.consecutiveSixes;
  next.turn = nextSeat(next, next.turn);
  return next;
}

/** Restart with the same seats. A fresh seed gives a genuinely new game. */
export function restart(state, { seed } = {}) {
  return createGame({
    seats: state.seats,
    seed: seed ?? (state.rngState + 1) >>> 0,
    startingSeat: state.seats[0],
  });
}

/**
 * Picks a move for a CPU player.
 *
 * Deliberately simple and readable rather than strong: finish > capture >
 * leave the house > furthest along. Phase 7 can tune difficulty; right now
 * the job is to make a single-player game playable and never stall.
 */
export function chooseCpuMove(state) {
  const moves = state.legalMoves;
  if (moves.length === 0) return null;

  const score = (m) => {
    if (m.entersHome) return 1000;
    if (m.captures.length > 0) return 500 + m.captures.length * 10;
    if (m.leavesHouse) return 200;
    return m.to;
  };

  return moves.reduce((best, m) => (score(m) > score(best) ? m : best), moves[0]).tokenId;
}

/** Summary for the results screen. */
export function summarise(state) {
  return state.seats
    .map((seat) => ({
      seat,
      faction: PLAYERS[seat].faction,
      home: tokensHome(state, seat),
      finished: hasWon(state, seat),
    }))
    .sort((a, b) => {
      const ra = state.ranking.indexOf(a.seat);
      const rb = state.ranking.indexOf(b.seat);
      if (ra !== -1 || rb !== -1) {
        return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
      }
      return b.home - a.home;
    })
    .map((row, i) => ({ ...row, place: i + 1 }));
}

export default {
  Phase,
  createGame,
  roll,
  move,
  restart,
  chooseCpuMove,
  summarise,
};
