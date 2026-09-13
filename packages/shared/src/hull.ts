// hull.ts - the warship hull as mathematics.
//
// The client lofts its hull mesh from these station profiles; the server needs
// the same numbers for the parts of the hull that matter to gunnery: where the
// gun ports are (muzzle positions), how high the bulwark and the rig reach
// (hit boxes). Both sides read from here, so they cannot drift apart.
//
// Coordinates follow the model: bow = +Z, starboard = +X, y = 0 at the
// waterline. `s` runs 0 (bow) .. 1 (transom), `t` runs 0 (keel) .. 1 (sheer).

import { freeboardOf } from "./pose.ts";
import type { Vessel } from "./vessels.ts";
import type { Side } from "./damage.ts";

/** Three.js' MathUtils.smoothstep, kept bit-identical on purpose. */
export function smooth(x: number, a: number, b: number): number {
   if (x <= a) return 0;
   if (x >= b) return 1;
   x = (x - a) / (b - a);
   return x * x * (3 - 2 * x);
}
/** Three.js' MathUtils.lerp - (1-t)x + ty, not x + (y-x)t; the rounding differs. */
function lerpT(x: number, y: number, t: number): number {
   return (1 - t) * x + t * y;
}

/** Half-breadth along the length (0 = bow, 1 = transom) */
export function hbStation(s: number): number {
   if (s < 0.44) return Math.pow(smooth(s, 0.0, 0.44), 0.72);
   return 1 - 0.4 * Math.pow(smooth(s, 0.44, 1.0), 1.45);
}
/** Keel line: the stem rises forward, slight drag aft */
export function kdStation(s: number): number {
   return 0.26 + 0.74 * smooth(s, 0.0, 0.24) + 0.06 * smooth(s, 0.4, 0.8) - 0.16 * smooth(s, 0.88, 1.0);
}
/** Sheer: high forecastle, lowest amidships, quarterdeck and poop aft */
export function sheerStation(s: number): number {
   return 1.0 + 0.3 * Math.pow(smooth(0.34 - s, 0.0, 0.34), 1.5) + 0.22 * Math.pow(smooth(s - 0.66, 0.0, 0.34), 1.4);
}
/** Section shape: narrow at the keel, full at the waterline, tumblehome above */
export function beamFactor(t: number, tW: number): number {
   const tMax = Math.min(0.94, tW * 1.06 + 0.05);
   if (t <= tMax) {
      const u = t / Math.max(tMax, 1e-4);
      return 0.12 + 0.88 * Math.pow(Math.sin((u * Math.PI) / 2), 0.74);
   }
   const v = (t - tMax) / Math.max(1 - tMax, 1e-4);
   return 1.0 - 0.21 * v * v;
}

export interface HullDim {
   LOA: number;
   BEAM: number;
   DRAFT: number;
   /** freeboard to the bulwark amidships */
   FB: number;
}

export function hullDim(vessel: Vessel): HullDim {
   const { loa, beam, draft } = vessel.hull;
   return { LOA: loa, BEAM: beam, DRAFT: draft, FB: freeboardOf(vessel.hull) };
}

export interface HullPoint {
   x: number;
   y: number;
   z: number;
   /** half-breadth at this station and height */
   hb: number;
   /** sheer height at this station */
   sheer: number;
}

/** Point + half-breadth for station s and height parameter t on side (+1 stbd, -1 port). */
export function makeHullGeom(dim: HullDim) {
   const { LOA, BEAM, DRAFT, FB } = dim;
   const tW = DRAFT / (DRAFT + FB); // height parameter of the waterline

   function point(s: number, t: number, side: number): HullPoint {
      let z = lerpT(LOA / 2, -LOA / 2, s);
      const yKeel = -DRAFT * kdStation(s);
      const ySheer = FB * sheerStation(s);
      const y = yKeel + (ySheer - yKeel) * t;
      const tLocal = (y - yKeel) / Math.max(ySheer - yKeel, 1e-4);
      const tWLocal = (0 - yKeel) / Math.max(ySheer - yKeel, 1e-4);
      const hb = hbStation(s) * (BEAM / 2) * beamFactor(tLocal, tWLocal);
      // Stem and transom rake: flare forward and aft above the waterline
      z += tLocal * LOA * 0.075 * smooth(1 - s, 0.84, 1.0);
      z -= tLocal * LOA * 0.055 * smooth(s, 0.86, 1.0);
      return { x: side * hb, y, z, hb, sheer: ySheer };
   }
   return { point, tW };
}

/** One gun port. */
export interface GunPort {
   side: Side;
   /** index within this side, in firing order */
   idx: number;
   deck: number;
   s: number;
   /** height of the port above the waterline */
   y: number;
   z: number;
   /** half-breadth of the hull at the port */
   hb: number;
}

/**
 * Where the gun ports sit. The port is on its strake, so its height follows
 * the sheer; the half-breadth is looked up on the hull skin at that height.
 * Order: deck by deck, bow to stern, starboard then port - the order the
 * client builds its meshes in.
 */
export function gunLayout(vessel: Vessel): GunPort[] {
   const out: GunPort[] = [];
   if (!vessel.guns) return out;
   const dim = hullDim(vessel);
   const { point } = makeHullGeom(dim);
   const FB = dim.FB;
   const count: Record<Side, number> = { PORT: 0, STBD: 0 };
   vessel.guns.decks.forEach((deck, di) => {
      for (let i = 0; i < deck.count; i++) {
         const s = lerpT(deck.from, deck.to, deck.count === 1 ? 0.5 : i / (deck.count - 1));
         const y = deck.y * FB * sheerStation(s);
         const p = point(s, 0.5, 1);
         let hbHere = p.hb;
         let zHere = p.z;
         for (let t = 0; t <= 1.0001; t += 0.02) {
            const q = point(s, t, 1);
            if (q.y >= y) {
               hbHere = q.hb;
               zHere = q.z;
               break;
            }
         }
         for (const side of ["STBD", "PORT"] as Side[]) {
            out.push({ side, idx: count[side]++, deck: di, s, y, z: zHere, hb: hbHere });
         }
      }
   });
   return out;
}

/** Barrel length - the muzzle stands this far outboard of the port. */
export function barrelLengthOf(vessel: Vessel): number {
   return vessel.hull.beam * 0.16;
}

/** Muzzle positions in the heeler frame, per side, in firing order. */
export function muzzlePositions(vessel: Vessel): { PORT: Array<{ x: number; y: number; z: number }>; STBD: Array<{ x: number; y: number; z: number }> } {
   const barrelLen = barrelLengthOf(vessel);
   const out = { PORT: [] as Array<{ x: number; y: number; z: number }>, STBD: [] as Array<{ x: number; y: number; z: number }> };
   for (const p of gunLayout(vessel)) {
      const sx = p.side === "STBD" ? 1 : -1;
      out[p.side].push({ x: sx * (p.hb + barrelLen * 0.85), y: p.y, z: p.z });
   }
   return out;
}

/** Mean port height above the waterline (m) - what the gunners lay their pieces from. */
export function muzzleHeightOf(vessel: Vessel): number {
   const ports = gunLayout(vessel);
   if (!ports.length) return 2.5;
   let y = 0;
   for (const p of ports) y += p.y;
   return y / ports.length;
}

/** Mast heights as the client builds them, in metres. */
export function mastHeights(vessel: Vessel): { fore: number; main: number; mizzen: number } {
   const LOA = vessel.hull.loa;
   return { fore: LOA * 0.86, main: LOA * 0.98, mizzen: LOA * 0.74 };
}

/** Top of the rig above the waterline - the upper edge of the rigging hit box. */
export function rigTopOf(vessel: Vessel): number {
   const h = mastHeights(vessel);
   return Math.max(h.fore, h.main, h.mizzen) * 1.02;
}

/** Widest yard, half - the rigging hit box's half width. */
export function rigHalfWidthOf(vessel: Vessel): number {
   return vessel.hull.loa * 0.34;
}
