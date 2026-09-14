// Captain.ts - an AI captain for a server ship.
//
// A port of the client's fleet.js Captain onto ServerShip. The captain can do
// only what a player can: work the rudder, set or reef sail, and order a
// broadside. Doctrine: the Royal Navy fired into the hull, the French into the
// rigging to cripple and escape - both are here and fight noticeably
// differently.

import {
   AMMO,
   clamp,
   normDeg,
   diffDeg,
   type Rng,
   type Side,
   type TargetBox,
} from "@quarterdeck/shared";
import type { Matrix4 } from "three/src/math/Matrix4.js";
import type { ServerShip } from "./ServerShip.ts";

export type Doctrine = "rig" | "hull";

export interface CaptainOptions {
   doctrine?: Doctrine;
   /** 0.3 .. 1.5 - gunnery skill and steadiness */
   skill?: number;
   /** preferred fighting range (m) */
   engage?: number;
   aggression?: number;
   rng?: Rng;
}

export interface CaptainContext {
   wind: { dir: number; speedKts: number };
   target: ServerShip | null;
   /** own heeler matrix this tick */
   ownMatrix: Matrix4;
   targets: TargetBox[];
}

/** The course a ship can actually hold: a wish inside the no-go zone is turned to the nearest sailable edge. */
export function sailableHeading(desired: number, windDir: number, noGo: number): number {
   const twa = diffDeg(desired, windDir);
   if (Math.abs(twa) >= noGo) return normDeg(desired);
   const a = normDeg(windDir - noGo);
   const b = normDeg(windDir + noGo);
   return Math.abs(diffDeg(desired, a)) < Math.abs(diffDeg(desired, b)) ? a : b;
}

export class Captain {
   readonly ship: ServerShip;
   doctrine: Doctrine;
   skill: number;
   engage: number;
   aggression: number;
   state: "engage" | "flee" | "struck" = "engage";
   private readonly rng: Rng;
   private side = 1;
   private sideTimer = 0;
   lastFire = 0;

   constructor(ship: ServerShip, opts: CaptainOptions = {}) {
      this.ship = ship;
      this.doctrine = opts.doctrine || "rig";
      this.skill = clamp(opts.skill ?? 0.85, 0.3, 1.5);
      this.engage = opts.engage ?? 190;
      this.aggression = opts.aggression ?? 1;
      this.rng = opts.rng || ship.rng;
   }

   update(dt: number, ctx: CaptainContext): void {
      const ship = this.ship;
      const dyn = ship.dyn;
      const D = ship.dmg;
      this.lastFire += dt;
      if (!ship.alive || D.sunk) return;

      if (D.struck) {
         this.state = "struck";
         dyn.sailSet = 0.25;
         dyn.setRudder(0);
         return;
      }

      const target = ctx.target;
      if (!target || !target.alive) {
         dyn.sailSet = 1;
         dyn.setRudder(0);
         return;
      }

      const dx = target.pos.x - ship.pos.x;
      const dz = target.pos.z - ship.pos.z;
      const dist = Math.hypot(dx, dz);
      const bearing = normDeg((Math.atan2(dx, dz) * 180) / Math.PI);
      const rel = diffDeg(dyn.heading, bearing); // + = target to starboard

      // Badly hurt: turn away and run while there is a mast to run with.
      const beaten = D.integrity() < 0.45 || D.mastsStanding() < 2 || D.flooding > 0.3;
      this.state = beaten && D.mastsStanding() >= 1 ? "flee" : "engage";

      // Fighting side - not changed every second.
      this.sideTimer -= dt;
      if (this.sideTimer <= 0) {
         this.sideTimer = 12 + this.rng() * 8;
         const p = D.gunFraction("PORT");
         const s = D.gunFraction("STBD");
         this.side = s > p + 0.12 ? 1 : p > s + 0.12 ? -1 : rel >= 0 ? 1 : -1;
      }

      let desired: number;
      if (this.state === "flee") {
         desired = normDeg(ctx.wind.dir + 180);
      } else if (dist > this.engage * 1.35) {
         desired = normDeg(bearing - this.side * 28);
      } else if (dist < this.engage * 0.5) {
         desired = normDeg(bearing + this.side * 125);
      } else {
         desired = normDeg(bearing - this.side * 90);
      }
      desired = sailableHeading(desired, ctx.wind.dir, ship.vessel.sail.noGo);

      const err = diffDeg(dyn.heading, desired);
      dyn.setRudder(clamp(err / 22, -1, 1));

      // A good captain reefs in time rather than losing his topmasts.
      const w = ctx.wind.speedKts;
      let set = 1;
      if (w > 34) set = 0.35;
      else if (w > 28) set = 0.6;
      else if (w > 24) set = 0.8;
      if (this.state === "engage" && dist < this.engage * 0.8) set = Math.min(set, 0.75);
      dyn.sailSet = set;

      // Fire.
      const side: Side = rel >= 0 ? "PORT" : "STBD"; // a positive bearing is to port
      const absRel = Math.abs(rel);
      const inArc = absRel > 32 && absRel < 148;
      if (!inArc || !ship.battery.ready(side)) return;

      const ammo = this.chooseAmmo(dist, target);
      const spec = AMMO[ammo];
      const reach = ship.battery.maxRange * spec.rangeFactor * 1.1;
      if (dist > reach) return;

      ship.battery.setAmmo(ammo);
      if (ship.orderFire(side, this.skill, ctx.ownMatrix, ctx.targets)) this.lastFire = 0;
   }

   private chooseAmmo(dist: number, target: ServerShip): string {
      const enemyMasts = target.dmg.mastsStanding();
      if (this.doctrine === "rig") {
         if (enemyMasts > 1 && dist < 300) return "chain";
         if (dist < 110) return "grape";
         return "ball";
      }
      if (dist < 100) return "grape";
      return "ball";
   }
}
