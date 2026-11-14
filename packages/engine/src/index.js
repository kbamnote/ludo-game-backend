/**
 * @ludo/engine — the canonical Ludo rules.
 *
 * Shared by ludo-server (authority) and ludo-mobile (prediction and
 * presentation). One package, never two copies: if the two sides disagree
 * about a rule, the client proposes moves the server rejects, which is the
 * worst class of multiplayer bug (risk R11).
 *
 * Constraints this package keeps:
 *   - plain JavaScript (ESM) with JSDoc, so the JSX app imports it with no
 *     build step and a TypeScript server can still type-check it
 *   - zero dependencies, no Node built-ins, no React, no I/O
 *   - pure and deterministic; the RNG is injected, never ambient
 */
export * from './board.js';
export * from './dice.js';
export * from './rules.js';
export * from './engine.js';

export { default as board } from './board.js';
export { default as rules } from './rules.js';
export { default as engine } from './engine.js';
