// guns.js - Batterie, Breitseite, Pulverrauch, Fall of Shot.
//
// Eine Breitseite feuert nicht auf einen Schlag: die Bedienungen loesen mit
// leichtem Versatz aus (spread), daher rollt der Donner die Bordwand entlang.
// Jedes Rohr erzeugt Muendungsfeuer, eine Rauchwolke (treibt mit dem Wind ab)
// und eine Kugel, die ballistisch faellt und eine Einschlagfontaene setzt.
//
// Nachladen: eine gedrillte Royal-Navy-Bedienung schaffte rund drei Schuss in
// zwei Minuten. Hier verkuerzt auf vessel.guns.reload Sekunden pro Seite.

import * as THREE from "three";
import { clamp, DEG, dirVec } from "./utils.js";

const SIDES = ["PORT", "STBD"];

// ---------------- Texturen ----------------
function puffTexture() {
   const c = document.createElement("canvas");
   c.width = c.height = 64;
   const g = c.getContext("2d");
   for (let i = 0; i < 10; i++) {
      const x = 16 + Math.random() * 32, y = 16 + Math.random() * 32;
      const r = 8 + Math.random() * 16;
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, "rgba(255,255,255,0.85)");
      rg.addColorStop(0.55, "rgba(235,235,230,0.35)");
      rg.addColorStop(1, "rgba(220,220,215,0)");
      g.fillStyle = rg;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
   }
   const t = new THREE.CanvasTexture(c);
   t.needsUpdate = true;
   return t;
}

function flashTexture() {
   const c = document.createElement("canvas");
   c.width = c.height = 64;
   const g = c.getContext("2d");
   const rg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
   rg.addColorStop(0, "rgba(255,250,220,1)");
   rg.addColorStop(0.3, "rgba(255,190,90,0.9)");
   rg.addColorStop(0.7, "rgba(230,120,40,0.35)");
   rg.addColorStop(1, "rgba(180,80,20,0)");
   g.fillStyle = rg;
   g.fillRect(0, 0, 64, 64);
   const t = new THREE.CanvasTexture(c);
   t.needsUpdate = true;
   return t;
}

// ---------------- Geschuetzdonner (WebAudio, ohne Assets) ----------------
class BoomAudio {
   constructor() {
      this.ctx = null;
      this.enabled = true;
   }
   _ensure() {
      if (this.ctx || !this.enabled) return this.ctx;
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.enabled = false; return null; }
      try { this.ctx = new AC(); } catch (e) { this.enabled = false; }
      return this.ctx;
   }
   boom(delay = 0, gain = 0.5) {
      const ctx = this._ensure();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const t0 = ctx.currentTime + delay;
      const dur = 0.75;
      const n = Math.floor(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, n, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) {
         const env = Math.pow(1 - i / n, 2.6);
         d[i] = (Math.random() * 2 - 1) * env;
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.setValueAtTime(900, t0);
      lp.frequency.exponentialRampToValueAtTime(110, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);
      src.connect(lp); lp.connect(g); g.connect(ctx.destination);
      src.start(t0);
      src.stop(t0 + dur);
   }
}

// =========================================================================
export class Battery {
   constructor(scene, opts = {}) {
      this.scene = scene;
      this.ship = null;
      this.spec = null;
      this.maxRange = 500;
      this.reload = { PORT: 0, STBD: 0 };
      this.reloadTime = 10;
      this.shotsFired = 0;
      this.broadsides = 0;
      this.rollKick = 0;         // Grad, wird von game.js auf die Krengung addiert
      this.rollKickSide = 1;
      this.sound = opts.sound === false ? null : new BoomAudio();

      this.enabled = false;
      this._pending = [];        // zeitversetzte Einzelschuesse
      this._smoke = [];
      this._flashes = [];
      this._shots = [];
      this._splashes = [];

      const hasDom = typeof document !== "undefined";
      this.texPuff = hasDom ? puffTexture() : null;
      this.texFlash = hasDom ? flashTexture() : null;

      this.group = new THREE.Group();
      this.group.frustumCulled = false;
      if (scene && scene.add) scene.add(this.group);

      this.shotGeo = new THREE.SphereGeometry(0.32, 6, 5);
      this.shotMat = new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.6, metalness: 0.4 });

      this._v = new THREE.Vector3();
      this._w = new THREE.Vector3();
   }

   // Schiff anmelden (oder abmelden mit null)
   setShip(ship, vessel) {
      this.clear();
      this.ship = ship || null;
      this.spec = (vessel && vessel.guns) || null;
      this.enabled = !!(this.ship && this.spec && this.ship.userData && this.ship.userData.muzzles);
      if (this.spec) {
         this.reloadTime = this.spec.reload;
         this.maxRange = this.spec.range || 500;
      }
      this.reload.PORT = 0;
      this.reload.STBD = 0;
      this.shotsFired = 0;
      this.broadsides = 0;
      return this;
   }

   gunsPerSide() {
      if (!this.enabled) return 0;
      return this.ship.userData.muzzles.PORT.length;
   }

   ready(side) {
      return this.enabled && this.reload[side] <= 0;
   }

   status() {
      const s = {};
      for (const side of SIDES) {
         s[side] = {
            ready: this.ready(side),
            progress: this.enabled ? clamp(1 - this.reload[side] / this.reloadTime, 0, 1) : 0,
         };
      }
      s.guns = this.gunsPerSide();
      s.shots = this.shotsFired;
      s.broadsides = this.broadsides;
      return s;
   }

   // ------------------------------------------------------------------
   // Feuer frei
   // ------------------------------------------------------------------
   fire(side, ctx = {}) {
      if (!this.ready(side)) return false;
      const muzzles = this.ship.userData.muzzles[side];
      if (!muzzles || !muzzles.length) return false;

      this.ship.updateMatrixWorld(true);
      const spread = this.spec.spread || 0.3;

      // Reihenfolge vom Bug nach achtern -> der Donner rollt die Seite entlang
      for (let i = 0; i < muzzles.length; i++) {
         const t = muzzles.length === 1 ? 0 : i / (muzzles.length - 1);
         this._pending.push({
            side,
            idx: i,
            at: t * spread + Math.random() * 0.035,
            ctx: { windDir: ctx.windDir ?? 0, windSpeed: ctx.windSpeed ?? 10 },
         });
      }

      this.reload[side] = this.reloadTime;
      this.broadsides++;
      this.rollKick = this.spec.rollKick || 2;
      this.rollKickSide = side === "STBD" ? -1 : 1; // Rueckstoss krengt zur Gegenseite
      if (this.ship.kickRecoil) this.ship.kickRecoil(side, this.spec.recoil || 0.6);
      if (this.sound) {
         const n = Math.min(muzzles.length, 8);
         for (let k = 0; k < n; k++) {
            this.sound.boom((k / n) * spread + Math.random() * 0.03, 0.32 + Math.random() * 0.14);
         }
      }
      return true;
   }

   // Einzelnes Rohr tatsaechlich abfeuern (aus der Warteschlange)
   _discharge(p) {
      const heeler = this.ship.userData.heeler;
      const local = this.ship.userData.muzzles[p.side][p.idx];
      const world = this._v.copy(local);
      heeler.localToWorld(world);

      // Auswaerts-Richtung (Bordwandnormale) in Weltkoordinaten
      const outLocal = this._w.set(p.side === "STBD" ? 1 : -1, 0.06, 0);
      const out = outLocal.clone().transformDirection(heeler.matrixWorld).normalize();

      // Muendungsfeuer
      if (this.texFlash) {
         const fl = new THREE.Sprite(new THREE.SpriteMaterial({
            map: this.texFlash, transparent: true, depthWrite: false,
            blending: THREE.AdditiveBlending, fog: false,
         }));
         const sc = 3.2 + Math.random() * 1.4;
         fl.scale.set(sc, sc, 1);
         fl.position.copy(world).addScaledVector(out, 1.4);
         this.group.add(fl);
         this._flashes.push({ sprite: fl, life: 0, max: 0.11 + Math.random() * 0.05 });
      }

      // Rauch: mehrere Ballen, die sich ausdehnen und abtreiben
      if (this.texPuff) {
         const puffs = 3;
         for (let k = 0; k < puffs; k++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({
               map: this.texPuff, transparent: true, depthWrite: false,
               opacity: 0.0, color: 0xf0efe9, fog: true,
            }));
            const s0 = 2.4 + Math.random() * 1.8;
            sp.scale.set(s0, s0, 1);
            sp.position.copy(world)
               .addScaledVector(out, 1.0 + k * 1.9 + Math.random())
               .add(new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.0, (Math.random() - 0.5) * 1.2));
            this.group.add(sp);
            this._smoke.push({
               sprite: sp, life: 0,
               max: 3.4 + Math.random() * 2.6,
               size: s0,
               grow: 5.5 + Math.random() * 4.0,
               vel: out.clone().multiplyScalar(4.5 - k * 1.1).add(new THREE.Vector3(0, 0.9 + Math.random() * 0.6, 0)),
               peak: 0.62 - k * 0.07,
            });
         }
      }

      // Kugel
      const ball = new THREE.Mesh(this.shotGeo, this.shotMat);
      ball.position.copy(world).addScaledVector(out, 1.6);
      this.group.add(ball);
      const v0 = 118 + Math.random() * 10;          // m/s (fuer die Optik gebremst)
      const elev = (0.6 + Math.random() * 0.8) * DEG; // leichte Erhoehung
      const vel = out.clone().multiplyScalar(v0);
      vel.y += Math.sin(elev) * v0 + 6.0;
      this._shots.push({ mesh: ball, vel, life: 0 });

      this.shotsFired++;
   }

   // ------------------------------------------------------------------
   update(dt, ctx = {}) {
      if (dt <= 0) return;
      const windDir = ctx.windDir ?? 0;
      const windSpeed = ctx.windSpeed ?? 10;
      // Wind weht VON windDir, treibt also nach windDir+180
      const wv = dirVec(windDir + 180);
      const wms = windSpeed * 0.514444;

      // Nachladen
      for (const side of SIDES) {
         if (this.reload[side] > 0) this.reload[side] = Math.max(0, this.reload[side] - dt);
      }
      // Krengungsstoss klingt ab
      if (this.rollKick > 0.001) this.rollKick = Math.max(0, this.rollKick - dt * 4.2);

      // Warteschlange
      if (this._pending.length) {
         for (let i = this._pending.length - 1; i >= 0; i--) {
            this._pending[i].at -= dt;
            if (this._pending[i].at <= 0) {
               const p = this._pending[i];
               this._pending.splice(i, 1);
               if (this.enabled) this._discharge(p);
            }
         }
      }

      // Muendungsfeuer
      for (let i = this._flashes.length - 1; i >= 0; i--) {
         const f = this._flashes[i];
         f.life += dt;
         const u = f.life / f.max;
         if (u >= 1) {
            this.group.remove(f.sprite);
            f.sprite.material.dispose();
            this._flashes.splice(i, 1);
            continue;
         }
         f.sprite.material.opacity = 1 - u;
         const s = f.sprite.scale.x * (1 + dt * 6);
         f.sprite.scale.set(s, s, 1);
      }

      // Rauch
      for (let i = this._smoke.length - 1; i >= 0; i--) {
         const s = this._smoke[i];
         s.life += dt;
         const u = s.life / s.max;
         if (u >= 1) {
            this.group.remove(s.sprite);
            s.sprite.material.dispose();
            this._smoke.splice(i, 1);
            continue;
         }
         s.vel.multiplyScalar(1 - Math.min(dt * 1.6, 0.9));
         s.sprite.position.addScaledVector(s.vel, dt);
         s.sprite.position.x += wv.x * wms * dt * 0.85;
         s.sprite.position.z += wv.z * wms * dt * 0.85;
         s.sprite.position.y += dt * 0.55;
         const sc = s.size + s.grow * s.life;
         s.sprite.scale.set(sc, sc, 1);
         s.sprite.material.opacity = s.peak * Math.min(1, u * 7) * Math.pow(1 - u, 1.5);
      }

      // Kugeln
      for (let i = this._shots.length - 1; i >= 0; i--) {
         const b = this._shots[i];
         b.life += dt;
         b.vel.y -= 9.81 * dt;
         b.mesh.position.addScaledVector(b.vel, dt);
         const seaY = ctx.seaHeight ? ctx.seaHeight(b.mesh.position.x, b.mesh.position.z) : 0;
         if (b.mesh.position.y <= seaY || b.life > 14) {
            this.group.remove(b.mesh);
            this._spawnSplash(b.mesh.position.x, seaY, b.mesh.position.z);
            this._shots.splice(i, 1);
         }
      }

      // Einschlagfontaenen
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
         const sc = s.size * (1 + u * 1.6);
         s.sprite.scale.set(sc * 0.55, sc, 1);
         s.sprite.position.y = s.y0 + Math.sin(Math.min(u, 0.5) * Math.PI) * s.size * 1.1;
         s.sprite.material.opacity = 0.8 * Math.pow(1 - u, 1.3);
      }
   }

   _spawnSplash(x, y, z) {
      if (!this.texPuff) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
         map: this.texPuff, transparent: true, depthWrite: false,
         color: 0xdff0ff, opacity: 0.85, fog: true,
      }));
      const size = 5.5 + Math.random() * 3.0;
      sp.scale.set(size * 0.5, size, 1);
      sp.position.set(x, y + size * 0.4, z);
      this.group.add(sp);
      this._splashes.push({ sprite: sp, life: 0, max: 1.5 + Math.random() * 0.6, size, y0: y + size * 0.4 });
   }

   clear() {
      for (const arr of [this._smoke, this._flashes, this._splashes]) {
         for (const e of arr) {
            this.group.remove(e.sprite);
            if (e.sprite.material) e.sprite.material.dispose();
         }
         arr.length = 0;
      }
      for (const b of this._shots) this.group.remove(b.mesh);
      this._shots.length = 0;
      this._pending.length = 0;
      this.rollKick = 0;
   }
}

export default { Battery };
