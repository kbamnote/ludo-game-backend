/**
 * Engine tests.
 *
 *   node --test packages/engine/test/
 *
 * Covers the rules, the turn machine and the edge cases that are easy to get
 * subtly wrong and hard to spot in play: exact home entry, three-sixes
 * forfeiture, safe squares, blocks, and the no-legal-move path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HOME, IN_HOUSE, TRACK_LENGTH, PLAYERS, SAFE_INDICES } from '../src/board.js';
import { createRng, rollDie, seedFromString } from '../src/dice.js';
import { capturesAt, legalMoves, blockedIndices, hasWon } from '../src/rules.js';
import { Phase, createGame, roll, move, restart, chooseCpuMove, summarise } from '../src/engine.js';

/** Puts a specific token at a specific progress, for setting up a position. */
function place(state, tokenId, progress) {
  return {
    ...state,
    tokens: state.tokens.map((t) => (t.id === tokenId ? { ...t, progress } : t)),
  };
}

test('createGame deals four tokens per seat, all in their house', () => {
  const g = createGame();
  assert.equal(g.tokens.length, 16);
  assert.ok(g.tokens.every((t) => t.progress === IN_HOUSE));
  assert.equal(g.phase, Phase.awaitingRoll);
});

test('dice are deterministic for a seed', () => {
  const a = createRng(seedFromString('match-8409'));
  const b = createRng(seedFromString('match-8409'));
  const rollsA = Array.from({ length: 20 }, () => rollDie(a));
  const rollsB = Array.from({ length: 20 }, () => rollDie(b));
  assert.deepEqual(rollsA, rollsB);
  assert.ok(rollsA.every((v) => v >= 1 && v <= 6));
});

test('a whole game replays identically from the same seed', () => {
  const play = () => {
    let s = createGame({ seed: 'replay-me' });
    const log = [];
    for (let i = 0; i < 300 && s.phase !== Phase.finished; i += 1) {
      if (s.phase === Phase.awaitingRoll) {
        const r = roll(s);
        s = r.state;
        log.push(r.events.map((e) => e.type).join(','));
      } else {
        const id = chooseCpuMove(s);
        const r = move(s, id);
        s = r.state;
        log.push(r.events.map((e) => e.type).join(','));
      }
    }
    return log.join('|');
  };
  assert.equal(play(), play());
});

test('a token leaves the house only on a six', () => {
  const g = createGame();
  assert.equal(legalMoves(g, 0, 3).length, 0);
  assert.equal(legalMoves(g, 0, 6).length, 4);
});

test('rolling a six keeps the turn with the same player', () => {
  let s = createGame();
  s = roll(s, { forcedValue: 6 }).state;
  const r = move(s, '0-0');
  assert.ok(r.events.some((e) => e.type === 'extraTurn'));
  assert.equal(r.state.turn, 0);
});

test('a non-six with no legal move passes the turn', () => {
  const s = createGame();
  const r = roll(s, { forcedValue: 3 });
  assert.ok(r.events.some((e) => e.type === 'noMoves'));
  assert.equal(r.state.turn, 1);
});

test('three sixes in a row forfeits the turn', () => {
  let s = createGame();
  s = roll(s, { forcedValue: 6 }).state;
  s = move(s, '0-0').state;
  s = roll(s, { forcedValue: 6 }).state;
  s = move(s, '0-1').state;
  const third = roll(s, { forcedValue: 6 });
  assert.ok(third.events.some((e) => e.type === 'forfeit'));
  assert.notEqual(third.state.turn, 0);
});

test('home entry requires an exact count', () => {
  // One step short of home.
  let s = createGame();
  s = place(s, '0-0', HOME - 1);
  assert.equal(legalMoves(s, 0, 1).length, 1, 'exact roll is legal');
  assert.equal(
    legalMoves(s, 0, 2).filter((m) => m.tokenId === '0-0').length,
    0,
    'overshooting is not legal'
  );
});

test('a token that reaches home is marked finished', () => {
  let s = createGame();
  s = place(s, '0-0', HOME - 1);
  s = roll(s, { forcedValue: 1 }).state;
  const r = move(s, '0-0');
  assert.ok(r.events.some((e) => e.type === 'home'));
  assert.equal(r.state.tokens.find((t) => t.id === '0-0').progress, HOME);
});

test('landing on an opponent sends it back to its house', () => {
  // Seat 0 at progress 5 is ring index 5; put seat 1 on the same square.
  let s = createGame();
  const target = 5;
  const absolute = (PLAYERS[0].entryIndex + target) % TRACK_LENGTH;
  const victimProgress = (absolute - PLAYERS[1].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;

  s = place(s, '0-0', target - 2);
  s = place(s, '1-0', victimProgress);

  const captures = capturesAt(s, 0, target);
  assert.equal(captures.length, 1);
  assert.equal(captures[0].id, '1-0');

  s = roll(s, { forcedValue: 2 }).state;
  const r = move(s, '0-0');
  assert.ok(r.events.some((e) => e.type === 'captured'));
  assert.equal(r.state.tokens.find((t) => t.id === '1-0').progress, IN_HOUSE);
});

test('a capture grants another turn', () => {
  let s = createGame();
  const target = 5;
  const absolute = (PLAYERS[0].entryIndex + target) % TRACK_LENGTH;
  const victimProgress = (absolute - PLAYERS[1].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;
  s = place(s, '0-0', target - 2);
  s = place(s, '1-0', victimProgress);
  s = roll(s, { forcedValue: 2 }).state;
  const r = move(s, '0-0');
  assert.ok(r.events.some((e) => e.type === 'extraTurn'));
  assert.equal(r.state.turn, 0);
});

test('safe squares cannot be captured on', () => {
  let s = createGame();
  const safe = SAFE_INDICES.find((i) => i !== PLAYERS[0].entryIndex);
  const attacker = (safe - PLAYERS[0].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;
  const victim = (safe - PLAYERS[1].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;

  s = place(s, '1-0', victim);
  assert.deepEqual(capturesAt(s, 0, attacker), []);
});

test('two tokens on one square form a block opponents cannot pass', () => {
  let s = createGame();
  const blockIndex = (PLAYERS[1].entryIndex + 3) % TRACK_LENGTH;
  const p = (blockIndex - PLAYERS[1].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;
  s = place(s, '1-0', p);
  s = place(s, '1-1', p);

  const blocked = blockedIndices(s, 0);
  assert.ok(blocked.has(blockIndex));

  // Seat 0 trying to pass through it cannot.
  const before = (blockIndex - PLAYERS[0].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;
  s = place(s, '0-0', before - 1);
  const moves = legalMoves(s, 0, 3).filter((m) => m.tokenId === '0-0');
  assert.equal(moves.length, 0);
});

test('a block cannot be captured', () => {
  let s = createGame();
  const target = 5;
  const absolute = (PLAYERS[0].entryIndex + target) % TRACK_LENGTH;
  const victimProgress = (absolute - PLAYERS[1].entryIndex + TRACK_LENGTH) % TRACK_LENGTH;
  s = place(s, '1-0', victimProgress);
  s = place(s, '1-1', victimProgress);
  assert.deepEqual(capturesAt(s, 0, target), []);
});

test('a player wins when every token is home, and the game ends', () => {
  let s = createGame({ seats: [0, 1] });
  s = place(s, '0-0', HOME);
  s = place(s, '0-1', HOME);
  s = place(s, '0-2', HOME);
  s = place(s, '0-3', HOME - 1);

  assert.equal(hasWon(s, 0), false);

  s = roll(s, { forcedValue: 1 }).state;
  const r = move(s, '0-3');

  assert.ok(r.events.some((e) => e.type === 'won'));
  assert.ok(r.events.some((e) => e.type === 'gameOver'));
  assert.equal(r.state.phase, Phase.finished);
  assert.equal(r.state.winner, 0);
});

test('turn order skips a player who has finished', () => {
  let s = createGame({ seats: [0, 1, 2] });
  for (let i = 0; i < 4; i += 1) s = place(s, `1-${i}`, HOME);
  s = { ...s, turn: 0 };
  const r = roll(s, { forcedValue: 2 }); // no legal move -> passes
  assert.equal(r.state.turn, 2, 'seat 1 is finished and is skipped');
});

test('an illegal move is rejected rather than applied', () => {
  let s = createGame();
  s = roll(s, { forcedValue: 3 }).state; // no moves, turn passed
  const r = move(s, '0-0');
  assert.ok(r.events.some((e) => e.type === 'rejected'));
  assert.equal(r.state, s, 'state is unchanged');
});

test('rolling out of turn order is rejected', () => {
  let s = createGame();
  s = roll(s, { forcedValue: 6 }).state;
  const r = roll(s); // already awaiting a move
  assert.ok(r.events.some((e) => e.type === 'rejected'));
});

test('state is never mutated', () => {
  const s = createGame();
  const snapshot = JSON.stringify(s);
  roll(s, { forcedValue: 6 });
  assert.equal(JSON.stringify(s), snapshot);
});

test('restart clears the board', () => {
  let s = createGame();
  s = place(s, '0-0', 20);
  const fresh = restart(s);
  assert.ok(fresh.tokens.every((t) => t.progress === IN_HOUSE));
  assert.equal(fresh.phase, Phase.awaitingRoll);
});

test('summarise ranks finished players first', () => {
  let s = createGame({ seats: [0, 1] });
  for (let i = 0; i < 4; i += 1) s = place(s, `0-${i}`, HOME);
  s = { ...s, ranking: [0] };
  const rows = summarise(s);
  assert.equal(rows[0].seat, 0);
  assert.equal(rows[0].place, 1);
  assert.equal(rows[0].home, 4);
});

test('the CPU never stalls when a move exists', () => {
  let s = createGame();
  s = roll(s, { forcedValue: 6 }).state;
  assert.ok(chooseCpuMove(s), 'returns a token id');
});

test('the CPU prefers finishing over capturing', () => {
  let s = createGame();
  s = place(s, '0-0', HOME - 1);
  s = roll(s, { forcedValue: 1 }).state;
  assert.equal(chooseCpuMove(s), '0-0');
});

test('a full CPU game reaches a winner without stalling', () => {
  let s = createGame({ seed: 'full-game' });
  let guard = 0;
  while (s.phase !== Phase.finished && guard < 5000) {
    guard += 1;
    if (s.phase === Phase.awaitingRoll) {
      s = roll(s).state;
    } else {
      s = move(s, chooseCpuMove(s)).state;
    }
  }
  assert.equal(s.phase, Phase.finished, `game did not finish in ${guard} steps`);
  assert.ok(s.winner !== null);
});
