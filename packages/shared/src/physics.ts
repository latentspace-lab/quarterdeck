// physics.ts - semi-realistic sailing physics (pure functions + state class)
//
// Basic idea (classic "point-and-go" model):
//    - The player steers the heading (rudder).
//    - The point of sail (TWA = True Wind Angle) follows from the boat's
//      heading and the wind direction.
//    - Boat and sail speed follow a polar curve as a function of TWA, wind
//      strength (knots), sail trim, and heel.
//    - VMG (Velocity Made Good) shows how good the progress toward the wind is.
//
// Units: angles in degrees, speed in knots. World: X=East, Z=North, Y=up.
//
// Multiplayer note: step() is called exclusively with a FIXED dt (SIM_DT,
// see timestep.ts). All smoothing runs through approach() and depends only
// on dt - not on the number of calls. Only that way does a resimulation on
// the server produce the same track as the client's prediction.

import {
   DEG,
   RAD,
   clamp,
   lerp,
   approach,
   diffDeg,
   normDeg,
   dirVec,
   interpTable,
   type Table,
   type Vec2,
} from "./utils.ts";
import type { Vessel, DynSpec, Rig } from "./vessels.ts";

// ---- Constants -------------------------------------------------------------
export const NO_GO_DEG = 32; // No-go zone: you cannot sail closer than 32° TWA

/**
 * Time constants of the input smoothing. They used to be scattered across
 * `Controls.read()` (lerp with dt*8) and `BoatDynamics.setRudder()` (lerp
 * with a fixed 0.3 per call). The second term depended purely on the call
 * rate, which is exactly the kind of nondeterminism that makes client
 * prediction unusable. Now there is exactly ONE smoother, here, inside step().
 */
export const RUDDER_TAU = 0.18; // s - the helmsman putting the wheel over
export const HEEL_TAU = 0.667;  // s - equivalent to the old dt*1.5
export const LEEWAY_TAU = 0.833; // s - equivalent to the old dt*1.2

// Polar curve at 15 knots of wind (speed in knots, TWA in degrees).
export const POLAR_15KTS: Table = [
   [0, 0.0], [10, 0.0], [20, 0.6], [30, 2.5], [35, 4.8], [40, 6.2], [45, 7.2],
   [50, 8.0], [60, 9.4], [75, 10.4], [90, 10.8], [105, 11.2], [115, 11.0],
   [130, 10.2], [145, 8.8], [160, 6.9], [175, 5.2], [180, 4.4],
];

export type Tack = "PORT" | "STBD";

/** Wind state, as the sailing dynamics needs it. */
export interface WindSample {
   /** Direction the wind blows from (degrees) */
   dir: number;
   speedKts: number;
}

// Wind drive scale: sublinear below 15 kn, growing moderately above it.
export function windScale(W: number): number {
   if (W <= 15) return Math.pow(clamp(W / 15, 0.05, 1), 0.6);
   return clamp(1 + (W - 15) * 0.028, 1, 2.45);
}

// ---- Polar lookup ------------------------------------------------------------
export function polarSpeedAt(
   twaDeg: number,
   windKts: number,
   trimEff = 1,
   heelPen = 1,
   polar: Table = POLAR_15KTS,
): number {
   const t = Math.abs(normDeg(twaDeg));
   const ref = interpTable(t, polar);
   return clamp(ref * windScale(windKts) * trimEff * heelPen, 0, 42);
}

// Optimal sail trim 0 (eased) .. 1 (sheeted in)
export function optimalTrim(twaDeg: number, noGo = NO_GO_DEG): number {
   return clamp(
      lerp(1.0, 0.0, (Math.abs(normDeg(twaDeg)) - noGo + 2) / (180 - noGo + 2)),
      0.05,
      1,
   );
}
export function trimEfficiency(actualTrim: number, optTrim: number): number {
   return clamp(1 - Math.abs(actualTrim - optTrim) * 0.7, 0.45, 1);
}

// ---- Apparent Wind ----------------------------------------------------------
export interface ApparentWind {
   speed: number;
   /** Direction the apparent wind comes from (degrees) */
   from: number;
}

export function apparentWind(
   trueWindDeg: number,
   trueWindKts: number,
   boatHeading: number,
   boatSpeedKts: number,
): ApparentWind {
   const wFrom = dirVec(trueWindDeg);
   const windToward = { x: -wFrom.x * trueWindKts, z: -wFrom.z * trueWindKts };
   const bF = dirVec(boatHeading);
   const boatVel = { x: bF.x * boatSpeedKts, z: bF.z * boatSpeedKts };
   const rel = { x: windToward.x - boatVel.x, z: windToward.z - boatVel.z };
   const speed = Math.hypot(rel.x, rel.z);
   // "from" direction = the reverse of the airflow (where the wind comes from)
   const fromVec = { x: boatVel.x - windToward.x, z: boatVel.z - windToward.z };
   const from = normDeg(Math.atan2(fromVec.x, fromVec.z) * RAD);
   return { speed, from };
}

// TWA signed: >0 wind from port (the +x side of the ship frame), <0 from starboard
export function twa(boatHeading: number, trueWindDeg: number): number {
   return diffDeg(boatHeading, trueWindDeg); // diffDeg(a,b) = b - a
}
export function tackFromTwa(twaSigned: number): Tack {
   // Wind over the port side = port tack.
   return twaSigned > 0 ? "PORT" : "STBD";
}

// ---- Points of sail -----------------------------------------------------
export function pointOfSail(
   twaDeg: number,
   luffing = false,
   rig: Rig | string = "bermuda",
   noGo = NO_GO_DEG,
): string {
   const t = Math.abs(twaDeg);
   if (rig === "square") {
      if (luffing || t < noGo) return "In Irons / Aback (No Drive)";
      if (t < noGo + 14) return "Close-Hauled";
      if (t < 100) return "Soldier's Wind (Beam Reach)";
      if (t < 140) return "Broad Reach";
      if (t < 168) return "Running";
      return "Dead Before the Wind";
   }
   if (luffing || t < noGo) return "No-Go Zone";
   if (t < 55) return "Close-Hauled";
   if (t < 85) return "Close Reach";
   if (t < 110) return "Beam Reach";
   if (t < 150) return "Broad Reach";
   if (t < 172) return "Running";
   return "Dead Run";
}

// Luffing: wind in the no-go zone, or too little wind -> no drive
export function isLuffing(twaDeg: number, windKts = -1, noGo = NO_GO_DEG): boolean {
   if (windKts >= 0 && windKts < 0.4) return true;
   return Math.abs(twaDeg) < noGo;
}

// VMG toward up-/downwind
export function vmgUp(twaDeg: number, speedKts: number): number {
   const t = Math.abs(twaDeg);
   return t < 90 ? speedKts * Math.cos(t * DEG) : 0;
}
export function vmgDown(twaDeg: number, speedKts: number): number {
   const t = Math.abs(twaDeg);
   return t > 91 ? speedKts * Math.abs(Math.cos(t * DEG)) : 0;
}

// Heel
const HEEL_TABLE: Table = [
   [0, 0.15], [20, 0.2], [35, 0.7], [45, 1.0], [55, 0.95],
   [70, 0.75], [90, 0.55], [130, 0.4], [160, 0.25], [180, 0.12],
];
export function heelTarget(twaDeg: number, windKts: number, maxHeel = 24, scale = 1): number {
   const f = interpTable(Math.abs(normDeg(twaDeg)), HEEL_TABLE);
   const w = clamp((windKts - 5) / 25, 0, 1.4);
   return clamp(f * (0.35 + w) * maxHeel * scale, 0, 55);
}
export function heelPenalty(heelDeg: number, capsizeHeel = 32): number {
   if (heelDeg < 12) return 1;
   return clamp(1 - 0.6 * ((heelDeg - 12) / (capsizeHeel - 12)), 0.2, 1);
}

// ---- Rudder / course dynamics ------------------------------------------------
export function rudderAuthority(speedKts: number, refKts = 4): number {
   return clamp(speedKts / refKts, 0.12, 1);
}

/** Complete dynamics profile - DEFAULT_PROFILE plus vessel overrides. */
export interface DynProfile extends Required<DynSpec> {
   rig: Rig | string;
   noGo: number;
   polar: Table;
   tackAssist: number;
}

// Default profile (modern yacht) - overridden by a vessel entry.
export const DEFAULT_PROFILE: DynProfile = {
   rig: "bermuda",
   noGo: NO_GO_DEG,
   polar: POLAR_15KTS,
   turnRate: 38,
   rudderRef: 4,
   accelUp: 0.45,
   accelDown: 1.1,
   accelLuff: 1.6,
   maxHeel: 24,
   capsizeHeel: 32,
   heelScale: 1,
   leewayMax: 7,
   tackAssist: 0,
};

// Build a dynamics profile from a vessel entry (vessels.ts).
export function profileFromVessel(v: Vessel | null | undefined): DynProfile {
   if (!v) return { ...DEFAULT_PROFILE };
   return {
      ...DEFAULT_PROFILE,
      rig: v.rig || DEFAULT_PROFILE.rig,
      noGo: v.sail?.noGo ?? DEFAULT_PROFILE.noGo,
      polar: v.sail?.polar ?? DEFAULT_PROFILE.polar,
      tackAssist: v.sail?.tackAssist ?? 0,
      ...(v.dyn || {}),
   };
}

export interface BoatDynamicsOptions {
   vessel?: Vessel | null;
   profile?: Partial<DynProfile>;
   heading?: number;
   x?: number;
   z?: number;
   trim?: number;
   maxHeel?: number;
   capsizeHeel?: number;
   autoTrim?: boolean;
}

export class BoatDynamics {
   profile: DynProfile;
   vessel: Vessel | null;
   heading: number;
   speed = 0;
   heel = 0;
   heelLerp = 0;
   /** Actual rudder angle (smoothed) */
   rudder = 0;
   /** Rudder angle requested by the player/AI - the smoother's target */
   rudderCmd = 0;
   trim: number;
   twa = 0;
   twaSigned = 0;
   tack: Tack = "PORT";
   pos: Vec2;
   boatVel: Vec2 = { x: 0, z: 0 };
   isCapsized = false;
   capsizeTimer = 0;
   luffing = false;
   leeway = 0;
   groundHeading: number;
   optTrim = 0.5;
   heelMaxSeen = 0;
   // Sail area 0.25..1 (reefing). Only effective on square-riggers - a yacht
   // trims instead of reefing.
   sailSet = 1;
   // Factors set from outside by the damage model (1 = undamaged):
   //   driveMul  - remaining sail power (masts, canvas, rigging)
   //   rudderMul - rudder effectiveness
   //   dragMul   - extra drag (water in the ship, wreck under tow)
   //   turnBias  - a persistent yaw, e.g. from a wreck on one side
   //   heelBias  - list caused by flooding (degrees)
   driveMul = 1;
   rudderMul = 1;
   dragMul = 1;
   turnBias = 0;
   heelBias = 0;
   stopped = false; // aground / unable to manoeuvre
   config: { maxHeel: number; capsizeHeel: number; autoTrim: boolean };

   constructor(opts: BoatDynamicsOptions = {}) {
      this.profile = opts.vessel
         ? profileFromVessel(opts.vessel)
         : { ...DEFAULT_PROFILE, ...(opts.profile || {}) };
      this.vessel = opts.vessel || null;
      this.heading = opts.heading ?? 0;
      this.trim = opts.trim ?? 0.5;
      this.pos = { x: opts.x ?? 0, z: opts.z ?? 0 };
      this.groundHeading = this.heading;
      this.config = {
         maxHeel: opts.maxHeel ?? this.profile.maxHeel,
         capsizeHeel: opts.capsizeHeel ?? this.profile.capsizeHeel,
         autoTrim: opts.autoTrim ?? true,
      };
   }

   // Change vessel while running
   setVessel(v: Vessel): this {
      this.vessel = v;
      this.profile = profileFromVessel(v);
      this.config.maxHeel = this.profile.maxHeel;
      this.config.capsizeHeel = this.profile.capsizeHeel;
      this.speed = 0;
      this.heel = 0;
      this.heelLerp = 0;
      this.leeway = 0;
      this.isCapsized = false;
      return this;
   }

   get noGo(): number {
      return this.profile.noGo;
   }
   get rig(): Rig | string {
      return this.profile.rig;
   }

   step(dt: number, wind: WindSample, manualTrim: number | null = null): boolean {
      if (this.isCapsized) return this._capsizeStep(dt);
      if (dt <= 0) return true;

      // 0. Rudder: ONE dt-invariant smoother for the whole chain
      //    input -> rudder angle. An identical command sequence with an
      //    identical dt therefore produces the same rudder track on client
      //    and server.
      this.rudder = approach(this.rudder, clamp(this.rudderCmd, -1, 1), dt, RUDDER_TAU);

      // 1. TWA
      this.twaSigned = twa(this.heading, wind.dir);
      this.twa = Math.abs(this.twaSigned);
      this.tack = tackFromTwa(this.twaSigned);

      const P = this.profile;

      // 2. Trim
      this.optTrim = optimalTrim(this.twa, P.noGo);
      const useTrim = this.config.autoTrim
         ? this.optTrim
         : clamp(manualTrim ?? this.trim, 0, 1);
      const trimEff = trimEfficiency(useTrim, this.optTrim);

      // 3. Yaw
      // Set sail area (reefing) - less canvas, less speed and heel
      const setF = P.rig === "square" ? clamp(this.sailSet, 0.25, 1) : 1;

      const targetHeel =
         heelTarget(this.twa, wind.speedKts, this.config.maxHeel, P.heelScale) *
         (0.45 + 0.55 * setF);
      this.heelLerp = approach(this.heelLerp, targetHeel, dt, HEEL_TAU);
      this.heel = this.heelLerp + this.heelBias;
      this.heelMaxSeen = Math.max(this.heelMaxSeen, this.heel);
      if (this.heel > this.config.capsizeHeel) {
         this.capsizeTimer += dt;
         if (this.capsizeTimer > 0.7) {
            this._capsize();
            return false;
         }
      } else {
         this.capsizeTimer = 0;
      }

      // 4. Luffing check
      this.luffing = isLuffing(this.twa, wind.speedKts, P.noGo);
      const hp = heelPenalty(this.heel, this.config.capsizeHeel);

      // 5. Target boat speed
      let targetSpeed = this.luffing
         ? 0
         : polarSpeedAt(this.twa, wind.speedKts, trimEff, hp, P.polar) * (0.3 + 0.7 * setF);
      // Damage: less sail power, more drag
      targetSpeed *= clamp(this.driveMul, 0, 1) / Math.max(this.dragMul, 0.2);
      if (this.stopped) targetSpeed = 0;
      // A square-rigger keeps some way on while passing through the eye of
      // the wind ("way in the ship") - otherwise it would never complete a tack.
      if (this.luffing && P.tackAssist > 0) {
         targetSpeed = this.speed * P.tackAssist;
      }
      const accel = this.luffing
         ? P.accelLuff
         : targetSpeed > this.speed
           ? P.accelUp
           : P.accelDown;
      this.speed += (targetSpeed - this.speed) * clamp(accel * dt, 0, 1);
      this.speed = Math.max(0, this.speed);

      // 6. Rudder -> yaw
      const rauth = rudderAuthority(this.speed, P.rudderRef);
      const turnRate =
         this.rudder * P.turnRate * rauth * clamp(this.rudderMul, 0, 1) +
         this.turnBias * rauth; // deg/s
      this.heading = normDeg(this.heading - turnRate * dt);

      // 7. Leeway + course over ground
      const leeFrac = clamp(this.heel / this.config.capsizeHeel, 0, 1);
      const windFrac = clamp(15 / Math.max(wind.speedKts, 0.5), 0.4, 1);
      const updown = this.twa < 90 ? 1 : 0.45;
      const targetLeeway = P.leewayMax * leeFrac * windFrac * updown;
      this.leeway = approach(this.leeway, targetLeeway, dt, LEEWAY_TAU);
      const leeSign = this.twaSigned > 0 ? -1 : 1;
      this.groundHeading = normDeg(this.heading + this.leeway * leeSign);

      const gv = dirVec(this.groundHeading);
      this.boatVel = {
         x: gv.x * this.speed * 0.514444,
         z: gv.z * this.speed * 0.514444,
      };
      this.pos.x += this.boatVel.x * dt;
      this.pos.z += this.boatVel.z * dt;

      return true;
   }

   /**
    * Set a rudder command. No longer smooths on its own - that happens
    * dt-invariantly in step(). Anyone who needs a command without lag
    * (reset, taking over state from the server) uses snapRudder().
    */
   setRudder(v: number): void {
      this.rudderCmd = clamp(v, -1, 1);
   }
   snapRudder(v: number): void {
      this.rudderCmd = clamp(v, -1, 1);
      this.rudder = this.rudderCmd;
   }
   reset(): void {
      this.rudder = 0;
      this.rudderCmd = 0;
   }
   appWind(wind: WindSample): ApparentWind {
      return apparentWind(wind.dir, wind.speedKts, this.heading, this.speed);
   }
   vmgToward(targetHeading: number): number {
      const gv = dirVec(this.groundHeading);
      const tv = dirVec(targetHeading);
      return this.speed * clamp(gv.x * tv.x + gv.z * tv.z, -1, 1);
   }

   private _capsize(): void {
      this.isCapsized = true;
      this.capsizeTimer = 0;
      this.speed = 0;
      this.heel = 0;
   }
   private _capsizeStep(dt: number): boolean {
      this.heel = approach(this.heel, 180, dt, 1 / 3);
      this.speed = 0;
      this.capsizeTimer += dt;
      if (this.capsizeTimer > 3) this.rightBoat();
      return false;
   }
   rightBoat(): void {
      this.isCapsized = false;
      this.capsizeTimer = 0;
      this.speed = 0;
      this.heel = 0;
      this.heelLerp = 0;
   }
}
