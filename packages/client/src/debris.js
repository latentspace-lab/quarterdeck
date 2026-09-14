// debris.js - rigid-body simulation for wreckage.
//
// Not a physics framework, just a small custom integrator - that is entirely
// sufficient, because pieces of wreckage never need to collide with each
// other. What matters is how they behave against gravity, water and air:
//
//   * Gravity                acts at the centre of mass -> no torque
//   * Buoyancy               F = rho_water * g * V_submerged   (Archimedes),
//                            but DISTRIBUTED over probe points along the body.
//                            This is exactly what produces the torque: as long
//                            as a mast stands upright, the centre of buoyancy
//                            sits below the centre of mass - an unstable
//                            equilibrium, so it tips over until it lies flat
//                            in the water. A single buoyancy point cannot do
//                            this: every mast would stay standing upright.
//   * Water drag             quadratic, scaled by the submerged fraction,
//                            applied at each probe point individually -> also brakes rotation
//   * Angular momentum       free rotation, quaternion integration
//   * Tether                 fallen masts hang in the standing rigging and
//                            drag alongside until the tether is cut
//
// Units: SI (metres, seconds, kilograms). World: X=east, Z=north, Y=up.

import * as THREE from "three";
import { clamp } from "./utils.js";
import { puffTexture } from "./fx.js";
import { palette } from "./style.js";

const G = 9.81;
const RHO_WATER = 1025;      // kg/m3, seawater
const ZERO = new THREE.Vector3();

// Material densities (kg/m3)
export const RHO = {
   oak: 720,        // oak, hull planking - floats just barely
   pine: 520,       // pine/spruce, spars - floats well
   canvas: 900,     // wet sailcloth - drifts just under the surface
   iron: 7600,      // gun barrels, fittings - sinks immediately
   rope: 950,
};

// ---------------------------------------------------------------- Geometry
// A handful of irregular splinter shapes shared by all pieces.
function makeSplinterGeos() {
   const geos = [];
   for (let v = 0; v < 4; v++) {
      const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
         // stretch it lengthwise and distort the corners -> wood splinter instead of a cube
         p.setX(i, p.getX(i) * (0.9 + Math.random() * 0.5));
         p.setY(i, p.getY(i) * (0.35 + Math.random() * 0.35));
         p.setZ(i, p.getZ(i) * (2.2 + Math.random() * 2.6));
      }
      g.computeVertexNormals();
      geos.push(g);
   }
   return geos;
}

// ---------------------------------------------------------------- Field
export class DebrisField {
   constructor(scene, opts = {}) {
      this.scene = scene;
      this.max = opts.max ?? 420;
      this.group = new THREE.Group();
      this.group.frustumCulled = false;
      if (scene && scene.add) scene.add(this.group);

      this.pieces = [];
      this._pool = [];
      this._splashes = [];
      this._texPuff = puffTexture();

      this._splinterGeos = makeSplinterGeos();
      this._plankGeo = new THREE.BoxGeometry(1, 1, 1);
      this._sparGeo = new THREE.CylinderGeometry(1, 1, 1, 7);
      this._sparGeo.rotateX(Math.PI / 2); // axis along +Z
      this._scrapGeo = new THREE.PlaneGeometry(1, 1, 2, 2);

      this._matCache = new Map();

      // Working vectors
      this._v = new THREE.Vector3();
      this._n = new THREE.Vector3();
      this._axis = new THREE.Vector3();
      this._dq = new THREE.Quaternion();
      this._anchor = new THREE.Vector3();
      this._r = new THREE.Vector3();
      this._wp = new THREE.Vector3();
      this._f = new THREE.Vector3();
      this._tq = new THREE.Vector3();
      this._vp = new THREE.Vector3();
      this._tmp = new THREE.Vector3();
   }

   _mat(color, rough = 0.82) {
      const key = color + "|" + rough;
      let m = this._matCache.get(key);
      if (!m) {
         m = new THREE.MeshStandardMaterial({
            color, roughness: rough, metalness: 0.03, side: THREE.DoubleSide,
         });
         this._matCache.set(key, m);
      }
      return m;
   }

   count() { return this.pieces.length; }

   // ------------------------------------------------------------ Inserting
   _push(piece) {
      if (this.pieces.length >= this.max) {
         // recycle the oldest untethered piece, never tethered wreckage
         let idx = -1;
         for (let i = 0; i < this.pieces.length; i++) {
            if (!this.pieces[i].tether) { idx = i; break; }
         }
         if (idx < 0) return null;
         this._retire(idx);
      }
      this.pieces.push(piece);
      return piece;
   }

   _retire(i) {
      const p = this.pieces[i];
      this.group.remove(p.mesh);
      if (p.disposable) {
         p.mesh.traverse((o) => {
            if (o.geometry && o.userData.ownGeo) o.geometry.dispose();
         });
      }
      this.pieces.splice(i, 1);
   }

   // Probe points along an elongated body (mast, yard, plank).
   // axis: local direction, from/to: start and end along this axis.
   // taper(u) weights the volume (lower mast thick, topgallant mast thin).
   static probesAlongAxis(axis, from, to, volume, n = 9, taper = null, radius = null) {
      const probes = [];
      const L = to - from;
      const seg = L / n;
      let sum = 0;
      const w = [];
      for (let i = 0; i < n; i++) {
         const u = (i + 0.5) / n;
         const f = taper ? Math.max(taper(u), 0.02) : 1;
         w.push(f); sum += f;
      }
      for (let i = 0; i < n; i++) {
         const u = (i + 0.5) / n;
         const d = from + L * u;
         probes.push({
            p: axis.clone().multiplyScalar(d),
            vol: volume * w[i] / sum,
            // r is half the body's thickness at this point - it determines
            // how deep it sinks. If not given: half the segment length.
            r: radius != null ? Math.max(radius * (taper ? Math.sqrt(Math.max(taper(u), 0.04)) : 1), 0.05)
                              : Math.abs(seg) * 0.5,
         });
      }
      return probes;
   }

   // Take over a finished mesh as a rigid body.
   // spec: { pos, quat, vel, omega, mass, volume, radius, cdWater, cdAir,
   //         com    - centre of mass in mesh space (Vector3, default 0)
   //         probes - buoyancy probe points in mesh space
   //         inertia- moment of inertia (scalar), default from mass and radius
   //         life, tether:{owner, local, len, attach} }
   addBody(mesh, spec = {}) {
      const com = spec.com ? spec.com.clone() : new THREE.Vector3();
      const quat = spec.quat ? spec.quat.clone() : mesh.quaternion.clone();
      // from here on, pos ALWAYS denotes the centre of mass in world coordinates
      const pos = spec.pos
         ? spec.pos.clone()
         : mesh.position.clone().add(com.clone().applyQuaternion(quat));
      const radius = Math.max(spec.radius ?? 0.3, 0.02);
      const volume = Math.max(spec.volume ?? 0.015, 1e-4);
      const mass = Math.max(spec.mass ?? 10, 0.05);
      // store probe points relative to the centre of mass
      const probes = (spec.probes && spec.probes.length
         ? spec.probes.map((q) => ({ p: q.p.clone().sub(com), vol: q.vol, r: q.r }))
         : [{ p: new THREE.Vector3(), vol: volume, r: radius }]);
      const piece = {
         mesh,
         com,
         probes,
         inertia: Math.max(spec.inertia ?? mass * radius * radius * 0.45, 1e-3),
         pos,
         vel: spec.vel ? spec.vel.clone() : new THREE.Vector3(),
         quat,
         omega: spec.omega ? spec.omega.clone() : new THREE.Vector3(),
         mass,
         volume,
         r: radius,
         cdWater: spec.cdWater ?? 2.4,
         cdAir: spec.cdAir ?? 0.09,
         angDrag: spec.angDrag ?? 0.7,
         life: 0,
         maxLife: spec.life ?? 46,
         fade: spec.fade ?? 3.0,
         tether: spec.tether
            ? {
               ...spec.tether, pull: 0,
               // attach point on the body, relative to the centre of mass
               attach: (spec.tether.attach ? spec.tether.attach.clone() : new THREE.Vector3()).sub(com),
            }
            : null,
         disposable: !!spec.disposable,
         splashed: false,
         settled: 0,
      };
      piece.invI = 1 / piece.inertia;
      this._placeMesh(piece);
      if (mesh.parent !== this.group) this.group.add(mesh);
      return this._push(piece);
   }

   // Take over a complete assembly (e.g. mast with yards and sails).
   // The world transform is preserved: the piece stays exactly where it
   // was at the moment it broke off.
   capture(group, spec = {}) {
      group.updateMatrixWorld(true);
      this.group.attach(group); // three preserves the world transform here
      const com = spec.com ? spec.com.clone() : new THREE.Vector3();
      return this.addBody(group, {
         ...spec,
         quat: group.quaternion.clone(),
         pos: group.position.clone().add(com.clone().applyQuaternion(group.quaternion)),
      });
   }

   // Place the mesh at its position: pos is the centre of mass, the mesh
   // origin sits offset from it by -com.
   _placeMesh(p) {
      if (p.com.lengthSq() > 1e-9) {
         this._v.copy(p.com).applyQuaternion(p.quat);
         p.mesh.position.copy(p.pos).sub(this._v);
      } else {
         p.mesh.position.copy(p.pos);
      }
      p.mesh.quaternion.copy(p.quat);
   }

   // ---------------------------------------------------- Splinters & wreckage
   // The real killer on board was not the cannonball itself, but the hail
   // of wood splinters it tore out of the hull.
   spawnSplinters(pos, dir, n = 12, opts = {}) {
      const color = opts.color ?? 0x9c7c4e;
      const spread = opts.spread ?? 0.75;
      const speed = opts.speed ?? 16;
      const scale = opts.scale ?? 1;
      const out = [];
      for (let i = 0; i < n; i++) {
         const geo = this._splinterGeos[(Math.random() * this._splinterGeos.length) | 0];
         const mesh = new THREE.Mesh(geo, this._mat(color));
         const L = (0.22 + Math.random() * 0.55) * scale;
         mesh.scale.set(L * 0.5, L * 0.28, L);
         const v = this._randomCone(dir, spread).multiplyScalar(speed * (0.45 + Math.random()));
         v.y += Math.random() * 5;
         // volume from the dimensions, mass from the density
         const vol = (L * 0.5) * (L * 0.28) * L * 0.55;
         out.push(this.addBody(mesh, {
            pos,
            quat: new THREE.Quaternion().random(),
            vel: v,
            omega: new THREE.Vector3(
               (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22, (Math.random() - 0.5) * 22),
            mass: vol * RHO.oak,
            volume: vol,
            radius: L * 0.4,
            life: 26 + Math.random() * 14,
            cdWater: 3.4,
         }));
      }
      return out;
   }

   // A larger piece of planking / wreckage
   spawnPlank(pos, dir, opts = {}) {
      const w = opts.w ?? 0.5, h = opts.h ?? 0.10, l = opts.l ?? 2.2;
      const mesh = new THREE.Mesh(this._plankGeo, this._mat(opts.color ?? 0x6b5433));
      mesh.scale.set(w, h, l);
      const vol = w * h * l;
      return this.addBody(mesh, {
         pos,
         quat: new THREE.Quaternion().random(),
         vel: this._randomCone(dir, 0.6).multiplyScalar(opts.speed ?? 8),
         omega: new THREE.Vector3(
            (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9),
         mass: vol * RHO.oak,
         volume: vol,
         radius: l * 0.35,
         life: opts.life ?? 60,
      });
   }

   // A shot-away spar (yard, topmast)
   spawnSpar(pos, dir, len, radius, opts = {}) {
      const mesh = new THREE.Mesh(this._sparGeo, this._mat(opts.color ?? 0x6b4c28));
      mesh.scale.set(radius, radius, len);
      const vol = Math.PI * radius * radius * len;
      // spar axis is +Z; distributed probe points so it drifts lying flat
      const probes = DebrisField.probesAlongAxis(
         new THREE.Vector3(0, 0, 1), -len / 2, len / 2, vol, 5);
      return this.addBody(mesh, {
         probes,
         inertia: vol * RHO.pine * len * len / 12,
         pos,
         quat: opts.quat || new THREE.Quaternion().random(),
         vel: this._randomCone(dir, 0.45).multiplyScalar(opts.speed ?? 6),
         omega: new THREE.Vector3(
            (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2.5, (Math.random() - 0.5) * 4),
         mass: vol * RHO.pine,
         volume: vol,
         radius: Math.max(len * 0.3, radius),
         life: opts.life ?? 70,
         angDrag: 1.1,
      });
   }

   // A shot-away scrap of sail - drifts, soaks up water, sinks away
   spawnCanvas(pos, dir, w, h, opts = {}) {
      const mesh = new THREE.Mesh(this._scrapGeo, this._mat(opts.color ?? 0xefe8d8, 0.95));
      mesh.scale.set(w, h, 1);
      const vol = w * h * 0.006;
      return this.addBody(mesh, {
         pos,
         quat: new THREE.Quaternion().random(),
         vel: this._randomCone(dir, 1.0).multiplyScalar(opts.speed ?? 5),
         omega: new THREE.Vector3(
            (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 7),
         mass: vol * RHO.canvas,
         volume: vol,
         radius: Math.max(w, h) * 0.4,
         cdAir: 0.85,   // cloth brakes hard in the air
         cdWater: 4.5,
         angDrag: 1.6,
         life: opts.life ?? 40,
      });
   }

   _randomCone(dir, spread) {
      const d = this._v.copy(dir).normalize();
      const out = new THREE.Vector3(
         d.x + (Math.random() - 0.5) * spread * 2,
         d.y + (Math.random() - 0.5) * spread * 2,
         d.z + (Math.random() - 0.5) * spread * 2);
      if (out.lengthSq() < 1e-6) out.set(0, 1, 0);
      return out.normalize();
   }

   // ------------------------------------------------------------- Tethers
   // Cut the wreck loose: all pieces still hanging on the ship drift away.
   cutTethers(owner) {
      let n = 0;
      for (const p of this.pieces) {
         if (p.tether && (!owner || p.tether.owner === owner)) {
            p.tether = null;
            p.maxLife = Math.min(p.maxLife, p.life + 55);
            n++;
         }
      }
      return n;
   }

   // How heavily does the wreck drag on the ship? 0 = nothing, 1 = badly hampered.
   tetherLoad(owner) {
      let load = 0;
      for (const p of this.pieces) {
         if (p.tether && p.tether.owner === owner) {
            // A twelve-tonne spar lying alongside slows the ship even when
            // the tether is currently slack - hence a baseline amount
            // plus the actual pull.
            load += clamp(0.35 + 0.65 * clamp(p.tether.pull, 0, 1), 0, 1)
                  * clamp(p.mass / 9000, 0.15, 1);
         }
      }
      return clamp(load, 0, 1);
   }

   hasWreckage(owner) {
      for (const p of this.pieces) if (p.tether && p.tether.owner === owner) return true;
      return false;
   }

   // ------------------------------------------------------------- Step
   // ctx: { seaHeight(x,z), windDir, windSpeed, anchorOf(owner, localVec, out) }
   update(dt, ctx = {}) {
      if (dt <= 0) return;
      const seaH = ctx.seaHeight || (() => 0);
      const windMs = (ctx.windSpeed ?? 0) * 0.514444;
      const wv = ctx.windVec || { x: 0, z: 0 };

      for (let i = this.pieces.length - 1; i >= 0; i--) {
         const p = this.pieces[i];
         p.life += dt;

         // --- Tether constraint (fallen mast hangs in the standing rigging) -------
         if (p.tether && ctx.anchorOf) {
            const a = ctx.anchorOf(p.tether.owner, p.tether.local, this._anchor);
            if (a) {
               // The tether pulls at a point on the body (at the mast, its
               // foot). This does not just pull it in but also rotates it -
               // the mast swings about its stump overboard.
               this._r.copy(p.tether.attach || ZERO).applyQuaternion(p.quat);
               this._wp.copy(p.pos).add(this._r);
               const d = this._wp.distanceTo(a);
               if (d > p.tether.len) {
                  this._n.subVectors(a, this._wp).multiplyScalar(1 / Math.max(d, 1e-5));
                  const over = d - p.tether.len;
                  p.pos.addScaledVector(this._n, over * 0.35);
                  // velocity at the attach point
                  this._vp.copy(p.vel).add(this._tmp.crossVectors(p.omega, this._r));
                  const vn = this._vp.dot(this._n);
                  if (vn < 0) {
                     // Effective mass at the attach point: a pull at the mast
                     // foot does not accelerate the whole mass, it also
                     // rotates the mast. Without this term the constraint blows up.
                     this._tmp.crossVectors(this._r, this._n);
                     const mEff = 1 / (1 / p.mass + this._tmp.lengthSq() * p.invI);
                     const j = -(1 + 0.10) * vn * mEff;
                     this._f.copy(this._n).multiplyScalar(j);
                     p.vel.addScaledVector(this._f, 1 / p.mass);
                     this._tq.crossVectors(this._r, this._f).multiplyScalar(p.invI);
                     p.omega.add(this._tq);
                  }
                  p.tether.pull = clamp(over / p.tether.len, 0, 1);
               } else {
                  p.tether.pull *= Math.max(0, 1 - dt * 1.6);
               }
            } else {
               p.tether = null;
            }
         }

         // --- Gravity ---------------------------------------------------
         p.vel.y -= G * dt;

         // --- Water: distributed buoyancy, drag, torque -----------
         // Each probe point contributes its share. If the centre of buoyancy
         // is not directly below the centre of mass, a torque results -
         // and that is exactly what tips a floating mast flat.
         let subTotal = 0;
         let deepest = 0;
         this._tq.set(0, 0, 0);
         this._f.set(0, 0, 0);

         for (let k = 0; k < p.probes.length; k++) {
            const pr = p.probes[k];
            this._r.copy(pr.p).applyQuaternion(p.quat);
            this._wp.copy(p.pos).add(this._r);
            const seaP = seaH(this._wp.x, this._wp.z);
            const sb = clamp((seaP - (this._wp.y - pr.r)) / (2 * pr.r), 0, 1);
            if (sb <= 0) continue;
            subTotal += sb * pr.vol;
            deepest = Math.max(deepest, sb);

            // buoyancy force at this point
            const Fb = RHO_WATER * pr.vol * sb * G;
            this._f.y += Fb;
            this._tmp.set(0, Fb, 0);
            this._tq.add(this._v.crossVectors(this._r, this._tmp));

            // water drag at the point (brakes both motion AND rotation)
            this._vp.copy(p.vel).add(this._tmp.crossVectors(p.omega, this._r));
            const kd = p.cdWater * sb * pr.vol * RHO_WATER * 0.45
               * (0.5 + 0.09 * this._vp.length());
            this._tmp.copy(this._vp).multiplyScalar(-kd);
            this._f.add(this._tmp);
            this._tq.add(this._v.crossVectors(this._r, this._tmp));
         }

         const subFrac = clamp(subTotal / p.volume, 0, 1);

         if (subFrac > 0) {
            if (!p.splashed && p.vel.y < -3) {
               this._splash(p.pos.x, seaH(p.pos.x, p.pos.z), p.pos.z,
                  clamp(-p.vel.y * 0.10 + p.r, 0.5, 5));
               p.splashed = true;
            }
            // forces -> acceleration (gravity already acts at the centre of mass)
            p.vel.addScaledVector(this._f, dt / p.mass);
            p.omega.addScaledVector(this._tq, dt * p.invI);
            // residual damping, so nothing spirals out of control
            p.omega.multiplyScalar(1 / (1 + p.angDrag * 0.9 * deepest * dt));

            // surface drift: flotsam is drawn along with wind and waves
            p.pos.x += wv.x * windMs * 2.1 * subFrac * dt * dt;
            p.pos.z += wv.z * windMs * 2.1 * subFrac * dt * dt;

            // come to rest once it drifts flat and slowly
            const sp = p.vel.length();
            if (sp < 1.2 && p.omega.length() < 0.35 && !p.tether) {
               p.settled = Math.min(1, p.settled + dt * 0.6);
               p.vel.multiplyScalar(1 / (1 + 1.8 * p.settled * dt));
               p.omega.multiplyScalar(1 / (1 + 1.4 * p.settled * dt));
            } else {
               p.settled = Math.max(0, p.settled - dt);
            }
         } else {
            p.splashed = false;
            const sp = p.vel.length();
            p.vel.multiplyScalar(1 / (1 + p.cdAir * (0.3 + 0.05 * sp) * dt));
            p.omega.multiplyScalar(1 / (1 + p.angDrag * 0.06 * dt));
         }

         // --- Integration ---------------------------------------------------
         // Safety clamp: no piece of wreckage moves faster than a cannonball
         // or spins faster than a propeller.
         const vmax = 90, wmax = 12;
         if (p.vel.lengthSq() > vmax * vmax) p.vel.setLength(vmax);
         if (p.omega.lengthSq() > wmax * wmax) p.omega.setLength(wmax);

         p.pos.addScaledVector(p.vel, dt);
         const w = p.omega.length();
         if (w > 1e-5) {
            this._axis.copy(p.omega).multiplyScalar(1 / w);
            this._dq.setFromAxisAngle(this._axis, w * dt);
            p.quat.premultiply(this._dq).normalize();
         }
         this._placeMesh(p);

         // --- Culling ---------------------------------------------------
         if (p.pos.y < -40 || (!p.tether && p.life > p.maxLife)) {
            this._retire(i);
            continue;
         }
         // fade out smoothly
         if (!p.tether && p.life > p.maxLife - p.fade) {
            const a = clamp((p.maxLife - p.life) / p.fade, 0, 1);
            p.mesh.traverse((o) => {
               if (o.material && o.material.transparent !== undefined) {
                  o.material.transparent = true;
                  o.material.opacity = a;
               }
            });
         }
      }

      this._updateSplashes(dt);
   }

   _splash(x, y, z, size) {
      if (!this._texPuff) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
         map: this._texPuff, transparent: true, depthWrite: false,
         color: palette().world.splash, opacity: 0.75, fog: true,
      }));
      sp.scale.set(size * 0.6, size, 1);
      sp.position.set(x, y + size * 0.35, z);
      this.group.add(sp);
      this._splashes.push({ sprite: sp, life: 0, max: 0.9 + Math.random() * 0.5, size, y0: y + size * 0.35 });
   }

   _updateSplashes(dt) {
      for (let i = this._splashes.length - 1; i >= 0; i--) {
         const s = this._splashes[i];
         s.life += dt;
         const u = s.life / s.max;
         if (u >= 1) {
            this.group.remove(s.sprite);
            s.sprite.material.dispose();
            this._splashes.splice(i, 1);
            continue;
         }
         const sc = s.size * (1 + u * 1.3);
         s.sprite.scale.set(sc * 0.55, sc, 1);
         s.sprite.position.y = s.y0 + Math.sin(Math.min(u, 0.5) * Math.PI) * s.size * 0.8;
         s.sprite.material.opacity = 0.75 * Math.pow(1 - u, 1.4);
      }
   }

   clear() {
      while (this.pieces.length) this._retire(this.pieces.length - 1);
      for (const s of this._splashes) {
         this.group.remove(s.sprite);
         s.sprite.material.dispose();
      }
      this._splashes.length = 0;
   }
}

export default { DebrisField, RHO };
