// pose.ts - how a hull sits on the wave.
//
// Pure mathematics on top of seaHeight(): from position, heading, heel and
// flooding come draft, roll angle and pitch angle. The client applies the
// result to its Three.js model; the server builds the matrix for hit testing
// from it.
//
// Why this MUST be shared: ballistics decides, from the hull's pose, whether
// a shot strikes below the waterline, into the side, or into the rig. If the
// client computed a different pose than the server, the same shot would get
// two different results.

import { clamp, dirVec, DEG } from "./utils.ts";
import type { SeaHeightFn } from "./ocean-math.ts";
import type { Vec2 } from "./utils.ts";

/** Hull dimensions, as far as the pose needs them. */
export interface PoseHull {
   loa: number;
   beam: number;
   draft: number;
}

/**
 * Freeboard to the top of the bulwark, measured amidships (m).
 *
 * A square-rigger of the period carried its gun deck a good two metres above
 * the water and the bulwark as high again - otherwise the sea would stand in
 * the battery in any seaway. The client's warship builder and the server's
 * swamp check must agree on this number, so it lives here.
 */
export function freeboardOf(hull: PoseHull): number {
   return hull.draft * 0.8 + hull.beam * 0.11;
}

export interface PoseInput {
   pos: Vec2;
   /** Heading (degrees) */
   heading: number;
   /** Heel (degrees, unsigned) */
   heel: number;
   /** Signed TWA - determines which side she heels to */
   twaSigned: number;
   /** Water in the ship, 0..1 */
   flooding: number;
   /** Roll kick from recoil (degrees) */
   recoilRoll: number;
   hull: PoseHull;
}

export interface Pose {
   /** Height of the hull's centre point (m) */
   y: number;
   /** Roll angle about the longitudinal axis (rad) */
   rollZ: number;
   /** Pitch angle about the transverse axis (rad) */
   pitchX: number;
   /** Yaw angle (rad) - heading in Three.js convention */
   yawY: number;
   /** Height of the mean water surface under the ship (m) */
   seaY: number;
   /** Water surface at the lower (leeward) side (m) */
   leeY: number;
   /** How deep the flooding pushes her down (m) */
   sinkIn: number;
}

/**
 * Pose of a hull on the sea.
 *
 * A ship floats on the surface her hull displaces, not on the value under
 * the mainmast: hence the average over bow, stern and both sides. Without
 * this averaging, the hull would sit underwater on every wave crest - the
 * sea would then stand on the gun deck.
 */
export function shipPose(input: PoseInput, sea: SeaHeightFn): Pose {
   const { pos: p, heading, heel, twaSigned, flooding, recoilRoll, hull } = input;

   const heelSide = twaSigned > 0 ? 1 : -1;
   const halfBeam = hull.beam / 2;
   const probe = hull.loa * 0.36;
   const massDamp = clamp(11 / hull.loa, 0.32, 1);

   const port = dirVec(heading - 90);
   const stbd = dirVec(heading + 90);
   const ahead = dirVec(heading);

   const hP = sea(p.x + port.x * halfBeam, p.z + port.z * halfBeam);
   const hS = sea(p.x + stbd.x * halfBeam, p.z + stbd.z * halfBeam);
   const waveRoll = (hS - hP) * 0.18 * massDamp;

   const hF = sea(p.x + ahead.x * probe, p.z + ahead.z * probe);
   const hR = sea(p.x - ahead.x * probe, p.z - ahead.z * probe);
   const hy = (sea(p.x, p.z) * 2 + hP + hS + hF + hR) / 6;

   // Water in the ship pushes her deeper
   const sinkIn = flooding * hull.draft * 0.55;

   const rollZ = heelSide * heel * DEG + waveRoll + recoilRoll * DEG;
   const pitchX = clamp(
      (-(hF - hR) * 1.4 * massDamp) / Math.max(probe / 4, 1),
      -0.18,
      0.18,
   );

   return {
      y: hy - sinkIn,
      rollZ,
      pitchX,
      yawY: heading * DEG,
      seaY: hy,
      leeY: Math.min(hP, hS),
      sinkIn,
   };
}

/**
 * Freeboard of the lee rail above the local water surface.
 * Negative = the sea is breaking over the deck.
 *
 * The lee rail is the lowest point of the deck. When it dips below the
 * local water surface, the sea pours into the battery: the ship takes
 * water, and people on deck go overboard. That is exactly why ships reefed
 * down and closed the lower gun ports in a stiff breeze.
 */
export function railClearance(
   freeboard: number,
   rollRad: number,
   halfBeam: number,
   sinkIn: number,
   seaY: number,
   leeY: number,
): number {
   const roll = Math.abs(rollRad);
   // The rail tips to leeward: its height drops by sin(heel) * half beam
   const rail = freeboard * Math.cos(roll) - halfBeam * Math.sin(roll) - sinkIn;
   return rail - (leeY - seaY);
}

/**
 * Interpolate between two poses - for rendering between two simulation
 * steps. Angles are blended along the shortest path, so the heading does not
 * swing all the way around on the 359 -> 1 wraparound.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
   return {
      y: a.y + (b.y - a.y) * t,
      rollZ: a.rollZ + (b.rollZ - a.rollZ) * t,
      pitchX: a.pitchX + (b.pitchX - a.pitchX) * t,
      yawY: a.yawY + shortestAngle(a.yawY, b.yawY) * t,
      seaY: a.seaY + (b.seaY - a.seaY) * t,
      leeY: a.leeY + (b.leeY - a.leeY) * t,
      sinkIn: a.sinkIn + (b.sinkIn - a.sinkIn) * t,
   };
}

/** Shortest path from a to b in radians, in [-PI, PI]. */
export function shortestAngle(a: number, b: number): number {
   const TAU = Math.PI * 2;
   let d = (b - a) % TAU;
   if (d > Math.PI) d -= TAU;
   if (d < -Math.PI) d += TAU;
   return d;
}

/** Linear interpolation of two positions. */
export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
   return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
