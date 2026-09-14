// terrain-math.ts - the chart as a computational model (island, reef, water depth).
//
// The seabed is an analytic function (a sum of bell curves). The same
// function provides both the visible terrain AND the water depth for
// grounding checks - so it can never happen that a ship runs aground on
// something invisible, or sails straight through visible rock.
//
// Only the mathematics lives here. The terrain mesh and the surf stay in the
// client (terrain.js) and read from here.
//
// Multiplayer: a world is fully described by its seed. The server sends the
// seed, and every client generates the same islands from it. The `World`
// class holds the state; `setActiveWorld()` also serves the existing
// callers that expect a single global map.

import { makeRng, type Rng } from "./rng.ts";

const SEA_FLOOR = -26; // depth of open water
export const PLAY_RADIUS = 1700; // radius within which land is generated
const HOME_CLEAR = 520; // it stays deep around the origin

export { makeRng };

/** One bell curve of the seabed. */
export interface Feature {
   x: number;
   z: number;
   /** Radius (m) */
   r: number;
   /** Peak height above the waterline (m, negative = shoal) */
   h: number;
}

export interface Island {
   x: number;
   z: number;
   r: number;
   h: number;
   parts: number;
}

export interface Reef {
   x: number;
   z: number;
   r: number;
}

export interface WorldOptions {
   /** Number of island groups. Default: 2..4, drawn from the seed. */
   islands?: number;
   /** Number of standalone reefs. Default: 1..3, drawn from the seed. */
   freeReefs?: number;
}

/**
 * A chart. Deterministic from the seed: same value, same islands.
 * An archipelago is formed from groups of bell curves - one main peak, a few
 * minor knolls, plus outlying reefs and sandbanks. The reefs are the real
 * danger: they lie just under the water and betray themselves only through
 * the surf.
 */
export class World {
   readonly seed: number;
   readonly features: Feature[] = [];
   readonly islands: Island[] = [];
   readonly reefs: Reef[] = [];
   /** A dedicated stream for anything drawn AFTER world generation. */
   readonly rng: Rng;

   constructor(seed: number, opts: WorldOptions = {}) {
      this.seed = seed >>> 0;
      this.rng = makeRng(this.seed ^ 0x9e3779b9);
      this._generate(makeRng(this.seed), opts);
   }

   private _generate(rng: Rng, opts: WorldOptions): void {
      const feats = this.features;
      const nIslands = opts.islands ?? 2 + Math.floor(rng() * 3); // 2..4 groups
      const placed: Array<{ x: number; z: number; r: number }> = [];

      const farEnough = (x: number, z: number, r: number): boolean => {
         if (Math.hypot(x, z) < HOME_CLEAR + r) return false;
         for (const p of placed) {
            if (Math.hypot(x - p.x, z - p.z) < (r + p.r) * 1.15) return false;
         }
         return true;
      };

      for (let i = 0; i < nIslands; i++) {
         let x = 0;
         let z = 0;
         let r = 0;
         let ok = false;
         for (let tries = 0; tries < 60 && !ok; tries++) {
            const ang = rng() * Math.PI * 2;
            const dist = HOME_CLEAR + 180 + rng() * (PLAY_RADIUS - HOME_CLEAR - 300);
            x = Math.cos(ang) * dist;
            z = Math.sin(ang) * dist;
            r = 200 + rng() * 230;
            ok = farEnough(x, z, r);
         }
         if (!ok) continue;
         placed.push({ x, z, r });

         // Main peak
         const h = 38 + rng() * 74;
         feats.push({ x, z, r, h });
         const isle: Island = { x, z, r, h, parts: 1 };

         // Minor knolls
         const sub = 1 + Math.floor(rng() * 3);
         for (let k = 0; k < sub; k++) {
            const a = rng() * Math.PI * 2;
            const d = r * (0.45 + rng() * 0.75);
            feats.push({
               x: x + Math.cos(a) * d,
               z: z + Math.sin(a) * d,
               r: r * (0.4 + rng() * 0.45),
               h: h * (0.25 + rng() * 0.55),
            });
            isle.parts++;
         }

         // Outlying reefs and sandbanks
         const nr = Math.floor(rng() * 3);
         for (let k = 0; k < nr; k++) {
            const a = rng() * Math.PI * 2;
            const d = r * (1.05 + rng() * 0.85);
            const rx = x + Math.cos(a) * d;
            const rz = z + Math.sin(a) * d;
            if (Math.hypot(rx, rz) < HOME_CLEAR) continue;
            const rr = 95 + rng() * 110;
            // h slightly negative to just above zero: sometimes a shoal, sometimes a sandbank
            const rh = -9 + rng() * 11;
            feats.push({ x: rx, z: rz, r: rr, h: rh });
            this.reefs.push({ x: rx, z: rz, r: rr });
         }
         this.islands.push(isle);
      }

      // Standalone reefs in open water - the real traps
      const nFree = opts.freeReefs ?? 1 + Math.floor(rng() * 3);
      for (let i = 0; i < nFree; i++) {
         let x = 0;
         let z = 0;
         let ok = false;
         let rr = 0;
         for (let tries = 0; tries < 50 && !ok; tries++) {
            const ang = rng() * Math.PI * 2;
            const dist = HOME_CLEAR + 120 + rng() * (PLAY_RADIUS - HOME_CLEAR - 200);
            x = Math.cos(ang) * dist;
            z = Math.sin(ang) * dist;
            rr = 110 + rng() * 110;
            ok = true;
            for (const p of placed) {
               if (Math.hypot(x - p.x, z - p.z) < p.r * 1.2) {
                  ok = false;
                  break;
               }
            }
         }
         if (!ok) continue;
         feats.push({ x, z, r: rr, h: -8.5 + rng() * 7 });
         this.reefs.push({ x, z, r: rr });
      }
   }

   /** Height of the seabed above the waterline (negative = underwater) */
   groundHeight(x: number, z: number): number {
      let h = SEA_FLOOR;
      const feats = this.features;
      for (let i = 0; i < feats.length; i++) {
         const f = feats[i];
         const dx = x - f.x;
         const dz = z - f.z;
         const d2 = (dx * dx + dz * dz) / (f.r * f.r);
         if (d2 > 9) continue;
         h += (f.h - SEA_FLOOR) * Math.exp(-d2 * 1.15);
      }
      return h;
   }

   /** Water depth in metres (0 or negative = land) */
   waterDepth(x: number, z: number): number {
      return -this.groundHeight(x, z);
   }

   /** Is there enough water here, all around too? clearance = radius that must be clear. */
   isOpenWater(x: number, z: number, minDepth = 15, clearance = 200): boolean {
      if (this.waterDepth(x, z) < minDepth) return false;
      for (let i = 0; i < 8; i++) {
         const a = (i / 8) * Math.PI * 2;
         if (
            this.waterDepth(x + Math.cos(a) * clearance, z + Math.sin(a) * clearance) <
            minDepth * 0.6
         ) {
            return false;
         }
      }
      return true;
   }

   /** Nearest shoal (for HUD warnings) */
   nearestShoal(x: number, z: number): { dist: number; x: number; z: number; r: number } | null {
      let best: { dist: number; x: number; z: number; r: number } | null = null;
      for (const f of this.features) {
         const d = Math.hypot(x - f.x, z - f.z) - f.r;
         if (!best || d < best.dist) best = { dist: d, x: f.x, z: f.z, r: f.r };
      }
      return best;
   }

   findOpenWater(opts: FindOpenWaterOptions = {}): { x: number; z: number } {
      const rng = opts.rng || this.rng;
      const near = opts.near || { x: 0, z: 0 };
      const minDist = opts.minDist ?? 0;
      const maxDist = opts.maxDist ?? 600;
      const minDepth = opts.minDepth ?? 15;
      const clearance = opts.clearance ?? 220;
      const avoid = opts.avoid || [];
      for (let tries = 0; tries < 400; tries++) {
         const a = rng() * Math.PI * 2;
         const d = minDist + rng() * Math.max(maxDist - minDist, 1);
         const x = near.x + Math.cos(a) * d;
         const z = near.z + Math.sin(a) * d;
         let bad = false;
         for (const av of avoid) {
            if (Math.hypot(x - av.x, z - av.z) < (av.r || 200)) {
               bad = true;
               break;
            }
         }
         if (bad) continue;
         if (this.isOpenWater(x, z, minDepth, clearance)) return { x, z };
      }
      // Fallback: the origin always stays clear
      return { x: near.x, z: near.z };
   }
}

export interface FindOpenWaterOptions {
   rng?: Rng;
   near?: { x: number; z: number };
   minDist?: number;
   maxDist?: number;
   minDepth?: number;
   clearance?: number;
   avoid?: Array<{ x: number; z: number; r?: number }>;
}

// ---------------------------------------------------------------------------
// The currently active chart.
//
// Single-player and tests work with exactly one world; the terrain mesh,
// surf, grounding checks and AI must all see the same one. In Phase 1 the
// server instead holds its own `World` instance per room.
// ---------------------------------------------------------------------------
// Before the first generateWorld(), the map is empty: flat seabed, no land.
let ACTIVE = new World(0, { islands: 0, freeReefs: 0 });

export function activeWorld(): World {
   return ACTIVE;
}
export function setActiveWorld(w: World): World {
   ACTIVE = w;
   return w;
}

/** Generate a world and set it active. */
export function generateWorld(
   seed: number = (Math.random() * 1e9) | 0,
   opts: WorldOptions = {},
): World {
   return setActiveWorld(new World(seed, opts));
}

export function worldInfo(): World {
   return ACTIVE;
}
export function groundHeight(x: number, z: number): number {
   return ACTIVE.groundHeight(x, z);
}
export function waterDepth(x: number, z: number): number {
   return ACTIVE.waterDepth(x, z);
}
export function isOpenWater(x: number, z: number, minDepth = 15, clearance = 200): boolean {
   return ACTIVE.isOpenWater(x, z, minDepth, clearance);
}
export function nearestShoal(x: number, z: number) {
   return ACTIVE.nearestShoal(x, z);
}
export function findOpenWater(opts: FindOpenWaterOptions = {}) {
   return ACTIVE.findOpenWater(opts);
}
