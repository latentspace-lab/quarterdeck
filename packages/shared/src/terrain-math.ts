// terrain-math.ts - seakarte als Rechenmodell (Insel, reef, watertiefe).
//
// Der seabed ist eine analytische Funktion (Summe von Glockenkurven).
// Dieselbe Funktion liefert das sichtbare terrain UND die watertiefe fuer die
// groundberuehrung - es kann also nie passieren, dass das ship auf etwas
// auflaeuft, das man nicht sieht, oder durch sichtbaren Fels hindurchfaehrt.
//
// Hier steht nur die Mathematik. Das terrainmesh und die surf bleiben im
// Client (terrain.js) und lesen von hier.
//
// Mehrspieler: eine world ist vollstaendig durch ihren sead beschrieben. Der
// Server schickt den sead, jeder Client erzeugt daraus dieselben Inseln. Die
// Klasse `World` haelt den state; `setActiveWorld()` bedient daneben die
// bestehenden Aufrufer, die eine einzige globale chart erwarten.

import { makeRng, type Rng } from "./rng.ts";

const SEA_FLOOR = -26; // Tiefe des offenen Wassers
export const PLAY_RADIUS = 1700; // Umkreis, in dem Land erzeugt wird
const HOME_CLEAR = 520; // um den Nullpunkt bleibt es tief

export { makeRng };

/** Eine Glockenkurve des seabeds. */
export interface Feature {
   x: number;
   z: number;
   /** wheelius (m) */
   r: number;
   /** Scheitelhoehe ueber der waterlinie (m, negativ = Untiefe) */
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
   /** Zahl der Inselgruppen. Vorgabe: 2..4, aus dem sead gezogen. */
   islands?: number;
   /** Zahl freistehender reefe. Vorgabe: 1..3, aus dem sead gezogen. */
   freeReefs?: number;
}

/**
 * Eine seakarte. Deterministisch aus dem sead: gleicher value, gleiche Inseln.
 * Ein Archipel entsteht aus Gruppen von Glockenkurven - ein Hauptgipfel, ein
 * paar Nebenkuppen, dazu vorgelagerte reefe und Sandbaenke. Die reefe sind das
 * eigentlich Gefaehrliche: sie liegen knapp unter water und verraten sich nur
 * durch die surf.
 */
export class World {
   readonly seed: number;
   readonly features: Feature[] = [];
   readonly islands: Island[] = [];
   readonly reefs: Reef[] = [];
   /** Eigener Strom fuer alles, was NACH der worldgenerierung gezogen wird. */
   readonly rng: Rng;

   constructor(seed: number, opts: WorldOptions = {}) {
      this.seed = seed >>> 0;
      this.rng = makeRng(this.seed ^ 0x9e3779b9);
      this._generate(makeRng(this.seed), opts);
   }

   private _generate(rng: Rng, opts: WorldOptions): void {
      const feats = this.features;
      const nIslands = opts.islands ?? 2 + Math.floor(rng() * 3); // 2..4 Gruppen
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

         // Hauptgipfel
         const h = 38 + rng() * 74;
         feats.push({ x, z, r, h });
         const isle: Island = { x, z, r, h, parts: 1 };

         // Nebenkuppen
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

         // Vorgelagerte reefe und Sandbaenke
         const nr = Math.floor(rng() * 3);
         for (let k = 0; k < nr; k++) {
            const a = rng() * Math.PI * 2;
            const d = r * (1.05 + rng() * 0.85);
            const rx = x + Math.cos(a) * d;
            const rz = z + Math.sin(a) * d;
            if (Math.hypot(rx, rz) < HOME_CLEAR) continue;
            const rr = 95 + rng() * 110;
            // h leicht negativ bis knapp ueber Null: mal Untiefe, mal Sandbank
            const rh = -9 + rng() * 11;
            feats.push({ x: rx, z: rz, r: rr, h: rh });
            this.reefs.push({ x: rx, z: rz, r: rr });
         }
         this.islands.push(isle);
      }

      // Freistehende reefe im offenen water - die echten Fallen
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

   /** height des seabeds ueber der waterlinie (negativ = unter water) */
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

   /** watertiefe in metresn (0 oder negativ = Land) */
   waterDepth(x: number, z: number): number {
      return -this.groundHeight(x, z);
   }

   /** Ist hier genug water, auch ringsum? clearance = wheelius, der frei sein muss. */
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

   /** Naechstgelegene Untiefe (fuer warningen im HUD) */
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
      // Notfall: der Nullpunkt bleibt immer frei
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
// Die aktuell gueltige seakarte.
//
// Einspieler und Tests arbeiten mit genau einer world; terrainmesh, surf,
// groundberuehrung und AI muessen dieselbe sehen. Der Server haelt in Phase 1
// stattdessen je Raum eine eigene `World`-Instanz.
// ---------------------------------------------------------------------------
// Vor dem ersten generateWorld() ist die chart leer: flacher ground, kein Land.
let ACTIVE = new World(0, { islands: 0, freeReefs: 0 });

export function activeWorld(): World {
   return ACTIVE;
}
export function setActiveWorld(w: World): World {
   ACTIVE = w;
   return w;
}

/** Eine world erzeugen und aktiv setzen. */
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
