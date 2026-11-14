/**
 * Dice.
 *
 * The RNG is INJECTED, never ambient. Two reasons, both load-bearing:
 *
 *   1. Determinism. A match replays exactly from its seed, which is what
 *      makes desync bugs debuggable and results auditable.
 *   2. Authority. From Phase 5 the SERVER rolls and the client is told the
 *      result. If this module reached for Math.random the client could roll
 *      its own, which is precisely the client-trust the brief forbids.
 *
 * The onboarding screen advertises "PROVABLY FAIR DICE", so a seeded,
 * reproducible roll is a product promise, not just hygiene.
 */
/**
 * mulberry32 — small, fast, well-distributed 32-bit PRNG.
 * Chosen over an LCG because the low bits of an LCG are poor, and dice take
 * exactly those bits.
 */
export function createRng(seed: any): () => number;
/** Derives a 32-bit seed from a string, so a match id can seed a game. */
export function seedFromString(text: any): number;
/** One die, 1..6. */
export function rollDie(rng: any): number;
declare namespace _default {
    export { createRng };
    export { seedFromString };
    export { rollDie };
}
export default _default;
