/** Progress -> absolute ring index for a given seat. */
export function trackIndexFor(seat: any, progress: any): number | null;
/** True if the absolute ring index is a safe square. */
export function isSafeIndex(index: any): boolean;
/** Where a token sits, as a tagged position. */
export function positionOf(seat: any, progress: any): {
    kind: string;
    seat: any;
    index?: undefined;
    cell?: undefined;
    step?: undefined;
} | {
    kind: string;
    index: number | null;
    cell: any;
    seat?: undefined;
    step?: undefined;
} | {
    kind: string;
    step: number;
    cell: {
        x: number;
        y: number;
    };
    seat?: undefined;
    index?: undefined;
} | {
    kind: string;
    seat?: undefined;
    index?: undefined;
    cell?: undefined;
    step?: undefined;
};
/** True when two tokens occupy the same square and can therefore interact. */
export function sharesSquare(a: any, b: any): boolean;
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
export const GRID: 15;
export const TRACK_LENGTH: 52;
export const HOME_COLUMN_LENGTH: 5;
export const TOKENS_PER_PLAYER: 4;
/** progress value meaning "still in the house". */
export const IN_HOUSE: -1;
/** progress value meaning "finished". */
export const HOME: number;
/**
 * The 52-cell shared ring, clockwise.
 *
 * Note the four diagonal turns — (6,9)->(5,8), (5,6)->(6,5), (8,5)->(9,6),
 * (9,8)->(8,9). These are correct: at each one the cell in between belongs to
 * the central goal block, so the path steps around the goal's corner, exactly
 * as a physical board does.
 */
export const TRACK: {
    x: number;
    y: number;
}[];
export const PLAYERS: {
    seat: number;
    faction: string;
    name: string;
    entryIndex: number;
    housePosition: {
        x: number;
        y: number;
    };
    homeColumn: {
        x: number;
        y: number;
    }[];
}[];
/** Absolute ring indices that are safe: 4 entry squares + 4 stars. */
export const SAFE_INDICES: number[];
export const ENTRY_INDICES: number[];
export const STAR_INDICES: number[];
declare namespace _default {
    export { GRID };
    export { TRACK };
    export { TRACK_LENGTH };
    export { HOME_COLUMN_LENGTH };
    export { TOKENS_PER_PLAYER };
    export { IN_HOUSE };
    export { HOME };
    export { PLAYERS };
    export { SAFE_INDICES };
    export { ENTRY_INDICES };
    export { STAR_INDICES };
    export { trackIndexFor };
    export { isSafeIndex };
    export { positionOf };
    export { sharesSquare };
}
export default _default;
