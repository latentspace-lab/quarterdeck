// course.ts - a windward-leeward regatta course as mathematics.
//
// Start/finish line east-west across the origin, a windward mark 850 m to
// the north (+Z is upwind for the default wind from the north), a leeward
// mark 800 m south. Legs: start line -> windward -> leeward -> finish line.
//
// The client draws the buoys and the server judges the race with the same
// geometry and the same tracker. Everything is driven by simulation time
// `t`, never the wall clock: the server's laps must be reproducible and the
// client's must agree with them.

import { normDeg, type Vec2 } from "./utils.ts";

export interface Mark extends Vec2 {
   /** rounding radius (m) */
   radius: number;
}

export type LegType = "start" | "turn" | "finish";

export interface Leg {
   type: LegType;
   name: string;
   /** the mark for a turn leg */
   ref?: Mark;
}

export interface CourseLayout {
   origin: Vec2;
   committee: Vec2;
   pin: Vec2;
   /** the line's z; it is crossed northwards */
   lineZ: number;
   halfWidth: number;
   windward: Mark;
   leeward: Mark;
   legs: Leg[];
}

export function courseLayout(origin: Vec2 = { x: 0, z: 0 }): CourseLayout {
   const windward: Mark = { x: origin.x, z: origin.z + 850, radius: 18 };
   const leeward: Mark = { x: origin.x + 30, z: origin.z - 800, radius: 18 };
   return {
      origin: { x: origin.x, z: origin.z },
      committee: { x: origin.x + 45, z: origin.z },
      pin: { x: origin.x - 45, z: origin.z },
      lineZ: origin.z,
      halfWidth: 45,
      windward,
      leeward,
      legs: [
         { type: "start", name: "Start line" },
         { type: "turn", ref: windward, name: "Windward mark" },
         { type: "turn", ref: leeward, name: "Leeward mark" },
         { type: "finish", name: "Finish line" },
      ],
   };
}

/** Where a boat is in its race. */
export interface RaceProgress {
   leg: number;
   lap: number;
   /** simulation time the current lap started */
   lapStart: number;
   best: number | null;
   /** duration of the last completed lap */
   lastLap: number;
   /** 0..1 along the lap */
   progress: number;
   /** boat z at the previous step - for the line crossing */
   prevZ: number;
}

/**
 * A fresh race for a boat at `pos` (default: on the line, i.e. a boat that
 * starts south of it approaches normally; pass the real position for a boat
 * that may start north of the line).
 */
export function newRace(layout: CourseLayout, t: number, pos: Vec2 = layout.origin): RaceProgress {
   return { leg: 0, lap: 0, lapStart: t, best: null, lastLap: 0, progress: 0, prevZ: pos.z };
}

export interface Target extends Vec2 {
   radius: number;
}

export interface RaceStep {
   advanced: boolean;
   /** a mark was passed or a lap completed */
   passed: LegType | null;
   lapDone: boolean;
   lapTime: number;
   message: string;
   next: Target;
   dist: number;
   bearing: number;
   leg: number;
   legType: LegType;
   legName: string;
   /** seconds into the current lap */
   time: number;
}

function lineTarget(layout: CourseLayout): Target {
   return { x: layout.origin.x, z: layout.lineZ, radius: 0 };
}

function targetFor(layout: CourseLayout, leg: Leg): Target {
   return leg.ref ? { x: leg.ref.x, z: leg.ref.z, radius: leg.ref.radius } : lineTarget(layout);
}

/** Crossed the line northwards this step, within its width (plus a little slack). */
export function crossedLineNorth(layout: CourseLayout, prevZ: number, pos: Vec2): boolean {
   return pos.z > layout.lineZ && prevZ <= layout.lineZ && Math.abs(pos.x - layout.origin.x) <= layout.halfWidth + 6;
}

/**
 * One step of the race for one boat. Mutates `r`, returns what happened and
 * what to show. Call once per simulation step with the boat's position.
 */
export function raceStep(layout: CourseLayout, r: RaceProgress, pos: Vec2, t: number): RaceStep {
   const legs = layout.legs;
   const leg = legs[r.leg];
   let advanced = false;
   let passed: LegType | null = null;
   let lapDone = false;
   let lapTime = 0;
   let message = "";

   if (leg.type === "start") {
      if (crossedLineNorth(layout, r.prevZ, pos)) {
         r.leg = 1;
         r.lapStart = t;
         message = "Away - lap " + (r.lap + 1) + " started!";
         advanced = true;
         passed = "start";
      }
   } else if (leg.type === "finish") {
      if (crossedLineNorth(layout, r.prevZ, pos)) {
         lapTime = t - r.lapStart;
         r.lastLap = lapTime;
         r.lap++;
         r.best = r.best === null ? lapTime : Math.min(r.best, lapTime);
         r.lapStart = t;
         r.leg = 0;
         message = "Lap " + r.lap + " in " + lapTime.toFixed(1) + " s";
         advanced = true;
         lapDone = true;
         passed = "finish";
      }
   } else if (leg.ref) {
      if (Math.hypot(leg.ref.x - pos.x, leg.ref.z - pos.z) < leg.ref.radius) {
         message = leg.name + " rounded!";
         r.leg = (r.leg + 1) % legs.length;
         advanced = true;
         passed = "turn";
      }
   }

   r.prevZ = pos.z;
   r.progress = lapDone ? 0 : Math.max(advanced ? 0 : r.progress, r.leg / legs.length);

   const cur = legs[r.leg];
   const next = targetFor(layout, cur);
   const dx = next.x - pos.x;
   const dz = next.z - pos.z;
   return {
      advanced,
      passed,
      lapDone,
      lapTime,
      message,
      next,
      dist: Math.hypot(dx, dz),
      bearing: normDeg((Math.atan2(dx, dz) * 180) / Math.PI),
      leg: r.leg,
      legType: cur.type,
      legName: cur.name,
      time: t - r.lapStart,
   };
}
