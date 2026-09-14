// damage.ts - Structural model: what breaks and what it costs.
//
// The model is intentionally separated into assemblies because those are what
// drives the tactical decisions of a sea battle of this era:
//
//   Hull    -> The French shot at the hull? No — the Royal Navy shot at the
//              hull (to sink / knock out crews), while the French preferred the
//              rigging (to cripple and escape).
//   Masts   -> go overboard, taking their sail area with them and dragging
//              alongside as wreck until cut away.
//   Rudder  -> without rudder there is no course control.
//   Battery -> knocked-out guns reduce the broadside.
//   Leak    -> water in the ship costs speed, lists the ship, and sinks it.
//
// Units: damage is normalised (0 = intact, 1 = destroyed).

import { clamp, lerp } from "./utils.ts";
import { systemRng, type Rng } from "./rng.ts";
import type { Vessel } from "./vessels.ts";
import type { Where } from "./crew.ts";

export type Side = "PORT" | "STBD";
export type Section = "BOW" | "MID" | "QUARTER";
export type MastKey = "fore" | "main" | "mizzen";
export type MastState = "sound" | "wounded" | "gone";

export interface AmmoSpec {
   id: string;
   name: string;
   short: string;
   desc: string;
   /** Effect factors per assembly */
   hull: number;
   rig: number;
   gun: number;
   crew: number;
   /** Elevation above the horizontal (degrees) */
   elevation: number;
   spreadDeg: number;
   pellets: number;
   rangeFactor: number;
   /** Muzzle velocity (m/s) */
   v0: number;
   /** Drag (1/s in the denominator) */
   drag: number;
}

export interface Hole {
   side: Side;
   sec: Section;
   below: boolean;
   size: number;
}

export interface MastStatus {
   integrity: number;
   state: MastState;
   stress: number;
}

export interface DamageEvent {
   type: string;
   [key: string]: unknown;
}

/** A single hit, as reported by ballistics. */
export interface HitInput {
   side?: Side;
   /** Longitudinal position 0 = bow .. 1 = transom */
   s?: number;
   /** Height above the waterline (m) */
   y?: number;
   ammo?: AmmoSpec;
   /** Ball weight (English pounds) */
   lb?: number;
   /** 0 = near .. 1 = far */
   range01?: number;
   /** Freeboard of the ship hit (m) */
   freeboard?: number;
}

/** What should visibly happen - the caller turns it into effects. */
export interface HitResult {
   section: Section;
   side: Side;
   y: number;
   s: number;
   splinters: number;
   holed: boolean;
   below: boolean;
   mastBroken: { mast: MastKey; cause: string } | null;
   rudderHit: boolean;
   gunsLost: number;
   sailTorn: number;
   fire: boolean;
   crew: { n: number; where: Where };
}

export interface RamInput {
   closingKts: number;
   otherTons: number;
   ownTons: number;
   side: Side;
   s: number;
}

export interface DamageOptions {
   isPlayer?: boolean;
   rng?: Rng;
}

export const SIDES: Side[] = ["PORT", "STBD"];
export const SECTIONS: Section[] = ["BOW", "MID", "QUARTER"];
export const MASTS: MastKey[] = ["fore", "main", "mizzen"];

// Ammunition types: how strongly do they affect which assembly?
export const AMMO: Record<string, AmmoSpec> = {
   ball: {
      id: "ball",
      name: "Round Shot",
      short: "Shot",
      desc: "Penetrates the hull, knocks out guns, bores leaks.",
      hull: 1.0, rig: 0.25, gun: 1.0, crew: 0.50,
      elevation: 1.0,      // degrees above the horizontal
      spreadDeg: 0.9,
      pellets: 1,
      rangeFactor: 1.0,
      v0: 330,             // m/s muzzle velocity
      drag: 0.22,          // drag (1/s in the denominator)
   },
   chain: {
      id: "chain",
      name: "Chain Shot",
      short: "Chain",
      desc: "Two linked hemispheres — devastates rigging and sails.",
      hull: 0.18, rig: 1.4, gun: 0.25, crew: 0.30,
      elevation: 2.2,      // aimed high, into the rigging
      spreadDeg: 2.4,
      pellets: 1,
      rangeFactor: 0.62,   // tumbles, sheds energy fast
      v0: 250,
      drag: 0.55,
   },
   grape: {
      id: "grape",
      name: "Grape Shot",
      short: "Grape",
      desc: "A swarm of small balls — sweeps the deck without breaching the hull.",
      hull: 0.12, rig: 0.40, gun: 1.7, crew: 0.35,  // per pellet!
      elevation: 1.1,
      spreadDeg: 5.5,
      pellets: 9,
      rangeFactor: 0.40,   // only effective at pistol-shot range
      v0: 280,
      drag: 0.85,
   },
};
export const AMMO_ORDER: string[] = ["ball", "chain", "grape"];

// Balance constants for shot damage and flooding, tuned towards the
// historical picture: oak sides swallow dozens of round shot before the
// structure gives way, guns and men are lost long before that, and what
// actually sinks a ship is water - shot holes at or below the waterline
// that the pumps cannot keep up with.
/** Hull damage per hit for an 18-pound ball at point-blank range, scantling 1. */
export const HULL_DAMAGE_PER_HIT = 0.03;
/** Hits up to this height above the nominal waterline (m) count as below water. */
export const WATERLINE_ZONE_M = 0.25;
/** Chance that a below-water hit opens a leak. */
export const LEAK_CHANCE_BELOW = 0.85;
/** Upper edge of the "between wind and water" band, as a fraction of freeboard. */
export const WIND_AND_WATER_BAND = 0.30;
/** Chance that a hit in that band leaks as the ship rolls; the leak is half size. */
export const LEAK_CHANCE_BAND = 0.30;
/** Hull section integrity below which further hits there may leak regardless of height. */
export const BREACHED_BELOW = 0.35;
/** Chance that a hit on such an opened-up section lets water in (half size). */
export const LEAK_CHANCE_BREACHED = 0.25;
/** Leak opened by an 18-pound ball at point-blank range through scantling 1. */
export const LEAK_SIZE_PER_HIT = 0.12;
/** Inflow per unit of open below-water hole size and second (before reserve). */
export const FLOOD_RATE = 0.032;
/** Share of one side's guns dismounted by an 18-pound ball at point-blank range (mean). */
export const GUN_LOSS_PER_HIT = 0.025;

// Section from the longitudinal position (0 = bow, 1 = transom)
export function sectionAt(s: number): Section {
   if (s < 0.33) return "BOW";
   if (s < 0.70) return "MID";
   return "QUARTER";
}

export class DamageModel {
   vessel: Vessel;
   /** hull strength */
   scantling: number;
   /** mast strength */
   mastStrength: number;
   /** reserve buoyancy (time until sinking) */
   reserve: number;
   isPlayer: boolean;
   hull: Record<string, number> = {};
   holes: Hole[] = [];
   /** 0..1, 1 = sunk */
   flooding = 0;
   masts: Record<MastKey, MastStatus>;
   rudder = 1;
   /** Share of guns still operational */
   guns: Record<Side, number> = { PORT: 1, STBD: 1 };
   /** standing/running rigging */
   rigging = 1;
   /** condition of the sailcloth */
   sails = 1;
   afire = 0;
   struck = false;
   sunk = false;
   dead = false;
   /** set from outside (a wreck under tow) */
   wreckDrag = 0;
   log: Array<Record<string, unknown>> = [];
   private rng: Rng;
   private _events: DamageEvent[] = [];

   constructor(vessel: Vessel, opts: DamageOptions = {}) {
      this.vessel = vessel;
      this.rng = opts.rng ?? systemRng;
      const st = vessel.structure || {};
      this.scantling = st.scantling ?? 1;        // hull strength
      this.mastStrength = st.mastStrength ?? 1;  // mast strength
      this.reserve = st.reserve ?? 1;            // reserve buoyancy (time until sinking)
      this.isPlayer = !!opts.isPlayer;

      for (const side of SIDES) {
         for (const sec of SECTIONS) this.hull[side + "_" + sec] = 1;
      }
      this.masts = {
         fore: { integrity: 1, state: "sound", stress: 0 },
         main: { integrity: 1, state: "sound", stress: 0 },
         mizzen: { integrity: 1, state: "sound", stress: 0 },
      };
   }

   /** Set the randomness source after the fact. */
   setRng(rng: Rng): void {
      this.rng = rng;
   }

   // ------------------------------------------------------------ Queries
   // Mean condition of all six hull sections (for the display)
   hullAverage(): number {
      let s = 0, n = 0;
      for (const k in this.hull) { s += this.hull[k]; n++; }
      return n ? s / n : 1;
   }
   // Combat power of the hull. The reference quantity is one fully shot-up
   // broadside (three sections), not the whole hull - a ship is done for
   // once ONE side is torn open, not only once both are.
   integrity(): number {
      let dmg = 0;
      for (const k in this.hull) dmg += 1 - this.hull[k];
      return clamp(1 - dmg / 3, 0, 1);
   }
   mastsStanding(): number {
      return MASTS.filter((m) => this.masts[m].state !== "gone").length;
   }
   // Share of sail power the ship can still bring to bear.
   // The masts carry different shares: main > fore > mizzen.
   driveFactor(): number {
      const share = { fore: 0.36, main: 0.44, mizzen: 0.20 };
      let d = 0;
      for (const m of MASTS) {
         const st = this.masts[m];
         if (st.state === "gone") continue;
         d += share[m] * (st.state === "wounded" ? 0.55 : 1) * lerp(0.55, 1, st.integrity);
      }
      return clamp(d * lerp(0.62, 1, this.sails) * lerp(0.75, 1, this.rigging), 0, 1);
   }
   rudderFactor(): number { return clamp(lerp(0.10, 1, this.rudder), 0.10, 1); }
   // Water in the ship: sluggish, deeper, slower
   floodSpeedFactor(): number { return clamp(1 - 0.55 * this.flooding, 0.25, 1); }
   floodHeel(): number { return this.flooding * 14; }        // degrees of list
   gunFraction(side: Side): number { return clamp(this.guns[side], 0, 1); }
   beaten(): boolean {
      return this.integrity() < 0.32 || this.mastsStanding() <= 1 || this.flooding > 0.5;
   }
   drainEvents(): DamageEvent[] { const e = this._events; this._events = []; return e; }
   /** Queue an event. Public because seamanship and the ship classes report through the same queue. */
   _event(type: string, data: Record<string, unknown>): void { this._events.push({ type, ...data }); }

   // ------------------------------------------------------------ Hits
   // hit: { side, s (0..1 bow->stern), y (height above the waterline, m),
   //        ammo (AMMO entry), lb (ball weight), range01 (0 near .. 1 far),
   //        freeboard (m) }
   // Return value describes what should visibly happen (splinters, mast break ...)
   applyHit(hit: HitInput): HitResult | null {
      if (this.sunk) return null;
      const a = hit.ammo || AMMO.ball;
      const sec = sectionAt(clamp(hit.s ?? 0.5, 0, 1));
      const side: Side = hit.side === "PORT" ? "PORT" : "STBD";
      const lb = hit.lb ?? 18;
      const FB = hit.freeboard || 4;

      // Energy falls off with range; chain and grape much faster.
      // Effect falls off with range. Ballistics already limits the range;
      // here it's only about the remaining momentum.
      const reach = clamp(1 - (hit.range01 ?? 0) * 0.60 / Math.max(a.rangeFactor, 0.30), 0.10, 1);
      const power = (lb / 18) * reach;

      const res: HitResult = {
         section: sec, side, y: hit.y ?? FB * 0.5, s: hit.s ?? 0.5,
         splinters: 0, holed: false, below: false,
         mastBroken: null, rudderHit: false, gunsLost: 0, sailTorn: 0, fire: false,
         // Who gets hit aboard - the caller books it against the crew
         crew: { n: 0, where: "hull" },
      };

      // --- Crew losses ---------------------------------------------------
      // Not the ball that kills, but the splinter cloud it tears from the
      // hull — and at close range, grape shot.
      const isRigHit = (hit.y ?? 0) > FB * 1.25;
      res.crew.n = Math.round(power * a.crew * (1.2 + this.rng() * 2.2));
      res.crew.where = isRigHit ? "rigging" : (a.id === "grape" ? "deck" : "hull");

      // --- Hull ----------------------------------------------------------
      if (!isRigHit) {
         // Structural damage is slow: an 18-pounder at point-blank range takes
         // ~3 % off a section, so a side needs dozens of hits before it is
         // beaten. Water is the faster killer, see the leak rules below.
         const dmg = power * a.hull * HULL_DAMAGE_PER_HIT / this.scantling;
         const key = side + "_" + sec;
         const breached = this.hull[key] < BREACHED_BELOW;
         this.hull[key] = clamp(this.hull[key] - dmg, 0, 1);
         res.splinters = Math.round(clamp(power * a.hull * 9, 2, 26));

         // Does the ball go through the side at all? Chain barely, grape not,
         // a spent ball at long range lodges in the timber.
         if (a.hull > 0.5 && power * a.hull / this.scantling > 0.22) {
            res.holed = true;
            // Where the ball went in decides whether water follows:
            //  - at or below the waterline: almost always a leak;
            //  - "between wind and water", the strip the roll exposes: sometimes;
            //  - higher up: only once the section is shot through and the
            //    planking is working loose.
            const y = hit.y ?? FB * 0.5;
            const belowWater = y < WATERLINE_ZONE_M;
            const inBand = !belowWater && y < FB * WIND_AND_WATER_BAND;
            let leak = 0;
            if (belowWater) { if (this.rng() < LEAK_CHANCE_BELOW) leak = 1; }
            else if (inBand) { if (this.rng() < LEAK_CHANCE_BAND) leak = 0.5; }
            else if (breached) { if (this.rng() < LEAK_CHANCE_BREACHED) leak = 0.5; }
            if (leak > 0) {
               res.below = true;
               const size = leak * LEAK_SIZE_PER_HIT * power / this.scantling * (0.7 + this.rng() * 0.6);
               this.holes.push({ side, sec, below: true, size });
               this._event("holed", { side, sec, size });
            } else {
               this.holes.push({ side, sec, below: false, size: dmg });
            }
         }

         // Guns dismounted
         if (a.gun > 0 && sec !== "QUARTER") {
            const loss = power * a.gun * GUN_LOSS_PER_HIT * (0.5 + this.rng());
            const before = this.guns[side];
            this.guns[side] = clamp(this.guns[side] - loss, 0, 1);
            res.gunsLost = before - this.guns[side];
         }
         // The rudder sits aft
         if (sec === "QUARTER" && this.rng() < 0.16 * power * a.hull) {
            this.rudder = clamp(this.rudder - (0.25 + this.rng() * 0.4), 0, 1);
            res.rudderHit = true;
            this._event("rudder", { rudder: this.rudder });
         }
         // Fire
         if (this.rng() < 0.025 * power * (a.id === "ball" ? 1 : 0.4)) {
            this.afire = clamp(this.afire + 0.18, 0, 1);
            res.fire = true;
         }
      }

      // --- Rigging --------------------------------------------------------
      if (a.rig > 0) {
         const rigDmg = power * a.rig * 0.030;
         this.rigging = clamp(this.rigging - rigDmg * 0.7, 0, 1);
         this.sails = clamp(this.sails - rigDmg * 0.9, 0, 1);
         res.sailTorn = rigDmg;

         // Which mast? Chain shot preferentially strikes the mainmast.
         const target: MastKey | null = isRigHit || a.rig > 1
            ? this._mastFor(hit.s ?? 0.5)
            : null;
         if (target) {
            const m = this.masts[target];
            if (m.state !== "gone") {
               m.integrity = clamp(m.integrity - rigDmg * 1.30 / this.mastStrength, 0, 1);
               if (m.integrity <= 0) {
                  res.mastBroken = this._breakMast(target, "shot");
               } else if (m.integrity < 0.45 && m.state === "sound") {
                  m.state = "wounded";
                  this._event("mastWounded", { mast: target });
               }
            }
         }
      }
      return res;
   }

   private _mastFor(s: number): MastKey {
      // Longitudinal position -> nearest mast (fore forward, mizzen aft)
      if (s < 0.38) return "fore";
      if (s < 0.72) return "main";
      return "mizzen";
   }

   // Mast goes overboard. Return value tells the caller what to break away.
   private _breakMast(key: MastKey, cause: string): { mast: MastKey; cause: string } | null {
      const m = this.masts[key];
      if (m.state === "gone") return null;
      m.state = "gone";
      m.integrity = 0;
      // A falling mast tears away shrouds and stays with it
      this.rigging = clamp(this.rigging - 0.22, 0, 1);
      this.sails = clamp(this.sails - 0.12, 0, 1);
      this._event("mastLost", { mast: key, cause });
      this.log.push({ t: "mast", mast: key, cause });
      return { mast: key, cause };
   }

   // From outside: let a mast break from overload or collision
   breakMast(key: MastKey, cause = "force") { return this._breakMast(key, cause); }

   // --------------------------------------------------------- Ram strike
   // Collision: energy from mass and closing speed.
   applyRam({ closingKts, otherTons, ownTons, side, s }: RamInput) {
      const v = Math.abs(closingKts) * 0.514444;
      // specific energy, normalised to own mass
      const e = 0.5 * v * v * clamp(otherTons / Math.max(ownTons, 1), 0.15, 4) / 120;
      const sec: Section = sectionAt(clamp(s ?? 0.5, 0, 1));
      const key = (side === "PORT" ? "PORT" : "STBD") + "_" + sec;
      const dmg = clamp(e / this.scantling, 0, 0.9);
      this.hull[key] = clamp(this.hull[key] - dmg, 0, 1);
      const res: { section: Section; side: Side; splinters: number; mastBroken: { mast: MastKey; cause: string } | null; below: boolean } =
         { section: sec, side, splinters: Math.round(clamp(dmg * 120, 3, 40)), mastBroken: null, below: false };
      if (dmg > 0.10 && this.rng() < 0.7) {
         this.holes.push({ side, sec, below: true, size: dmg * 0.8 });
         res.below = true;
         this._event("holed", { side, sec, size: dmg * 0.8 });
      }
      // A hard blow carries away topmasts
      if (dmg > 0.22) {
         const standing = MASTS.filter((k) => this.masts[k].state !== "gone");
         if (standing.length && this.rng() < 0.55) {
            res.mastBroken = this._breakMast(standing[(this.rng() * standing.length) | 0], "ram");
         }
      }
      this._event("ram", { dmg });
      return res;
   }

   // --------------------------------------------------------- Grounding
   applyGrounding({ speedKts, draft, depth }: { speedKts: number; draft: number; depth: number }): number {
      const over = clamp((draft - depth) / Math.max(draft, 0.5), 0, 1);
      const dmg = clamp(over * (0.02 + speedKts * 0.020), 0, 0.55);
      for (const sec of ["BOW", "MID"] as Section[]) {
         for (const side of SIDES) {
            this.hull[side + "_" + sec] = clamp(this.hull[side + "_" + sec] - dmg * 0.5, 0, 1);
         }
      }
      if (dmg > 0.03) {
         this.holes.push({ side: "PORT", sec: "BOW", below: true, size: dmg });
         this.holes.push({ side: "STBD", sec: "BOW", below: true, size: dmg });
         this._event("aground", { dmg });
      }
      return dmg;
   }

   // --------------------------------------------------- Storm overpress
   // Too much sail in too much wind: topmasts go overboard. That is exactly
   // what the reefing controls are for.
   stressRig(dt: number, { windKts, sailSet, twa }: { windKts: number; sailSet: number; twa: number }) {
      // Dynamic pressure ~ v^2; close-hauled the rig stands at more of an angle and suffers more
      const upwind = 1 + 0.45 * Math.cos(clamp(Math.abs(twa), 0, 180) * Math.PI / 180);
      const stress = Math.pow(clamp(windKts, 0, 90) / 34, 2) * clamp(sailSet, 0, 1) * upwind;
      let broke: { mast: MastKey; cause: string } | null = null;
      for (const key of MASTS) {
         const m = this.masts[key];
         m.stress = stress;
         if (m.state === "gone") continue;
         if (stress > 1) {
            // weakened masts give way first
            const weak = lerp(1.9, 0.7, m.integrity);
            m.integrity = clamp(m.integrity - (stress - 1) * 0.030 * weak * dt / this.mastStrength, 0, 1);
            if (m.integrity <= 0 && !broke) broke = this._breakMast(key, "overpress");
            else if (m.integrity < 0.45 && m.state === "sound") {
               m.state = "wounded";
               this._event("mastWounded", { mast: key });
            }
         }
      }
      return broke;
   }

   // ------------------------------------------------------------- Ongoing
   update(dt: number, ctx: { heel?: number; pump?: number } = {}): void {
      if (this.sunk) return;

      // Flooding: open below-water leaks fill the ship.
      // Pumps can handle small leaks, not large ones.
      let inflow = 0;
      for (const h of this.holes) if (h.below) inflow += h.size;
      const heelExtra = clamp((ctx.heel ?? 0) / 40, 0, 1) * 0.4;
      // Pumps only run while people are at them
      const pumps = (this.isPlayer ? 0.010 : 0.008) * clamp(ctx.pump ?? 1, 0, 1.3);
      const rate = (inflow * FLOOD_RATE * (1 + heelExtra)) / Math.max(this.reserve, 0.2);
      this.flooding = clamp(this.flooding + (rate - pumps) * dt, 0, 1);
      if (this.flooding >= 1 && !this.sunk) {
         this.sunk = true;
         this._event("sunk", {});
      }

      // Fire: spreads, the watch fights it
      if (this.afire > 0) {
         this.afire = clamp(this.afire + (this.afire * 0.055 - 0.035) * dt, 0, 1);
         if (this.afire > 0.05) {
            const d = this.afire * 0.02 * dt;
            this.rigging = clamp(this.rigging - d, 0, 1);
            this.sails = clamp(this.sails - d * 1.5, 0, 1);
            for (const k in this.hull) this.hull[k] = clamp(this.hull[k] - d * 0.35, 0, 1);
         }
         if (this.afire >= 0.98) { this.sunk = true; this._event("exploded", {}); }
      }

      // Struck colours: a beaten ship does not fight to the death
      if (!this.struck && !this.isPlayer && this.beaten()) {
         this.struck = true;
         this._event("struck", {});
      }
   }

   status() {
      return {
         hull: this.integrity(),
         hullAvg: this.hullAverage(),
         sections: { ...this.hull },
         hullBySide: {
            PORT: (this.hull.PORT_BOW + this.hull.PORT_MID + this.hull.PORT_QUARTER) / 3,
            STBD: (this.hull.STBD_BOW + this.hull.STBD_MID + this.hull.STBD_QUARTER) / 3,
         },
         masts: { ...this.masts },
         mastsStanding: this.mastsStanding(),
         rudder: this.rudder,
         guns: { ...this.guns },
         rigging: this.rigging,
         sails: this.sails,
         flooding: this.flooding,
         afire: this.afire,
         struck: this.struck,
         sunk: this.sunk,
         drive: this.driveFactor(),
         holesBelow: this.holes.filter((h) => h.below).length,
      };
   }
}
