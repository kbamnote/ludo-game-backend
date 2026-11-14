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
export function createRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Derives a 32-bit seed from a string, so a match id can seed a game. */
export function seedFromString(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** One die, 1..6. */
export function rollDie(rng) {
  return 1 + Math.floor(rng() * 6);
}

export default { createRng, seedFromString, rollDie };
