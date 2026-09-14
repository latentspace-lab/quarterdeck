// ballistics.ts - Trajectory, spread and hit testing.
//
// The most involved cut of Phase 0: in guns.js, ballistics, hit testing,
// reload timers and smoke clouds all lived in a single class. What remains
// here is just the mathematics - it runs in the browser the same as on the
// server. Everything visible (muzzle flash, smoke, splashes, projectile
// meshes) stays in the client.
//
// Why Three.js vectors: Matrix4 and Vector3 from `three/src/math/...` are
// pure JavaScript with no DOM or WebGL dependency. A second vector type
// (gl-matrix) would only have introduced translation errors between client
// and server - `_battle.mjs` has run these classes headless all along.
//
// Why the server rolls the salvo: a broadside is fully described by
// `spawnSalvo()`. The server sends a seed and a timestamp, and every client
// recomputes the same trajectories and sees the same impacts - without a
// single projectile ever being transmitted.

import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { clamp, DEG } from "./utils.ts";
import { gauss, type Rng } from "./rng.ts";
import { AMMO, type AmmoSpec, type Side } from "./damage.ts";

export { gauss };

const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// Range for a given elevation (gravity + drag, the same integration as in
// flight), and the inverse of that.
//
// This is the real reason so little hit at distance: the range had to be
// ESTIMATED, and a 15% estimation error at 500 m sends a broadside well over
// or well short of the enemy.
// ---------------------------------------------------------------------------
export function rangeForElevation(elevDeg: number, v0: number, drag: number, y0 = 2.5): number {
   const e = (elevDeg * Math.PI) / 180;
   let x = 0;
   let y = y0;
   let vx = v0 * Math.cos(e);
   let vy = v0 * Math.sin(e);
   let t = 0;
   const dt = 0.02;
   while (y > 0 && t < 40) {
      vy -= GRAVITY * dt;
      const f = 1 / (1 + drag * dt);
      vx *= f;
      vy *= f;
      x += vx * dt;
      y += vy * dt;
      t += dt;
   }
   return x;
}

/** Elevation that produces a desired range (bisection) */
export function elevationForRange(R: number, v0: number, drag: number, y0 = 2.5): number {
   let lo = -1;
   let hi = 22;
   for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (rangeForElevation(mid, v0, drag, y0) < R) lo = mid;
      else hi = mid;
   }
   return (lo + hi) / 2;
}

/** Anything with .x/.y/.z - a Vector3 or a plain object. */
export interface XYZ {
   x: number;
   y: number;
   z: number;
}

/**
 * Segment p0->p1 against an axis-aligned box. Returns the parameter t of the
 * entry point (0..1) or null. Slab method.
 */
export function segmentBox(
   p0: XYZ,
   p1: XYZ,
   x0: number,
   x1: number,
   y0: number,
   y1: number,
   z0: number,
   z1: number,
): number | null {
   let tmin = 0;
   let tmax = 1;
   const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
   const o = [p0.x, p0.y, p0.z];
   const lo = [x0, y0, z0];
   const hi = [x1, y1, z1];
   for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
         if (o[i] < lo[i] || o[i] > hi[i]) return null;
         continue;
      }
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) {
         const tt = t1;
         t1 = t2;
         t2 = tt;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
   }
   // The intersection must lie WITHIN the segment - otherwise a box far
   // ahead on the line would also report a hit.
   if (tmin > 1 || tmax < 0) return null;
   return Math.max(tmin, 0);
}

// ---------------------------------------------------------------------------
// Salvo
// ---------------------------------------------------------------------------

/** Hit box of a target, in ship coordinates. */
export interface TargetBox {
   id: string;
   /** World matrix of the heeled hull (built from shipPose) */
   matrixWorld: Matrix4;
   LOA: number;
   BEAM: number;
   DRAFT: number;
   /** Freeboard (m) */
   FB: number;
   /** Top of the rig above the waterline (m); 0 = no rig left */
   rigTop?: number;
   rigHalfWidth?: number;
}

/** A single shot in flight. */
export interface Projectile {
   origin: XYZ;
   /** Position at the start of the step */
   prev: XYZ;
   /** Current position */
   pos: XYZ;
   vel: XYZ;
   ammo: string;
   /** Ball weight (English pounds) */
   lb: number;
   drag: number;
   /** rolled once per target: does the projectile catch in the rigging? */
   rigRolled?: Record<string, boolean>;
}

export interface SalvoShot {
   side: Side;
   /** Index of the port on this side */
   idx: number;
   ammo: string;
   /** Shared elevation aiming error of the salvo (degrees) */
   aimElev: number;
   /** Shared training (traverse) error of the salvo (rad) */
   aimTrain: number;
   /** Delay before firing (s) - the broadside rolls along the side */
   at: number;
}

export interface SalvoOptions {
   side: Side;
   ammo: string;
   /** Number of ports on this side */
   muzzleCount: number;
   /** Number of guns still being served */
   readyCount: number;
   /** Time offset between the individual shots (s) */
   spread: number;
   /** Training level of the crews (0.3 .. 1.6) */
   gunnery: number;
   /** Estimated range to the target (m); 0 = nothing in the firing arc */
   rangeToTarget: number;
   /** Effective range of the battery (m) */
   maxRange: number;
   /** Height of the ports above the water (m) */
   muzzleHeight?: number;
}

/**
 * Roll a broadside.
 *
 * The crews estimate the range and lay the guns accordingly. The estimation
 * error grows with range - which is why the hit rate collapses at long
 * distance. The next biggest source of spread is the roll at the instant of
 * firing: one degree of roll is already a ship's length off at 400 m. That's
 * why gunners fired "on the roll".
 *
 * All the randomness lives here - so a salvo is fully described by (seed,
 * options) and can be replayed elsewhere.
 */
export function spawnSalvo(opts: SalvoOptions, rng: Rng): SalvoShot[] {
   const a0 = AMMO[opts.ammo] || AMMO.ball;
   const gunnery = clamp(opts.gunnery, 0.3, 1.6);
   const y0 = opts.muzzleHeight ?? 2.5;

   let layElev: number;
   if (opts.rangeToTarget > 0) {
      const relErr =
         (0.05 + 0.22 * clamp(opts.rangeToTarget / opts.maxRange, 0, 1.6)) / gunnery;
      const Rest = clamp(opts.rangeToTarget * (1 + gauss(rng) * relErr), 25, 2400);
      layElev = elevationForRange(Rest, a0.v0 || 330, a0.drag ?? 0.22, y0);
   } else {
      layElev = elevationForRange(opts.maxRange * 0.55, a0.v0 || 330, a0.drag ?? 0.22, y0);
   }
   const aimElev = layElev - a0.elevation + (gauss(rng) * 0.95) / gunnery;
   const aimTrain = (gauss(rng) * 0.01) / gunnery; // radians

   const shots: SalvoShot[] = [];
   const n = Math.max(0, Math.floor(opts.readyCount));
   if (n <= 0 || opts.muzzleCount <= 0) return shots;

   // Spread disabled guns evenly across the side
   const stepSize = opts.muzzleCount / n;
   for (let k = 0; k < n; k++) {
      const i = Math.min(opts.muzzleCount - 1, Math.floor(k * stepSize));
      const t = n === 1 ? 0 : k / (n - 1);
      shots.push({
         side: opts.side,
         idx: i,
         ammo: opts.ammo,
         aimElev,
         aimTrain,
         at: t * opts.spread + rng() * 0.035,
      });
   }
   return shots;
}

export interface DischargeOptions {
   /** Muzzle in world coordinates */
   origin: XYZ;
   /** Horizontal broadside normal (normalised) */
   flat: XYZ;
   ammo: string;
   aimElev: number;
   aimTrain: number;
   lb: number;
}

const _up = new Vector3(0, 1, 0);

/**
 * Turn one aimed gun into its individual projectiles.
 *
 * Round shot: a single ball, flat trajectory and long range.
 * Chain shot: a tumbling pair, aimed high, short range.
 * Grape shot: a swarm of small balls, wide cone, very short effective range.
 *
 * The base direction is the HORIZONTAL projection of the broadside normal:
 * guns fired "on the roll" when the barrel passed through the horizontal.
 * Heel remains only as a residual error (aimElev).
 */
export function dischargeShots(opts: DischargeOptions, rng: Rng): Projectile[] {
   const a = AMMO[opts.ammo] || AMMO.ball;
   const flat = new Vector3(opts.flat.x, 0, opts.flat.z);
   if (flat.lengthSq() < 1e-6) flat.set(opts.flat.x || 1, 0, opts.flat.z);
   flat.normalize();
   const sideways = new Vector3().crossVectors(flat, _up).normalize();

   const out: Projectile[] = [];
   for (let k = 0; k < a.pellets; k++) {
      const dir = flat.clone();
      // Per-gun spread plus the salvo's shared aiming error: this is why an
      // entire broadside can sometimes go high together.
      const sp = a.spreadDeg * DEG;
      dir.addScaledVector(sideways, (rng() - 0.5) * 2 * sp + opts.aimTrain);
      dir.addScaledVector(
         _up,
         Math.sin((a.elevation + opts.aimElev + (rng() - 0.5) * a.spreadDeg) * DEG),
      );
      dir.normalize();

      const v0 = (a.v0 || 330) * (0.95 + rng() * 0.1);
      out.push({
         origin: { x: opts.origin.x, y: opts.origin.y, z: opts.origin.z },
         prev: { x: opts.origin.x, y: opts.origin.y, z: opts.origin.z },
         pos: { x: opts.origin.x, y: opts.origin.y, z: opts.origin.z },
         vel: { x: dir.x * v0, y: dir.y * v0, z: dir.z * v0 },
         ammo: a.id,
         lb: opts.lb,
         drag: a.drag ?? 0.22,
      });
   }
   return out;
}

/**
 * Advance a projectile by one fixed step: gravity and drag, exactly as in
 * rangeForElevation().
 */
export function stepProjectile(b: Projectile, dt: number): void {
   b.prev.x = b.pos.x;
   b.prev.y = b.pos.y;
   b.prev.z = b.pos.z;
   b.vel.y -= GRAVITY * dt;
   const f = 1 / (1 + b.drag * dt);
   b.vel.x *= f;
   b.vel.y *= f;
   b.vel.z *= f;
   b.pos.x += b.vel.x * dt;
   b.pos.y += b.vel.y * dt;
   b.pos.z += b.vel.z * dt;
}

export interface ProjectileHit {
   target: TargetBox;
   side: Side;
   /** Longitudinal position 0 = bow .. 1 = transom */
   s: number;
   /** Height above the waterline in the ship's frame (m) */
   y: number;
   inRig: boolean;
   /** Impact point in ship coordinates */
   local: Vector3;
   /** Impact point in world coordinates */
   world: Vector3;
   ammo: AmmoSpec;
   lb: number;
   /** 0 near .. 2 very far */
   range01: number;
   /** Flight direction at impact (normalised) */
   dir: Vector3;
   speed: number;
}

const _inv = new Matrix4();
const _p0 = new Vector3();
const _p1 = new Vector3();
const _hitLocal = new Vector3();
const _rot = new Matrix4();

/**
 * World matrix of a ship's "heeler" frame from its pose - the same matrix the
 * client's Three.js hierarchy produces (ship: position + yaw; heeler child:
 * pitch about X, roll about Z, Euler order XYZ). The server builds target
 * boxes from this; a parity test pins it to the real scene graph.
 */
export function poseMatrix(
   pos: { x: number; z: number },
   pose: { y: number; yawY: number; pitchX: number; rollZ: number },
   out: Matrix4 = new Matrix4(),
): Matrix4 {
   out.makeRotationY(pose.yawY);
   out.multiply(_rot.makeRotationX(pose.pitchX));
   out.multiply(_rot.makeRotationZ(pose.rollZ));
   out.setPosition(pos.x, pose.y, pos.z);
   return out;
}

/**
 * Hit test: segment prev -> pos against the targets' hit boxes.
 *
 * The hull is solid, the rig is mostly air - so only a fraction of
 * projectiles hit there (chain shot much more often). For each projectile
 * and target, whether something catches is rolled exactly once; after that
 * the ball flies straight through.
 *
 * The target's world matrix comes in as an argument, not from a Three.js
 * object: on the server it is built from shipPose().
 */
export function checkProjectileHits(
   shot: Projectile,
   targets: Iterable<TargetBox>,
   maxRange: number,
   rng: Rng,
   skipId?: string | null,
): ProjectileHit | null {
   for (const tg of targets) {
      if (!tg || (skipId != null && tg.id === skipId)) continue;
      _inv.copy(tg.matrixWorld).invert();
      _p0.set(shot.prev.x, shot.prev.y, shot.prev.z).applyMatrix4(_inv);
      _p1.set(shot.pos.x, shot.pos.y, shot.pos.z).applyMatrix4(_inv);

      const hx = tg.BEAM * 0.52;
      const hz = tg.LOA * 0.52;
      // 1) Hull
      let t = segmentBox(_p0, _p1, -hx, hx, -tg.DRAFT, tg.FB * 1.3, -hz, hz);
      let inRig = false;
      if (t === null && tg.rigTop) {
         // 2) Rig - mostly air.
         t = segmentBox(
            _p0,
            _p1,
            -(tg.rigHalfWidth ?? 0),
            tg.rigHalfWidth ?? 0,
            tg.FB * 1.3,
            tg.rigTop,
            -hz,
            hz,
         );
         if (t !== null) {
            if (!shot.rigRolled) shot.rigRolled = {};
            if (shot.rigRolled[tg.id] !== undefined) {
               t = shot.rigRolled[tg.id] ? t : null;
            } else {
               const a = AMMO[shot.ammo] || AMMO.ball;
               // Density of the rigging: lower masts, yards and courses
               // below, only thin topmasts near the top
               const yh = _p0.y + (_p1.y - _p0.y) * t;
               const u = clamp(
                  (yh - tg.FB * 1.3) / Math.max(tg.rigTop - tg.FB * 1.3, 1),
                  0,
                  1,
               );
               const density = 1 - 0.72 * u;
               const pHit = (a.rig > 1 ? 0.42 : 0.13) * density;
               const caught = rng() < pHit;
               shot.rigRolled[tg.id] = caught;
               if (!caught) t = null;
            }
            if (t !== null) inRig = true;
         }
      }
      if (t === null) continue;

      _hitLocal.lerpVectors(_p0, _p1, t);
      const sPos = clamp((tg.LOA / 2 - _hitLocal.z) / tg.LOA, 0, 1);
      // Bow at +z, up at +y: the -x side is starboard.
      const side: Side = _hitLocal.x < 0 ? "STBD" : "PORT";
      const dx = shot.pos.x - shot.origin.x;
      const dy = shot.pos.y - shot.origin.y;
      const dz = shot.pos.z - shot.origin.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const speed = Math.hypot(shot.vel.x, shot.vel.y, shot.vel.z) || 1;
      return {
         target: tg,
         side,
         s: sPos,
         y: _hitLocal.y,
         inRig,
         // Vector3 instead of a plain object: the client's effects keep
         // working with it (clone/negate/applyQuaternion), and it costs
         // nothing headless - Vector3 is pure JavaScript.
         local: _hitLocal.clone(),
         world: new Vector3(shot.pos.x, shot.pos.y, shot.pos.z),
         ammo: AMMO[shot.ammo] || AMMO.ball,
         lb: shot.lb,
         range01: clamp(dist / Math.max(maxRange, 40), 0, 2),
         dir: new Vector3(shot.vel.x / speed, shot.vel.y / speed, shot.vel.z / speed),
         speed,
      };
   }
   return null;
}

/**
 * Range to the nearest target that stands to broadside on this side (bearing
 * roughly abeam). 0 = nothing in the firing arc.
 */
export function rangeToTarget(
   ownMatrixWorld: Matrix4,
   side: Side,
   targets: Iterable<TargetBox>,
   maxRange: number,
   skipId?: string | null,
): number {
   _inv.copy(ownMatrixWorld).invert();
   let best = 0;
   for (const tg of targets) {
      if (!tg || (skipId != null && tg.id === skipId)) continue;
      _p0.setFromMatrixPosition(tg.matrixWorld).applyMatrix4(_inv);
      const onSide = side === "STBD" ? _p0.x < 0 : _p0.x > 0;
      if (!onSide) continue;
      const d = Math.hypot(_p0.x, _p0.z);
      // only something that stands roughly abeam can be caught by the broadside
      if (Math.abs(_p0.x) < Math.abs(_p0.z) * 0.45) continue;
      if (d > maxRange * 2.2) continue;
      if (!best || d < best) best = d;
   }
   return best;
}
