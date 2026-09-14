// rng.ts - deterministic randomness.
//
// Every random decision in the simulation runs through an injected
// generator, never through Math.random(). That buys two things:
//
//   1. Repeatable tests: same seed + same inputs -> same battle, headless
//      and without a browser.
//   2. Repeatable salvos (Phase 3C): the server sends a seed and a
//      timestamp, and every client recomputes the same trajectory.
//
// What it does NOT buy: agreement between client and server on damage
// rolls. In the server-authoritative design, damage logic never runs on the
// client at all, and the order in which the server consumes its generator
// depends on the arrival order of inputs anyway.

/** Returns a uniform distribution in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32 - small, fast, distributed well enough for game logic.
 * Comes from terrain.js, where it has been the world generator all along.
 */
export function makeRng(seed: number): Rng {
   let a = (seed >>> 0) || 1;
   return function rng(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
   };
}

/**
 * Derived generator: a seed and a name produce their own independent
 * stream. This way the damage model does not consume the numbers the world
 * generator is waiting on.
 */
export function deriveRng(seed: number, label: string): Rng {
   let h = seed >>> 0;
   for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
   }
   return makeRng(h);
}

/** Normally distributed random number (Box-Muller), for estimation errors. */
export function gauss(rng: Rng): number {
   let u = 0;
   let v = 0;
   while (u === 0) u = rng();
   while (v === 0) v = rng();
   return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Fallback for callers that don't (yet) pass a generator through. Used in
 * pure modules deliberately only as a default value, so a forgotten
 * parameter does not break single-player - tests and the server always pass
 * a real seed.
 */
export const systemRng: Rng = Math.random;
