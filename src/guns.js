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
import { puffTexture, flashTexture } from "./fx.js";
import { AMMO, AMMO_ORDER } from "./damage.js";

const SIDES = ["PORT", "STBD"];

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

      this.ammo = "ball";        // ball | chain | grape
      this.ownerId = opts.ownerId ?? null;
      // Ziele liefert der Aufrufer; jedes Ziel beschreibt sein Trefferwerk
      this.targets = opts.targets || (() => []);
      this.onHit = opts.onHit || null;
      this.onReloadDone = opts.onReloadDone || null;
      // Anteil einsatzfaehiger Rohre je Seite (aus dem Schadensmodell)
      this.effectiveness = { PORT: 1, STBD: 1 };

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
      this._p0 = new THREE.Vector3();
      this._p1 = new THREE.Vector3();
      this._hitLocal = new THREE.Vector3();
      this._inv = new THREE.Matrix4();
   }

   // Munition waehlen / durchschalten
   setAmmo(id) { if (AMMO[id]) this.ammo = id; return this.ammo; }
   cycleAmmo() {
      const i = AMMO_ORDER.indexOf(this.ammo);
      this.ammo = AMMO_ORDER[(i + 1) % AMMO_ORDER.length];
      return this.ammo;
   }
   ammoSpec() { return AMMO[this.ammo] || AMMO.ball; }

   // Schiff anmelden (oder abmelden mit null)
   setShip(ship, vessel) {
      this.clear();
      this.ship = ship || null;
      this.spec = (vessel && vessel.guns) || null;
      this.enabled = !!(this.ship && this.spec && this.ship.userData && this.ship.userData.muzzles);
      if (this.spec) {
         this.reloadTime = this.spec.reload;
         this.maxRange = this.spec.range || 500;
         // schwerstes Kaliber an Bord bestimmt die Wucht
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
   // Wie viele Rohre einer Seite noch bedient werden koennen
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
   // Feuer frei
   // ------------------------------------------------------------------
   fire(side, ctx = {}) {
      if (!this.ready(side)) return false;
      const muzzles = this.ship.userData.muzzles[side];
      if (!muzzles || !muzzles.length) return false;
      const nReady = this.gunsReady(side);
      if (nReady <= 0) return false;   // die Seite ist ausgeschlagen

      this.ship.updateMatrixWorld(true);
      const spread = this.spec.spread || 0.3;
      const ammoId = this.ammo;
      // --- Richten -------------------------------------------------------
      // Entfernung zum naechsten Ziel in dieser Breitseite schaetzen und die
      // Rohre darauf legen. Der Schaetzfehler waechst mit der Entfernung -
      // deshalb faellt die Trefferquote weit draussen in sich zusammen.
      const gunnery = clamp(ctx.gunnery ?? 1, 0.3, 1.6);
      const a0 = AMMO[ammoId] || AMMO.ball;
      const R = this._rangeToTarget(side);
      let layElev;
      if (R > 0) {
         const relErr = (0.05 + 0.22 * clamp(R / this.maxRange, 0, 1.6)) / gunnery;
         const Rest = clamp(R * (1 + gauss() * relErr), 25, 2400);
         layElev = elevationForRange(Rest, a0.v0 || 330, a0.drag ?? 0.22, 2.5);
      } else {
         layElev = elevationForRange(this.maxRange * 0.55, a0.v0 || 330, a0.drag ?? 0.22, 2.5);
      }
      // Reststreuung der Salve. Der groesste Posten ist die Rollbewegung im
      // Moment des Abfeuerns: ein Grad Rollen ist auf 400 m schon ein Schiff
      // daneben. Darum wurde "auf der Rolle" geschossen.
      const aimElev = layElev - a0.elevation + gauss() * 0.95 / gunnery;
      const aimTrain = gauss() * 0.010 / gunnery;   // Bogenmass

      // Ausgefallene Rohre gleichmaessig ueber die Seite verteilen
      const step = muzzles.length / nReady;
      for (let k = 0; k < nReady; k++) {
         const i = Math.min(muzzles.length - 1, Math.floor(k * step));
         const t = nReady === 1 ? 0 : k / (nReady - 1);
         this._pending.push({
            side,
            idx: i,
            ammo: ammoId,
            aimElev, aimTrain,
            at: t * spread + Math.random() * 0.035,
         });
      }

      this.reload[side] = this.reloadTime;
      this.broadsides++;
      this.rollKick = (this.spec.rollKick || 2) * (nReady / muzzles.length);
      this.rollKickSide = side === "STBD" ? -1 : 1; // Rueckstoss krengt zur Gegenseite
      if (this.ship.kickRecoil) this.ship.kickRecoil(side, this.spec.recoil || 0.6);
      if (this.sound) {
         const n = Math.min(nReady, 8);
         for (let k = 0; k < n; k++) {
            this.sound.boom((k / n) * spread + Math.random() * 0.03, 0.32 + Math.random() * 0.14);
         }
      }
      return true;
   }

   // Entfernung zum naechsten Ziel, das auf dieser Seite in der Breitseite
   // steht (Peilung 30..150 Grad relativ zum Bug). 0 = nichts im Schussfeld.
   _rangeToTarget(side) {
      const list = this.targets();
      if (!list || !list.length || !this.ship) return 0;
      this.ship.updateMatrixWorld(true);
      const heeler = this.ship.userData.heeler;
      this._inv.copy(heeler.matrixWorld).invert();
      let best = 0;
      for (const tg of list) {
         if (!tg || tg.id === this.ownerId || !tg.heeler) continue;
         tg.heeler.updateMatrixWorld();
         this._p0.setFromMatrixPosition(tg.heeler.matrixWorld).applyMatrix4(this._inv);
         const onSide = side === "STBD" ? this._p0.x > 0 : this._p0.x < 0;
         if (!onSide) continue;
         const d = Math.hypot(this._p0.x, this._p0.z);
         // nur was halbwegs querab steht, laesst sich mit der Breitseite fassen
         if (Math.abs(this._p0.x) < Math.abs(this._p0.z) * 0.45) continue;
         if (d > this.maxRange * 2.2) continue;
         if (!best || d < best) best = d;
      }
      return best;
   }

   // Einzelnes Rohr tatsaechlich abfeuern (aus der Warteschlange)
   _discharge(p) {
      const heeler = this.ship.userData.heeler;
      const local = this.ship.userData.muzzles[p.side][p.idx];
      const world = this._v.copy(local);
      heeler.localToWorld(world);

      // Auswaerts-Richtung (Bordwandnormale) in Weltkoordinaten
      const outLocal = this._w.set(p.side === "STBD" ? 1 : -1, 0, 0);
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

      // --- Geschosse ------------------------------------------------------
      // Vollkugel: ein Stueck, flach und weit.
      // Kettenkugel: taumelndes Paar, hoch gerichtet, kurze Reichweite.
      // Kartaetsche: Schwarm kleiner Kugeln, breiter Kegel, sehr kurze Wirkung.
      const a = AMMO[p.ammo] || AMMO.ball;
      const origin = world.clone().addScaledVector(out, 1.6);
      const up = new THREE.Vector3(0, 1, 0);

      // Die Bedienung richtet gegen die Kraengung aus: gefeuert wurde "auf der
      // Rolle", wenn das Rohr durch die Waagerechte ging. Deshalb ist die
      // Grundrichtung die waagerechte Projektion der Bordwandnormalen - die
      // Kraengung bleibt nur als Restfehler (aimElev) uebrig.
      const flat = new THREE.Vector3(out.x, 0, out.z);
      if (flat.lengthSq() < 1e-6) flat.set(out.x || 1, 0, out.z);
      flat.normalize();
      const sideways = new THREE.Vector3().crossVectors(flat, up).normalize();

      for (let k = 0; k < a.pellets; k++) {
         const dir = flat.clone();
         // Streuung je Rohr plus der gemeinsame Richtfehler der Salve: dadurch
         // geht auch mal eine ganze Breitseite geschlossen zu hoch.
         const sp = a.spreadDeg * DEG;
         dir.addScaledVector(sideways, (Math.random() - 0.5) * 2 * sp + p.aimTrain);
         dir.addScaledVector(up,
            Math.sin((a.elevation + p.aimElev + (Math.random() - 0.5) * a.spreadDeg) * DEG));
         dir.normalize();

         const scale = a.id === "grape" ? 0.45 : a.id === "chain" ? 1.25 : 1;
         const mesh = new THREE.Mesh(this.shotGeo, this.shotMat);
         mesh.scale.setScalar(scale);
         mesh.position.copy(origin);
         this.group.add(mesh);

         const v0 = (a.v0 || 330) * (0.95 + Math.random() * 0.10);
         this._shots.push({
            mesh,
            vel: dir.multiplyScalar(v0),
            life: 0,
            ammo: a.id,
            lb: this.ballWeight,
            drag: a.drag ?? 0.22,
            tumble: a.id === "chain" ? 1 : 0,
            from: origin.clone(),
            prev: origin.clone(),
         });
      }

      this.shotsFired++;
   }

   // ------------------------------------------------------------------
   // Trefferpruefung: Strecke prev -> pos gegen die Huellkoerper der Ziele.
   // Rumpf ist massiv, das Rigg besteht groesstenteils aus Luft - deshalb
   // trifft dort nur ein Teil der Geschosse (Kettenkugel deutlich oefter).
   // ------------------------------------------------------------------
   _checkHits(shot) {
      const list = this.targets();
      if (!list || !list.length) return null;
      for (const tg of list) {
         if (!tg || tg.id === this.ownerId || !tg.heeler) continue;
         tg.heeler.updateMatrixWorld();
         this._inv.copy(tg.heeler.matrixWorld).invert();
         this._p0.copy(shot.prev).applyMatrix4(this._inv);
         this._p1.copy(shot.mesh.position).applyMatrix4(this._inv);

         const hx = tg.BEAM * 0.52, hz = tg.LOA * 0.52;
         // 1) Rumpf
         let t = segmentBox(this._p0, this._p1, -hx, hx, -tg.DRAFT, tg.FB * 1.30, -hz, hz);
         let inRig = false;
         if (t === null && tg.rigTop) {
            // 2) Rigg - grossteils Luft. Je Geschoss und Ziel wird genau einmal
            //    entschieden, ob sich etwas faengt; danach fliegt die Kugel durch.
            t = segmentBox(this._p0, this._p1,
               -tg.rigHalfWidth, tg.rigHalfWidth, tg.FB * 1.30, tg.rigTop, -hz, hz);
            if (t !== null) {
               if (!shot.rigRolled) shot.rigRolled = {};
               if (shot.rigRolled[tg.id] !== undefined) {
                  t = shot.rigRolled[tg.id] ? t : null;
               } else {
                  const a = AMMO[shot.ammo] || AMMO.ball;
                  // Dichte des Tauwerks: unten Untermasten, Rahen und Kurse,
                  // ganz oben nur noch duenne Stengen
                  const yh = this._p0.y + (this._p1.y - this._p0.y) * t;
                  const u = clamp((yh - tg.FB * 1.30) / Math.max(tg.rigTop - tg.FB * 1.30, 1), 0, 1);
                  const density = 1 - 0.72 * u;
                  const pHit = (a.rig > 1 ? 0.42 : 0.13) * density;
                  const caught = Math.random() < pHit;
                  shot.rigRolled[tg.id] = caught;
                  if (!caught) t = null;
               }
               if (t !== null) inRig = true;
            }
         }
         if (t === null) continue;

         this._hitLocal.lerpVectors(this._p0, this._p1, t);
         const sPos = clamp((tg.LOA / 2 - this._hitLocal.z) / tg.LOA, 0, 1);
         const side = this._hitLocal.x >= 0 ? "STBD" : "PORT";
         const dist = shot.from.distanceTo(shot.mesh.position);
         return {
            target: tg, side, s: sPos, y: this._hitLocal.y, inRig,
            local: this._hitLocal.clone(),
            world: shot.mesh.position.clone(),
            ammo: AMMO[shot.ammo] || AMMO.ball,
            lb: shot.lb,
            range01: clamp(dist / Math.max(this.maxRange, 40), 0, 2),
            dir: shot.vel.clone().normalize(),
            speed: shot.vel.length(),
         };
      }
      return null;
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
         if (this.reload[side] > 0) {
            const wasReloading = this.reload[side] > dt;
            this.reload[side] = Math.max(0, this.reload[side] - dt);
            if (wasReloading && this.reload[side] === 0 && this.onReloadDone) {
               this.onReloadDone(side);
            }
         }
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

      // Kugeln: Schwerkraft, Luftwiderstand, Trefferpruefung
      for (let i = this._shots.length - 1; i >= 0; i--) {
         const b = this._shots[i];
         b.life += dt;
         b.prev.copy(b.mesh.position);
         b.vel.y -= 9.81 * dt;
         b.vel.multiplyScalar(1 / (1 + b.drag * dt));
         b.mesh.position.addScaledVector(b.vel, dt);
         if (b.tumble) b.mesh.rotation.set(b.life * 21, b.life * 13, 0);

         const hit = this._checkHits(b);
         if (hit) {
            this.group.remove(b.mesh);
            this._shots.splice(i, 1);
            if (this.onHit) this.onHit(hit);
            continue;
         }

         const seaY = ctx.seaHeight ? ctx.seaHeight(b.mesh.position.x, b.mesh.position.z) : 0;
         if (b.mesh.position.y <= seaY || b.life > 18) {
            this.group.remove(b.mesh);
            // Kartaetschenkugeln spritzen kaum - nur die schweren zeigen Fontaenen
            if (b.ammo !== "grape" || Math.random() < 0.25) {
               this._spawnSplash(b.mesh.position.x, seaY, b.mesh.position.z);
            }
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

// ---------------------------------------------------------------------------
// Ballistik: Wurfweite fuer eine gegebene Rohrerhoehung (Schwerkraft + Luft-
// widerstand, gleiche Integration wie im Flug) und die Umkehrung dazu.
// Genau hier steckt der eigentliche Grund, warum auf Distanz kaum etwas traf:
// die Entfernung musste GESCHAETZT werden, und ein Schaetzfehler von 15 % ist
// auf 500 m eine Lage weit ueber oder weit vor dem Gegner.
// ---------------------------------------------------------------------------
export function rangeForElevation(elevDeg, v0, drag, y0 = 2.5) {
   const e = elevDeg * Math.PI / 180;
   let x = 0, y = y0, vx = v0 * Math.cos(e), vy = v0 * Math.sin(e), t = 0;
   const dt = 0.02;
   while (y > 0 && t < 40) {
      vy -= 9.81 * dt;
      const f = 1 / (1 + drag * dt);
      vx *= f; vy *= f;
      x += vx * dt; y += vy * dt; t += dt;
   }
   return x;
}

// Rohrerhoehung, die eine gewuenschte Entfernung ergibt (Bisektion)
export function elevationForRange(R, v0, drag, y0 = 2.5) {
   let lo = -1, hi = 22;
   for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (rangeForElevation(mid, v0, drag, y0) < R) lo = mid; else hi = mid;
   }
   return (lo + hi) / 2;
}

// Normalverteilte Zufallszahl (Box-Muller), fuer Schaetzfehler
function gauss() {
   let u = 0, v = 0;
   while (u === 0) u = Math.random();
   while (v === 0) v = Math.random();
   return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Strecke p0->p1 gegen eine achsenparallele Box. Liefert den Parameter t des
// Eintrittspunkts (0..1) oder null. Slab-Verfahren.
export function segmentBox(p0, p1, x0, x1, y0, y1, z0, z1) {
   let tmin = 0, tmax = 1;
   const d = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
   const o = [p0.x, p0.y, p0.z];
   const lo = [x0, y0, z0], hi = [x1, y1, z1];
   for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) {
         if (o[i] < lo[i] || o[i] > hi[i]) return null;
         continue;
      }
      let t1 = (lo[i] - o[i]) / d[i];
      let t2 = (hi[i] - o[i]) / d[i];
      if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
   }
   // Der Schnitt muss INNERHALB der Strecke liegen - sonst meldet auch eine
   // Box weit voraus auf der Geraden einen Treffer.
   if (tmin > 1 || tmax < 0) return null;
   return Math.max(tmin, 0);
}

export default { Battery, segmentBox };
