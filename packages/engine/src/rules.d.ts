/** All tokens belonging to a seat. */
export function tokensOf(state: any, seat: any): any;
/**
 * Squares blocked against `seat` — a ring index holding 2+ tokens of ANOTHER
 * player. A block cannot be passed or landed on.
 */
export function blockedIndices(state: any, seat: any): Set<any>;
/**
 * Where a token would land, or null if the move is illegal.
 * Does not consider blocks — `isPathClear` handles those.
 */
export function destinationOf(token: any, roll: any): any;
/**
 * True if nothing blocks the path from `token` to `destination`.
 * Only ring squares can block; the home column is private to its owner.
 */
export function isPathClear(state: any, token: any, destination: any): boolean;
/**
 * Tokens that would be captured by landing on `destination`.
 * Empty on a safe square, or when the square holds a block.
 */
export function capturesAt(state: any, seat: any, destination: any): any;
/** Every legal move for `seat` with `roll`. */
export function legalMoves(state: any, seat: any, roll: any): {
    tokenId: any;
    seat: any;
    from: any;
    to: any;
    captures: any;
    entersHome: boolean;
    leavesHouse: boolean;
}[];
/** A player has won when all their tokens are home. */
export function hasWon(state: any, seat: any): any;
/** Tokens home, for scoreboards. */
export function tokensHome(state: any, seat: any): any;
/**
 * Does this roll earn another turn?
 * A 6, a capture, or getting a token home — but never after three 6s.
 */
export function grantsExtraTurn({ roll, captured, enteredHome, consecutiveSixes }: {
    roll: any;
    captured: any;
    enteredHome: any;
    consecutiveSixes: any;
}): any;
/** Next seat in play order, skipping anyone who has finished. */
export function nextSeat(state: any, seat: any): any;
export const MAX_CONSECUTIVE_SIXES: 3;
declare namespace _default {
    export { legalMoves };
    export { destinationOf };
    export { isPathClear };
    export { capturesAt };
    export { blockedIndices };
    export { hasWon };
    export { tokensHome };
    export { tokensOf };
    export { grantsExtraTurn };
    export { nextSeat };
    export { MAX_CONSECUTIVE_SIXES };
}
export default _default;
