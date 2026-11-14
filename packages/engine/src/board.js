/**
 * Board model — the canonical geometry for Ludo After Dark.
 *
 * This is the SINGLE source of truth for board layout. The mobile app's
 * src/game/board/geometry.js holds only pixel helpers for rendering; the
 * structural data lives here so the server and client can never disagree
 * about where a token is (risk R11).
 *
 * Pure data and pure functions. No I/O, no Node built-ins, no React. Runs
 * identically under Hermes and Node.
 *
 * ── Coordinate system ───────────────────────────────────────────────────────
 * 15x15 grid, x left-to-right, y top-to-bottom, both 0..14.
 *
 * ── Progress ────────────────────────────────────────────────────────────────
 * A token's position is one number, `progress`:
 *   -1        in its house
 *   0..51     on the shared ring, measured from its own entry square
 *   52..56    in its home column
 *   57        home (finished)
 */

export const GRID = 15;
export const TRACK_LENGTH = 52;
export const HOME_COLUMN_LENGTH = 5;
export const TOKENS_PER_PLAYER = 4;

/** progress value meaning "still in the house". */
export const IN_HOUSE = -1;
/** progress value meaning "finished". */
export const HOME = TRACK_LENGTH + HOME_COLUMN_LENGTH; // 57

/**
 * The 52-cell shared ring, clockwise.
 *
 * Note the four diagonal turns — (6,9)->(5,8), (5,6)->(6,5), (8,5)->(9,6),
 * (9,8)->(8,9). These are correct: at each one the cell in between belongs to
 * the central goal block, so the path steps around the goal's corner, exactly
 * as a physical board does.
 */
export const TRACK = [
  { x: 6, y: 13 }, { x: 6, y: 12 }, { x: 6, y: 11 }, { x: 6, y: 10 }, { x: 6, y: 9 },
  { x: 5, y: 8 }, { x: 4, y: 8 }, { x: 3, y: 8 }, { x: 2, y: 8 }, { x: 1, y: 8 },
  { x: 0, y: 8 }, { x: 0, y: 7 }, { x: 0, y: 6 },
  { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }, { x: 5, y: 6 },
  { x: 6, y: 5 }, { x: 6, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 2 }, { x: 6, y: 1 },
  { x: 6, y: 0 }, { x: 7, y: 0 }, { x: 8, y: 0 },
  { x: 8, y: 1 }, { x: 8, y: 2 }, { x: 8, y: 3 }, { x: 8, y: 4 }, { x: 8, y: 5 },
  { x: 9, y: 6 }, { x: 10, y: 6 }, { x: 11, y: 6 }, { x: 12, y: 6 }, { x: 13, y: 6 },
  { x: 14, y: 6 }, { x: 14, y: 7 }, { x: 14, y: 8 },
  { x: 13, y: 8 }, { x: 12, y: 8 }, { x: 11, y: 8 }, { x: 10, y: 8 }, { x: 9, y: 8 },
  { x: 8, y: 9 }, { x: 8, y: 10 }, { x: 8, y: 11 }, { x: 8, y: 12 }, { x: 8, y: 13 },
  { x: 8, y: 14 }, { x: 7, y: 14 }, { x: 6, y: 14 },
];

export const PLAYERS = [
  {
    seat: 0,
    faction: 'p1',
    name: 'Lime',
    entryIndex: 0,
    housePosition: { x: 0, y: 9 },
    homeColumn: [
      { x: 7, y: 13 }, { x: 7, y: 12 }, { x: 7, y: 11 }, { x: 7, y: 10 }, { x: 7, y: 9 },
    ],
  },
  {
    seat: 1,
    faction: 'p2',
    name: 'Cyan',
    entryIndex: 13,
    housePosition: { x: 0, y: 0 },
    homeColumn: [
      { x: 1, y: 7 }, { x: 2, y: 7 }, { x: 3, y: 7 }, { x: 4, y: 7 }, { x: 5, y: 7 },
    ],
  },
  {
    seat: 2,
    faction: 'p3',
    name: 'Pink',
    entryIndex: 26,
    housePosition: { x: 9, y: 0 },
    homeColumn: [
      { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }, { x: 7, y: 4 }, { x: 7, y: 5 },
    ],
  },
  {
    seat: 3,
    faction: 'p4',
    name: 'Violet',
    entryIndex: 39,
    housePosition: { x: 9, y: 9 },
    homeColumn: [
      { x: 13, y: 7 }, { x: 12, y: 7 }, { x: 11, y: 7 }, { x: 10, y: 7 }, { x: 9, y: 7 },
    ],
  },
];

/** Absolute ring indices that are safe: 4 entry squares + 4 stars. */
export const SAFE_INDICES = [0, 8, 13, 21, 26, 34, 39, 47];
export const ENTRY_INDICES = PLAYERS.map((p) => p.entryIndex);
export const STAR_INDICES = SAFE_INDICES.filter((i) => !ENTRY_INDICES.includes(i));

/** Progress -> absolute ring index for a given seat. */
export function trackIndexFor(seat, progress) {
  if (progress < 0 || progress >= TRACK_LENGTH) return null;
  return (PLAYERS[seat].entryIndex + progress) % TRACK_LENGTH;
}

/** True if the absolute ring index is a safe square. */
export function isSafeIndex(index) {
  return index !== null && SAFE_INDICES.includes(index);
}

/** Where a token sits, as a tagged position. */
export function positionOf(seat, progress) {
  if (progress <= IN_HOUSE) return { kind: 'house', seat };
  if (progress < TRACK_LENGTH) {
    const index = trackIndexFor(seat, progress);
    return { kind: 'track', index, cell: TRACK[index] };
  }
  if (progress < HOME) {
    const step = progress - TRACK_LENGTH;
    return { kind: 'home', step, cell: PLAYERS[seat].homeColumn[step] };
  }
  return { kind: 'finished' };
}

/** True when two tokens occupy the same square and can therefore interact. */
export function sharesSquare(a, b) {
  if (a.seat === b.seat) return a.progress === b.progress;
  const ia = trackIndexFor(a.seat, a.progress);
  const ib = trackIndexFor(b.seat, b.progress);
  return ia !== null && ia === ib;
}

export default {
  GRID,
  TRACK,
  TRACK_LENGTH,
  HOME_COLUMN_LENGTH,
  TOKENS_PER_PLAYER,
  IN_HOUSE,
  HOME,
  PLAYERS,
  SAFE_INDICES,
  ENTRY_INDICES,
  STAR_INDICES,
  trackIndexFor,
  isSafeIndex,
  positionOf,
  sharesSquare,
};
