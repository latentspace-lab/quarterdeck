// utils.ts - mathematical and general-purpose helper functions
// Angle convention: 0° = North (+Z), 90° = East (+X), as at sea.
// "Direction" = a heading (whatever it points to), in degrees, normalised to 0..360.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Knots -> m/s and back
export const KNOT_TO_MS = 0.514444;
export const MS_TO_KNOT = 1 / KNOT_TO_MS;

/** Table of [degree, value] pairs, sorted ascending. */
export type Table = ReadonlyArray<readonly [number, number]>;

/** Vector in the XZ plane: +z = North, +x = East. */
export interface Vec2 {
   x: number;
   z: number;
}

export const clamp = (v: number, lo: number, hi: number): number =>
   v < lo ? lo : v > hi ? hi : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (v - a) / (b - a);
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
   const t = clamp(invLerp(edge0, edge1, x), 0, 1);
   return t * t * (3 - 2 * t);
};

// Angle in [0, 360)
export function normDeg(a: number): number {
   let r = a % 360;
   if (r < 0) r += 360;
   return r;
}

// Shortest-path difference between two headings, in [-180, 180]
export function diffDeg(a: number, b: number): number {
   let d = normDeg(b - a);
   if (d > 180) d -= 360;
   return d;
}

// Absolute distance between two headings, in [0,180]
export function absDiffDeg(a: number, b: number): number {
   return Math.abs(diffDeg(a, b));
}

// Uniform "heading" direction (0=N,+z; 90=E,+x) as a vector in the XZ plane
export function dirVec(deg: number): Vec2 {
   const r = deg * DEG;
   return { x: Math.sin(r), z: Math.cos(r) };
}

// Angle between two headings, in [0,180]
export function angleBetweenDeg(a: number, b: number): number {
   return absDiffDeg(a, b);
}

// Interpolation over tabulated values (t in degrees 0..360, tab as [deg,val]
// pairs, sorted, covering 0..360 or via wraparound).
export function interpTable(t: number, tab: Table): number {
   let t0 = t;
   // Wrap onto [0, highest]
   const lo = tab[0][0];
   const hi = tab[tab.length - 1][0];
   if (t0 < lo) t0 += 360;
   if (t0 > hi) t0 -= 360;
   for (let i = 0; i < tab.length - 1; i++) {
      const [d0, v0] = tab[i];
      const [d1, v1] = tab[i + 1];
      if (t0 >= d0 && t0 <= d1) {
         const u = invLerp(d0, d1, t0);
         return lerp(v0, v1, u);
      }
   }
   return tab[tab.length - 1][1];
}

// 1D interpolator factory (for polar curves). Accepts tabulated pairs.
export function makeTableInterpolator(tab: Table): (t: number) => number {
   return (t: number) => interpTable(t, tab);
}

// ---------------------------------------------------------------------------
// dt-invariant smoothing
//
// `lerp(a, b, k)` with a fixed k depends on the call rate: the same process
// runs twice as fast at 60 fps as at 30 fps. For client prediction, every
// smoothing operation must depend on dt alone, never on the number of calls.
// `approach` closes in exponentially with a time constant:
//
//     x(t) = target + (x0 - target) * exp(-t / tau)
//
// With a fixed dt this is exactly reproducible - even when the client and
// server render at different rates.
// ---------------------------------------------------------------------------
export function approach(current: number, target: number, dt: number, tau: number): number {
   if (!(tau > 0)) return target;
   if (!(dt > 0)) return current;
   return target + (current - target) * Math.exp(-dt / tau);
}

/**
 * Half-life notation for the same smoothing: after `halfLife` seconds, half
 * the distance to the target has been closed. Easier to reason about when
 * tuning than a time constant.
 */
export function approachHalfLife(
   current: number,
   target: number,
   dt: number,
   halfLife: number,
): number {
   return approach(current, target, dt, halfLife / Math.LN2);
}
