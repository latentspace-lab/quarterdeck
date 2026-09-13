// ballistics.ts - Wurfbahn, Streuung und Trefferpruefung.
//
// Der aufwendigste Schnitt der Phase 0: in guns.js lagen Ballistik,
// Trefferpruefung, Nachladeuhren und Rauchwolken in einer einzigen Klasse.
// Hier steht nur noch die Mathematik - sie laeuft im Browser wie auf dem
// Server. Alles Sichtbare (Muendungsfeuer, Rauch, Fontaenen, Geschossmeshes)
// bleibt im Client.
//
// Warum Three.js-Vektoren: Matrix4 und Vector3 aus `three/src/math/...` sind
// reines JavaScript ohne DOM- oder WebGL-Bezug. Ein zweiter Vektortyp
// (gl-matrix) haette nur Uebersetzungsfehler zwischen Client und Server
// eingebracht - `_battle.mjs` faehrt diese Klassen seit jeher headless.
//
// Warum der Server die Salve wuerfelt: eine Breitseite ist durch
// `spawnSalvo()` vollstaendig beschrieben. Der Server schickt Seed und
// Zeitpunkt, jeder Client rechnet dieselben Flugbahnen nach und sieht
// dieselben Einschlaege - ohne dass je ein Geschoss uebertragen wird.

import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import { clamp, DEG } from "./utils.ts";
import { gauss, type Rng } from "./rng.ts";
import { AMMO, type AmmoSpec, type Side } from "./damage.ts";

export { gauss };

const GRAVITY = 9.81;

// ---------------------------------------------------------------------------
// Wurfweite fuer eine gegebene Rohrerhoehung (Schwerkraft + Luftwiderstand,
// gleiche Integration wie im Flug) und die Umkehrung dazu.
//
// Genau hier steckt der eigentliche Grund, warum auf Distanz kaum etwas traf:
// die Entfernung musste GESCHAETZT werden, und ein Schaetzfehler von 15 % ist
// auf 500 m eine Lage weit ueber oder weit vor dem Gegner.
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

/** Rohrerhoehung, die eine gewuenschte Entfernung ergibt (Bisektion) */
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

/** Etwas, das .x/.y/.z hat - Vector3 oder ein blankes Objekt. */
export interface XYZ {
   x: number;
   y: number;
   z: number;
}

/**
 * Strecke p0->p1 gegen eine achsenparallele Box. Liefert den Parameter t des
 * Eintrittspunkts (0..1) oder null. Slab-Verfahren.
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
   // Der Schnitt muss INNERHALB der Strecke liegen - sonst meldet auch eine
   // Box weit voraus auf der Geraden einen Treffer.
   if (tmin > 1 || tmax < 0) return null;
   return Math.max(tmin, 0);
}

// ---------------------------------------------------------------------------
// Salve
// ---------------------------------------------------------------------------

/** Huellkoerper eines Ziels, in Schiffskoordinaten. */
export interface TargetBox {
   id: string;
   /** Weltmatrix des gekrengten Rumpfs (aus shipPose gebaut) */
   matrixWorld: Matrix4;
   LOA: number;
   BEAM: number;
   DRAFT: number;
   /** Freibord (m) */
   FB: number;
   /** Oberkante des Riggs ueber der Wasserlinie (m); 0 = kein Rigg mehr */
   rigTop?: number;
   rigHalfWidth?: number;
}

/** Ein einzelner Schuss im Flug. */
export interface Projectile {
   origin: XYZ;
   /** Position am Anfang des Schritts */
   prev: XYZ;
   /** Aktuelle Position */
   pos: XYZ;
   vel: XYZ;
   ammo: string;
   /** Kugelgewicht (englische Pfund) */
   lb: number;
   drag: number;
   /** je Ziel einmal gewuerfelt: faengt sich das Geschoss im Tauwerk? */
   rigRolled?: Record<string, boolean>;
}

export interface SalvoShot {
   side: Side;
   /** Index der Pforte auf dieser Seite */
   idx: number;
   ammo: string;
   /** Gemeinsamer Hoehenrichtfehler der Salve (Grad) */
   aimElev: number;
   /** Gemeinsamer Seitenrichtfehler der Salve (rad) */
   aimTrain: number;
   /** Verzoegerung bis zum Abfeuern (s) - die Breitseite rollt die Bordwand entlang */
   at: number;
}

export interface SalvoOptions {
   side: Side;
   ammo: string;
   /** Zahl der Pforten auf dieser Seite */
   muzzleCount: number;
   /** Zahl der Rohre, die noch bedient werden */
   readyCount: number;
   /** Zeitlicher Versatz der Einzelschuesse (s) */
   spread: number;
   /** Ausbildungsstand der Bedienungen (0.3 .. 1.6) */
   gunnery: number;
   /** Geschaetzte Entfernung zum Ziel (m); 0 = nichts im Schussfeld */
   rangeToTarget: number;
   /** Effektive Reichweite der Batterie (m) */
   maxRange: number;
   /** Hoehe der Pforten ueber Wasser (m) */
   muzzleHeight?: number;
}

/**
 * Eine Breitseite wuerfeln.
 *
 * Die Bedienungen schaetzen die Entfernung und legen die Rohre darauf. Der
 * Schaetzfehler waechst mit der Entfernung - deshalb faellt die Trefferquote
 * weit draussen in sich zusammen. Der groesste Streuposten danach ist die
 * Rollbewegung im Moment des Abfeuerns: ein Grad Rollen ist auf 400 m schon
 * ein Schiff daneben. Darum wurde "auf der Rolle" geschossen.
 *
 * Saemtlicher Zufall steckt hier - damit ist eine Salve durch (Seed, Optionen)
 * vollstaendig beschrieben und laesst sich anderswo nachspielen.
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
   const aimTrain = (gauss(rng) * 0.01) / gunnery; // Bogenmass

   const shots: SalvoShot[] = [];
   const n = Math.max(0, Math.floor(opts.readyCount));
   if (n <= 0 || opts.muzzleCount <= 0) return shots;

   // Ausgefallene Rohre gleichmaessig ueber die Seite verteilen
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
   /** Muendung in Weltkoordinaten */
   origin: XYZ;
   /** Waagerechte Bordwandnormale (normiert) */
   flat: XYZ;
   ammo: string;
   aimElev: number;
   aimTrain: number;
   lb: number;
}

const _up = new Vector3(0, 1, 0);

/**
 * Aus einem gerichteten Rohr die einzelnen Geschosse machen.
 *
 * Vollkugel: ein Stueck, flach und weit.
 * Kettenkugel: taumelndes Paar, hoch gerichtet, kurze Reichweite.
 * Kartaetsche: Schwarm kleiner Kugeln, breiter Kegel, sehr kurze Wirkung.
 *
 * Die Grundrichtung ist die WAAGERECHTE Projektion der Bordwandnormalen:
 * gefeuert wurde "auf der Rolle", wenn das Rohr durch die Waagerechte ging.
 * Die Krengung bleibt nur als Restfehler (aimElev) uebrig.
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
      // Streuung je Rohr plus der gemeinsame Richtfehler der Salve: dadurch
      // geht auch mal eine ganze Breitseite geschlossen zu hoch.
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
 * Ein Geschoss einen festen Schritt weiterfliegen lassen: Schwerkraft und
 * Luftwiderstand, genau wie in rangeForElevation().
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
   /** Laengsposition 0 = Bug .. 1 = Spiegel */
   s: number;
   /** Hoehe ueber der Wasserlinie im Schiffssystem (m) */
   y: number;
   inRig: boolean;
   /** Einschlag in Schiffskoordinaten */
   local: Vector3;
   /** Einschlag in Weltkoordinaten */
   world: Vector3;
   ammo: AmmoSpec;
   lb: number;
   /** 0 nah .. 2 sehr weit */
   range01: number;
   /** Flugrichtung beim Einschlag (normiert) */
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
 * Trefferpruefung: Strecke prev -> pos gegen die Huellkoerper der Ziele.
 *
 * Rumpf ist massiv, das Rigg besteht groesstenteils aus Luft - deshalb trifft
 * dort nur ein Teil der Geschosse (Kettenkugel deutlich oefter). Je Geschoss
 * und Ziel wird genau einmal gewuerfelt, ob sich etwas faengt; danach fliegt
 * die Kugel durch.
 *
 * Die Weltmatrix des Ziels kommt als Argument herein, nicht aus einem
 * Three.js-Objekt: auf dem Server wird sie aus shipPose() gebaut.
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
      // 1) Rumpf
      let t = segmentBox(_p0, _p1, -hx, hx, -tg.DRAFT, tg.FB * 1.3, -hz, hz);
      let inRig = false;
      if (t === null && tg.rigTop) {
         // 2) Rigg - grossteils Luft.
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
               // Dichte des Tauwerks: unten Untermasten, Rahen und Kurse,
               // ganz oben nur noch duenne Stengen
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
      const side: Side = _hitLocal.x >= 0 ? "STBD" : "PORT";
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
         // Vector3 statt eines blanken Objekts: die Effekte im Client rechnen
         // damit weiter (clone/negate/applyQuaternion), und headless kostet es
         // nichts - Vector3 ist reines JavaScript.
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
 * Entfernung zum naechsten Ziel, das auf dieser Seite in der Breitseite steht
 * (Peilung grob querab). 0 = nichts im Schussfeld.
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
      const onSide = side === "STBD" ? _p0.x > 0 : _p0.x < 0;
      if (!onSide) continue;
      const d = Math.hypot(_p0.x, _p0.z);
      // nur was halbwegs querab steht, laesst sich mit der Breitseite fassen
      if (Math.abs(_p0.x) < Math.abs(_p0.z) * 0.45) continue;
      if (d > maxRange * 2.2) continue;
      if (!best || d < best) best = d;
   }
   return best;
}
