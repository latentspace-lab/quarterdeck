// debris.js - Starrkoerper-Simulation fuer Wrackteile.
//
// Kein Physik-Framework, sondern ein kleiner eigener Integrator - das reicht
// vollkommen, weil Wrackteile untereinander nicht kollidieren muessen. Was
// zaehlt, ist das Verhalten gegenueber Schwerkraft, Wasser und Luft:
//
//   * Schwerkraft            greift im Schwerpunkt an -> kein Drehmoment
//   * Auftrieb               F = rho_Wasser * g * V_eingetaucht   (Archimedes),
//                            aber VERTEILT ueber Stuetzpunkte laengs des Koerpers.
//                            Genau daraus entsteht das Drehmoment: solange ein
//                            Mast senkrecht steht, sitzt der Auftriebsschwerpunkt
//                            unter dem Massenschwerpunkt - das ist ein labiles
//                            Gleichgewicht, und er kippt um, bis er flach im
//                            Wasser liegt. Ein einzelner Auftriebspunkt kann das
//                            nicht: damit bliebe jeder Mast senkrecht stehen.
//   * Wasserwiderstand       quadratisch, mit dem eingetauchten Anteil skaliert,
//                            an jedem Stuetzpunkt einzeln -> bremst auch die Drehung
//   * Drehimpuls             freie Rotation, Quaternion-Integration
//   * Trosse (tether)        gefallene Masten haengen im stehenden Gut und
//                            schleppen laengsseit mit, bis sie gekappt werden
//
// Einheiten: SI (Meter, Sekunden, Kilogramm). Welt: X=Ost, Z=Nord, Y=hoch.

import * as THREE from "three";
import { clamp } from "./utils.js";
import { puffTexture } from "./fx.js";
import { palette } from "./style.js";

const G = 9.81;
const RHO_WATER = 1025;      // kg/m3, Seewasser
const ZERO = new THREE.Vector3();

// Materialdichten (kg/m3)
export const RHO = {
   oak: 720,        // Eiche, Rumpfplanken - schwimmt knapp
   pine: 520,       // Kiefer/Fichte, Rundhoelzer - schwimmt gut
   canvas: 900,     // nasses Segeltuch - treibt knapp unter der Oberflaeche
   iron: 7600,      // Kanonenrohre, Beschlaege - sinkt sofort
   rope: 950,
};

// ---------------------------------------------------------------- Geometrie
// Ein paar unregelmaessige Splitterformen, die sich alle Teile teilen.
function makeSplinterGeos() {
   const geos = [];
   for (let v = 0; v < 4; v++) {
      const g = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
         // laenglich ziehen und die Ecken verziehen -> Holzsplitter statt Wuerfel
         p.setX(i, p.getX(i) * (0.9 + Math.random() * 0.5));
         p.setY(i, p.getY(i) * (0.35 + Math.random() * 0.35));
         p.setZ(i, p.getZ(i) * (2.2 + Math.random() * 2.6));
      }
      g.computeVertexNormals();
      geos.push(g);
   }
   return geos;
}

// ---------------------------------------------------------------- Feld
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
      this._sparGeo.rotateX(Math.PI / 2); // Achse entlang +Z
      this._scrapGeo = new THREE.PlaneGeometry(1, 1, 2, 2);

      this._matCache = new Map();

      // Arbeitsvektoren
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

   // ------------------------------------------------------------ Einfuegen
   _push(piece) {
      if (this.pieces.length >= this.max) {
         // aeltestes freies Teil recyceln, angebundene Wracks nie
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

   // Stuetzpunkte laengs eines langgestreckten Koerpers (Mast, Rah, Planke).
   // axis: lokale Richtung, from/to: Anfang und Ende laengs dieser Achse.
   // taper(u) gewichtet das Volumen (Untermast dick, Bramstenge duenn).
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
            // r ist die halbe Dicke des Koerpers an dieser Stelle - sie
            // bestimmt, wie tief er einsinkt. Ohne Angabe: halbe Segmentlaenge.
            r: radius != null ? Math.max(radius * (taper ? Math.sqrt(Math.max(taper(u), 0.04)) : 1), 0.05)
                              : Math.abs(seg) * 0.5,
         });
      }
      return probes;
   }

   // Ein fertiges Mesh als Starrkoerper uebernehmen.
   // spec: { pos, quat, vel, omega, mass, volume, radius, cdWater, cdAir,
   //         com    - Schwerpunkt im Mesh-System (Vector3, Standard 0)
   //         probes - Auftriebs-Stuetzpunkte im Mesh-System
   //         inertia- Traegheitsmoment (skalar), Standard aus Masse und Radius
   //         life, tether:{owner, local, len, attach} }
   addBody(mesh, spec = {}) {
      const com = spec.com ? spec.com.clone() : new THREE.Vector3();
      const quat = spec.quat ? spec.quat.clone() : mesh.quaternion.clone();
      // pos bezeichnet ab hier IMMER den Schwerpunkt in Weltkoordinaten
      const pos = spec.pos
         ? spec.pos.clone()
         : mesh.position.clone().add(com.clone().applyQuaternion(quat));
      const radius = Math.max(spec.radius ?? 0.3, 0.02);
      const volume = Math.max(spec.volume ?? 0.015, 1e-4);
      const mass = Math.max(spec.mass ?? 10, 0.05);
      // Stuetzpunkte relativ zum Schwerpunkt ablegen
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
               // Angriffspunkt am Koerper, relativ zum Schwerpunkt
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

   // Eine komplette Baugruppe (z. B. Mast mit Rahen und Segeln) uebernehmen.
   // Die Welt-Transformation bleibt erhalten: das Teil bleibt genau dort
   // stehen, wo es im Moment des Bruchs war.
   capture(group, spec = {}) {
      group.updateMatrixWorld(true);
      this.group.attach(group); // three erhaelt dabei die Welt-Transformation
      const com = spec.com ? spec.com.clone() : new THREE.Vector3();
      return this.addBody(group, {
         ...spec,
         quat: group.quaternion.clone(),
         pos: group.position.clone().add(com.clone().applyQuaternion(group.quaternion)),
      });
   }

   // Mesh an seinen Platz setzen: pos ist der Schwerpunkt, das Mesh-System
   // sitzt um -com davon entfernt.
   _placeMesh(p) {
      if (p.com.lengthSq() > 1e-9) {
         this._v.copy(p.com).applyQuaternion(p.quat);
         p.mesh.position.copy(p.pos).sub(this._v);
      } else {
         p.mesh.position.copy(p.pos);
      }
      p.mesh.quaternion.copy(p.quat);
   }

   // ---------------------------------------------------- Splitter & Trümmer
   // Der eigentliche Killer an Bord war nicht die Kugel, sondern der
   // Holzsplitterhagel, den sie aus der Bordwand schlug.
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
         // Volumen aus den Abmessungen, Masse aus der Dichte
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

   // Ein groesseres Plankenstueck / Wrackteil
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

   // Abgeschossenes Rundholz (Rah, Stenge)
   spawnSpar(pos, dir, len, radius, opts = {}) {
      const mesh = new THREE.Mesh(this._sparGeo, this._mat(opts.color ?? 0x6b4c28));
      mesh.scale.set(radius, radius, len);
      const vol = Math.PI * radius * radius * len;
      // Rundholz-Achse ist +Z; verteilte Stuetzpunkte, damit es flach treibt
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

   // Weggeschossener Segelfetzen - treibt, saugt sich voll, sackt weg
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
         cdAir: 0.85,   // Tuch bremst in der Luft stark
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

   // ------------------------------------------------------------- Trossen
   // Wrack kappen: alle Teile, die noch am Schiff haengen, treiben ab.
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

   // Wie stark haengt das Wrack am Schiff? 0 = nichts, 1 = schwer behindert.
   tetherLoad(owner) {
      let load = 0;
      for (const p of this.pieces) {
         if (p.tether && p.tether.owner === owner) {
            // Ein zwoelf Tonnen schweres Rundholz laengsseit bremst auch dann,
            // wenn die Trosse gerade lose steht - deshalb ein Sockelbetrag
            // plus der tatsaechliche Zug.
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

   // ------------------------------------------------------------- Schritt
   // ctx: { seaHeight(x,z), windDir, windSpeed, anchorOf(owner, localVec, out) }
   update(dt, ctx = {}) {
      if (dt <= 0) return;
      const seaH = ctx.seaHeight || (() => 0);
      const windMs = (ctx.windSpeed ?? 0) * 0.514444;
      const wv = ctx.windVec || { x: 0, z: 0 };

      for (let i = this.pieces.length - 1; i >= 0; i--) {
         const p = this.pieces[i];
         p.life += dt;

         // --- Trossenzwang (gefallener Mast haengt im stehenden Gut) -------
         if (p.tether && ctx.anchorOf) {
            const a = ctx.anchorOf(p.tether.owner, p.tether.local, this._anchor);
            if (a) {
               // Die Trosse greift an einem Punkt des Koerpers an (beim Mast am
               // Mastfuss). Dadurch zieht sie ihn nicht nur heran, sondern dreht
               // ihn auch - der Mast pendelt um seine Spur ueber Bord.
               this._r.copy(p.tether.attach || ZERO).applyQuaternion(p.quat);
               this._wp.copy(p.pos).add(this._r);
               const d = this._wp.distanceTo(a);
               if (d > p.tether.len) {
                  this._n.subVectors(a, this._wp).multiplyScalar(1 / Math.max(d, 1e-5));
                  const over = d - p.tether.len;
                  p.pos.addScaledVector(this._n, over * 0.35);
                  // Geschwindigkeit am Angriffspunkt
                  this._vp.copy(p.vel).add(this._tmp.crossVectors(p.omega, this._r));
                  const vn = this._vp.dot(this._n);
                  if (vn < 0) {
                     // Effektive Masse am Angriffspunkt: ein Zug am Mastfuss
                     // beschleunigt nicht die ganze Masse, sondern dreht den
                     // Mast auch. Ohne diesen Term schaukelt sich der Zwang auf.
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

         // --- Schwerkraft ---------------------------------------------------
         p.vel.y -= G * dt;

         // --- Wasser: verteilter Auftrieb, Widerstand, Drehmoment -----------
         // Jeder Stuetzpunkt traegt seinen Anteil. Liegt der Auftriebs-
         // schwerpunkt nicht senkrecht unter dem Massenschwerpunkt, entsteht
         // ein Drehmoment - und genau das kippt einen schwimmenden Mast flach.
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

            // Auftriebskraft an diesem Punkt
            const Fb = RHO_WATER * pr.vol * sb * G;
            this._f.y += Fb;
            this._tmp.set(0, Fb, 0);
            this._tq.add(this._v.crossVectors(this._r, this._tmp));

            // Wasserwiderstand am Punkt (bremst Fahrt UND Drehung)
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
            // Kraefte -> Beschleunigung (Schwerkraft wirkt bereits im Schwerpunkt)
            p.vel.addScaledVector(this._f, dt / p.mass);
            p.omega.addScaledVector(this._tq, dt * p.invI);
            // Restdaempfung, damit nichts aufschaukelt
            p.omega.multiplyScalar(1 / (1 + p.angDrag * 0.9 * deepest * dt));

            // Oberflaechendrift: Treibgut zieht mit Wind und Welle
            p.pos.x += wv.x * windMs * 2.1 * subFrac * dt * dt;
            p.pos.z += wv.z * windMs * 2.1 * subFrac * dt * dt;

            // Zur Ruhe kommen, wenn es flach und langsam treibt
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
         // Notbremse: kein Wrackteil bewegt sich schneller als ein Geschoss
         // oder dreht sich schneller als ein Propeller.
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

         // --- Aussortieren ---------------------------------------------------
         if (p.pos.y < -40 || (!p.tether && p.life > p.maxLife)) {
            this._retire(i);
            continue;
         }
         // sanft ausblenden
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
