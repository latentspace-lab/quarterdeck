// guns.js - Battery: rendering of a broadside.
//
// A broadside doesn't fire all at once: the gun crews fire with a slight
// stagger (spread), so the thunder rolls down the ship's side.
// Each gun produces muzzle flash, a smoke cloud (drifts with the wind)
// and a ball that falls ballistically and raises a splash on impact.
//
// Reloading: a well-drilled Royal Navy crew managed about three shots in
// two minutes. Shortened here to vessel.guns.reload seconds per side.

// The ballistics moved to @quarterdeck/shared/ballistics (Phase 0C): trajectory,
// spread, salvo throw and hit detection now run in the browser as on the
// server, from the same source. What stays here is everything visible -
// muzzle flash, smoke, projectile meshes, splashes, thunder - plus the
// reload timers.
import * as THREE from "three";
import { clamp, dirVec } from "./utils.js";
import { puffTexture, flashTexture } from "./fx.js";
import { puffField, muzzleSmoke, splash as paintedSplash } from "./puffs.js";
import { AMMO, AMMO_ORDER } from "./damage.js";
import { palette } from "./style.js";
import {
   spawnSalvo,
   dischargeShots,
   stepProjectile,
   checkProjectileHits,
   rangeToTarget,
   systemRng,
} from "@quarterdeck/shared";

// Still exported from here so existing import paths keep working.
export {
   rangeForElevation,
   elevationForRange,
   segmentBox,
   gauss,
} from "@quarterdeck/shared";

const SIDES = ["PORT", "STBD"];

// ---------------- Gun thunder (WebAudio, no assets) ----------------
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
      this.rollKick = 0;         // degrees, added to the heel by game.js
      this.rollKickSide = 1;
      this.sound = opts.sound === false ? null : new BoomAudio();
      // Random source. The server and tests pass in a seeded generator;
      // in single player it stays Math.random.
      this.rng = opts.rng || systemRng;

      this.ammo = "ball";        // ball | chain | grape
      this.ownerId = opts.ownerId ?? null;
      // Targets are supplied by the caller; each target describes its own hitbox
      this.targets = opts.targets || (() => []);
      this.onHit = opts.onHit || null;
      this.onReloadDone = opts.onReloadDone || null;
      // Fraction of operational guns per side (from the damage model)
      this.effectiveness = { PORT: 1, STBD: 1 };

      this.enabled = false;
      this._pending = [];        // time-delayed individual shots
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

   /** Set the random source after construction. */
   setRng(rng) { this.rng = rng; }

   // Select / cycle ammunition
   setAmmo(id) { if (AMMO[id]) this.ammo = id; return this.ammo; }
   cycleAmmo() {
      const i = AMMO_ORDER.indexOf(this.ammo);
      this.ammo = AMMO_ORDER[(i + 1) % AMMO_ORDER.length];
      return this.ammo;
   }
   ammoSpec() { return AMMO[this.ammo] || AMMO.ball; }

   // Register a ship (or unregister with null)
   setShip(ship, vessel) {
      this.clear();
      this.ship = ship || null;
      this.spec = (vessel && vessel.guns) || null;
      this.enabled = !!(this.ship && this.spec && this.ship.userData && this.ship.userData.muzzles);
      if (this.spec) {
         this.reloadTime = this.spec.reload;
         this.maxRange = this.spec.range || 500;
         // heaviest calibre aboard determines the impact force
         const lbs = this.spec.decks.map((d) => parseInt(d.calibre, 10) || 12);
         this.ballWeight = Math.max(...lbs);
      } else {
         this.ballWeight = 12;
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
   // How many guns on one side can still be manned
   gunsReady(side) {
      return Math.round(this.gunsPerSide() * clamp(this.effectiveness[side] ?? 1, 0, 1));
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
      s.gunsReady = { PORT: this.gunsReady("PORT"), STBD: this.gunsReady("STBD") };
      s.ammo = this.ammoSpec();
      s.shots = this.shotsFired;
      s.broadsides = this.broadsides;
      return s;
   }

   // ------------------------------------------------------------------
   // Cleared to fire
   // ------------------------------------------------------------------
   fire(side, ctx = {}) {
      if (!this.ready(side)) return false;
      const muzzles = this.ship.userData.muzzles[side];
      if (!muzzles || !muzzles.length) return false;
      const nReady = this.gunsReady(side);
      if (nReady <= 0) return false;   // that side is knocked out

      this.ship.updateMatrixWorld(true);
      const spread = this.spec.spread || 0.3;

      // Aiming and spread are handled by the shared ballistics. That makes
      // the salvo fully described by (seed, options) - exactly what Phase 3C
      // needs to replay on every client.
      const shots = spawnSalvo({
         side,
         ammo: this.ammo,
         muzzleCount: muzzles.length,
         readyCount: nReady,
         spread,
         gunnery: ctx.gunnery ?? 1,
         rangeToTarget: this._rangeToTarget(side),
         maxRange: this.maxRange,
      }, this.rng);
      for (const sh of shots) this._pending.push(sh);

      this.reload[side] = this.reloadTime;
      this.broadsides++;
      this.rollKick = (this.spec.rollKick || 2) * (nReady / muzzles.length);
      this.rollKickSide = side === "STBD" ? -1 : 1; // recoil heels to the opposite side
      if (this.ship.kickRecoil) this.ship.kickRecoil(side, this.spec.recoil || 0.6);
      if (this.sound) {
         const n = Math.min(nReady, 8);
         for (let k = 0; k < n; k++) {
            this.sound.boom((k / n) * spread + this.rng() * 0.03, 0.32 + this.rng() * 0.14);
         }
      }
      return true;
   }

   // Distance to the nearest target that is within the broadside arc on this
   // side (bearing 30..150 degrees relative to the bow). 0 = nothing in the field of fire.
   /**
    * Prepare the target list for the shared ballistics: refresh world
    * matrices and make sure every target carries a `matrixWorld`. Ship
    * supplies it directly; older callers only pass in the Three.js heeler.
    */
   _targetList() {
      const list = this.targets();
      if (!list || !list.length) return null;
      for (const tg of list) {
         if (!tg || !tg.heeler) continue;
         tg.heeler.updateMatrixWorld();
         if (!tg.matrixWorld) tg.matrixWorld = tg.heeler.matrixWorld;
      }
      return list;
   }

   _rangeToTarget(side) {
      if (!this.ship) return 0;
      const list = this._targetList();
      if (!list) return 0;
      this.ship.updateMatrixWorld(true);
      return rangeToTarget(
         this.ship.userData.heeler.matrixWorld,
         side,
         list,
         this.maxRange,
         this.ownerId,
      );
   }

   // ------------------------------------------------------------------
   // Multiplayer: the server decides, this battery only shows.
   // ------------------------------------------------------------------

   /**
    * A broadside was ordered on this ship (server `salvo` event): thunder and
    * recoil now, the guns go off as the `shots` arrive. The reload timer is
    * started for the HUD and the crew animation; the server's is the truth.
    */
   playSalvo(ev) {
      const spread = (this.spec && this.spec.spread) || 0.3;
      if (this.sound) {
         const n = Math.min(ev.count, 8);
         for (let k = 0; k < n; k++) {
            this.sound.boom((k / n) * spread + Math.random() * 0.03, 0.32 + Math.random() * 0.14);
         }
      }
      this.broadsides++;
      const muzzleCount = this.gunsPerSide() || ev.count || 1;
      this.rollKick = ((this.spec && this.spec.rollKick) || 2) * Math.min(1, ev.count / muzzleCount);
      this.rollKickSide = ev.side === "STBD" ? -1 : 1;
      if (this.ship && this.ship.kickRecoil) this.ship.kickRecoil(ev.side, (this.spec && this.spec.recoil) || 0.6);
      this.reload[ev.side] = this.reloadTime;
      if (ev.ammo) this.setAmmo(ev.ammo);
   }

   /**
    * Balls that left this ship's muzzles (server `shots` event), with the
    * exact origin and velocity the server integrates. Flash and smoke at each
    * muzzle, then the flight with the shared integrator - and no hit test:
    * hits arrive as events and are shown by removeBallNear().
    */
   replayShots(shots) {
      for (const s of shots) {
         const origin = this._v.set(s.origin.x, s.origin.y, s.origin.z);
         const out = this._w.set(s.vel.x, 0, s.vel.z);
         if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
         out.normalize();
         // The server's origin is 1.6 m outboard of the muzzle.
         this._muzzleFx(origin.clone().addScaledVector(out, -1.6), out);
         const a = AMMO[s.ammo] || AMMO.ball;
         const scale = a.id === "grape" ? 0.45 : a.id === "chain" ? 1.25 : 1;
         const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
         mesh.scale.setScalar(scale);
         mesh.position.set(s.origin.x, s.origin.y, s.origin.z);
         this.group.add(mesh);
         this._shots.push({
            origin: { ...s.origin }, prev: { ...s.origin }, pos: { ...s.origin }, vel: { ...s.vel },
            ammo: a.id, lb: s.lb, drag: s.drag, mesh, life: 0,
            tumble: a.id === "chain" ? 1 : 0,
            remote: true,
         });
         this.shotsFired++;
      }
   }

   /** A ball struck near `world` (server `hit` event): take the nearest ball in flight out of the air. */
   removeBallNear(world, within = 30) {
      let best = -1;
      let bestD = within;
      for (let i = 0; i < this._shots.length; i++) {
         const b = this._shots[i];
         const d = Math.hypot(b.pos.x - world.x, b.pos.y - world.y, b.pos.z - world.z);
         if (d < bestD) { bestD = d; best = i; }
      }
      if (best < 0) return false;
      this.group.remove(this._shots[best].mesh);
      this._shots.splice(best, 1);
      return true;
   }

   // Actually fire a single gun (from the queue)
   _discharge(p) {
      const heeler = this.ship.userData.heeler;
      const local = this.ship.userData.muzzles[p.side][p.idx];
      const world = this._v.copy(local);
      heeler.localToWorld(world);

      // Outward direction (hull-side normal) in world coordinates
      const outLocal = this._w.set(p.side === "STBD" ? -1 : 1, 0, 0); // starboard is -x
      const out = outLocal.clone().transformDirection(heeler.matrixWorld).normalize();

      this._muzzleFx(world, out);

      // --- Projectiles ------------------------------------------------------
      // Direction and spread are computed by the shared ballistics; only the
      // visible balls are created here.
      const a = AMMO[p.ammo] || AMMO.ball;
      const origin = world.clone().addScaledVector(out, 1.6);
      const shots = dischargeShots({
         origin,
         flat: { x: out.x, y: 0, z: out.z },
         ammo: p.ammo,
         aimElev: p.aimElev,
         aimTrain: p.aimTrain,
         lb: this.ballWeight,
      }, this.rng);

      const scale = a.id === "grape" ? 0.45 : a.id === "chain" ? 1.25 : 1;
      for (const b of shots) {
         const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
         mesh.scale.setScalar(scale);
         mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
         this.group.add(mesh);
         b.mesh = mesh;
         b.life = 0;
         b.tumble = a.id === "chain" ? 1 : 0;
         this._shots.push(b);
      }

      this.shotsFired++;
   }

   /** Muzzle flash and powder smoke at a muzzle position `world`, facing `out`. */
   _muzzleFx(world, out) {
      // Muzzle flash
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

      // Smoke: in the aquatint style the painted puff field draws it
      // (puffs.js); otherwise several sprite puffs that expand and drift away
      const field = puffField();
      if (field) {
         muzzleSmoke(field, world, out);
      } else if (this.texPuff) {
         const puffs = 3;
         for (let k = 0; k < puffs; k++) {
            const sp = new THREE.Sprite(new THREE.SpriteMaterial({
               map: this.texPuff, transparent: true, depthWrite: false,
               opacity: 0.0, color: palette().world.smoke, fog: true,
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
   }

   // ------------------------------------------------------------------
   // Hit detection. The decision is made in @quarterdeck/shared/ballistics;
   // here only the targets are supplied with an up-to-date world matrix.
   // ------------------------------------------------------------------
   _checkHits(shot) {
      const list = this._targetList();
      if (!list) return null;
      return checkProjectileHits(shot, list, this.maxRange, this.rng, this.ownerId);
   }

   // ------------------------------------------------------------------
   update(dt, ctx = {}) {
      if (dt <= 0) return;
      const windDir = ctx.windDir ?? 0;
      const windSpeed = ctx.windSpeed ?? 10;
      // Wind blows FROM windDir, so it drifts things toward windDir+180
      const wv = dirVec(windDir + 180);
      const wms = windSpeed * 0.514444;

      // Reloading
      for (const side of SIDES) {
         if (this.reload[side] > 0) {
            const wasReloading = this.reload[side] > dt;
            this.reload[side] = Math.max(0, this.reload[side] - dt);
            if (wasReloading && this.reload[side] === 0 && this.onReloadDone) {
               this.onReloadDone(side);
            }
         }
      }
      // Heel kick decays
      if (this.rollKick > 0.001) this.rollKick = Math.max(0, this.rollKick - dt * 4.2);

      // Queue
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

      // Muzzle flash
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

      // Smoke
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

      // Balls: gravity, drag, hit detection.
      // The integration itself lives in stepProjectile() - the same formula
      // rangeForElevation() uses to lay the guns, and the same one the
      // server uses in Phase 1.
      for (let i = this._shots.length - 1; i >= 0; i--) {
         const b = this._shots[i];
         b.life += dt;
         stepProjectile(b, dt);
         b.mesh.position.set(b.pos.x, b.pos.y, b.pos.z);
         if (b.tumble) b.mesh.rotation.set(b.life * 21, b.life * 13, 0);

         // Replayed balls are the server's: it has already decided their hits.
         const hit = b.remote ? null : this._checkHits(b);
         if (hit) {
            this.group.remove(b.mesh);
            this._shots.splice(i, 1);
            if (this.onHit) this.onHit(hit);
            continue;
         }

         const seaY = ctx.seaHeight ? ctx.seaHeight(b.pos.x, b.pos.z) : 0;
         if (b.pos.y <= seaY || b.life > 18) {
            this.group.remove(b.mesh);
            // Grapeshot balls barely splash - only the heavy ones show a splash
            if (b.ammo !== "grape" || this.rng() < 0.25) {
               this._spawnSplash(b.pos.x, seaY, b.pos.z);
            }
            this._shots.splice(i, 1);
         }
      }

      // Impact splashes
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
      const field = puffField();
      if (field) { paintedSplash(field, x, y, z, 5.5 + Math.random() * 3.0); return; }
      if (!this.texPuff) return;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
         map: this.texPuff, transparent: true, depthWrite: false,
         color: palette().world.splash, opacity: 0.85, fog: true,
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
