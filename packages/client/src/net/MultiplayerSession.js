// MultiplayerSession.js - one player's connection to a battle, as the
// Simulator sees it.
//
// Owns the NetClient and the RemoteShips. Each fixed step it sends the
// player's input and nudges the local ship toward the server's copy; each
// frame it draws the remote ships. What it does NOT do (yet): predict and
// reconcile the local ship from acknowledged inputs - that is Phase 3. Until
// then the local ship runs its own physics for responsiveness and is pulled
// gently toward the authoritative state so drift stays bounded.

import { NetClient } from "./NetClient.js";
import { RemoteShip } from "./RemoteShip.js";
import { Predictor, ViewOffset } from "./Predictor.js";
import { lerp, clamp, courseLayout, normDeg } from "@segel/shared";

/** Seconds over which sea state is blended onto the server's. */
const SEA_TAU = 0.5;

export class MultiplayerSession {
   /**
    * @param {import("../game.js").Simulator} sim
    * @param {object} [opts]
    * @param {number} [opts.delay]  interpolation delay for remote ships (ms)
    * @param {() => number} [opts.now]  clock in ms (tests inject one)
    */
   constructor(sim, opts = {}) {
      this.sim = sim;
      this.net = null;
      this.welcome = null;
      /** @type {Map<string, RemoteShip>} */
      this.remotes = new Map();
      this.delay = opts.delay ?? 100;
      this.now = opts.now || (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
      this.seq = 0;
      this._pending = { fire: null, ammo: null, cutWreck: false };
      this._lastSailSet = null;
      this._serverMe = null;
      /** prediction + reconciliation of our own ship; created in start() */
      this.predictor = null;
      this.viewOffset = new ViewOffset(0.15);
      this._events = [];
      this.closed = false;
      this.closeCode = null;
   }

   /** Our ship's id. Read from the connection: ships are reported while join() is still pending. */
   get shipId() {
      return this.net ? this.net.shipId : null;
   }
   get connected() {
      return !!(this.net && this.net.connected);
   }

   /**
    * Connect and join. Resolves once the world parameters are known and the
    * Simulator has been set up for them.
    */
   async start({ url, vesselId, name, roomId, mode, create }) {
      const sim = this.sim;
      this.net = new NetClient(url);
      this.net.onShipAdd((id, ship) => this._shipAdded(id, ship));
      this.net.onShipRemove((id) => this._shipRemoved(id));
      this.net.onLeave((code) => {
         this.closed = true;
         this.closeCode = code;
      });
      this.mode = mode || "battle";
      this.welcome = await this.net.join({ vesselId, name, roomId, mode: this.mode, create });
      // The room decides what it is (a room id may point at any kind).
      if (this.welcome.mode) this.mode = this.welcome.mode;
      this.course = this.mode === "regatta"
         ? courseLayout((this.welcome.course && this.welcome.course.origin) || { x: 0, z: 0 })
         : null;

      // The world the server plays on. Every parameter is checked: a NaN in
      // the wind would run through sea, pose and flooding into the dynamics.
      const p = this.welcome.params || {};
      const num = (v, d) => (Number.isFinite(v) ? v : d);
      sim.terrain.regenerate(num(p.terrainSeed, 0));
      sim.terrain.setVisible(true);
      sim.wind.baseDir = num(p.windBaseDir, sim.wind.baseDir);
      sim.wind.baseSpeed = num(p.windBaseSpeed, sim.wind.baseSpeed);
      sim.wind.variability = num(p.windVariability, 1);
      sim.sea.snapTo(sim.wind.baseSpeed);
      const st = this.net.state;
      if (st && Number.isFinite(st.seaWind) && Number.isFinite(st.phaseT)) {
         sim.sea.fromSync({ seaWind: st.seaWind, phaseT: st.phaseT });
      }
      // Our ship: the server owns damage, we predict the helm.
      this.predictor = new Predictor(sim.vessel);
      sim.player.serverDriven = { driveMul: 1, rudderMul: 1, dragMul: 1, turnBias: 0, heelBias: 0, stopped: false };
      sim.player.viewOffset = this.viewOffset;
      return this.welcome;
   }

   _shipAdded(id, ship) {
      if (id === this.shipId) {
         // Our own ship: place the local one where the server put it.
         const sim = this.sim;
         sim.boat.pos.x = ship.x;
         sim.boat.pos.z = ship.z;
         sim.boat.heading = ship.heading;
         sim.boat.groundHeading = ship.heading;
         sim.boat.speed = ship.speed;
         sim.boat.sailSet = ship.sailSet;
         return;
      }
      if (this.remotes.has(id)) return;
      const r = new RemoteShip({
         id,
         vesselId: ship.vesselId,
         name: ship.name,
         ai: !!ship.ai,
         scene: this.sim.scene,
         debris: this.sim.debris,
         delay: this.delay,
      });
      for (const sail of r.model.userData.sails || []) {
         const u = sail.material && sail.material.uniforms;
         if (u && u.uSunDir) u.uSunDir.value.copy(this.sim.sunDir);
      }
      this.remotes.set(id, r);
   }

   _shipRemoved(id) {
      const r = this.remotes.get(id);
      if (!r) return;
      r.dispose();
      this.remotes.delete(id);
   }

   /** Ships in the water besides our own, as client Ship objects. */
   remoteShips() {
      return [...this.remotes.values()].map((r) => r.ship);
   }
   findShip(id) {
      const r = this.remotes.get(id);
      return r ? r.ship : null;
   }

   // --- input side ------------------------------------------------------
   fire(side) {
      this._pending.fire = this._pending.fire && this._pending.fire !== side ? "BOTH" : side;
   }
   setAmmo(id) {
      this._pending.ammo = id;
   }
   cutWreck() {
      this._pending.cutWreck = true;
   }

   /**
    * One fixed step: send this tick's input, take in the newest state.
    * `inp` is Controls.read(); the Simulator has already applied it locally.
    */
   stepFixed(dt, inp) {
      const sim = this.sim;
      if (!this.net || !this.net.connected) return;

      const cmd = { seq: ++this.seq, rudder: inp.rudder };
      if (sim.vessel.rig === "square" && sim.boat.sailSet !== this._lastSailSet) {
         cmd.sailSet = sim.boat.sailSet;
         this._lastSailSet = sim.boat.sailSet;
      }
      if (this._pending.fire) cmd.fire = this._pending.fire;
      if (this._pending.ammo) cmd.ammo = this._pending.ammo;
      if (this._pending.cutWreck) cmd.cutWreck = true;
      this._pending = { fire: null, ammo: null, cutWreck: false };
      this.net.send(cmd);
      if (this.predictor) this.predictor.record(cmd);
      this.viewOffset.step(dt);
      if (cmd.ammo) sim.player.battery.setAmmo(cmd.ammo);

      const st = this.net.state;
      if (!st || !st.ships) return;
      const now = this.now();

      // wind and sea follow the server. The fields are undefined until the
      // first full patch has been decoded - a NaN here would poison the
      // dynamics for good.
      if (Number.isFinite(st.windDir) && Number.isFinite(st.windSpeed)) {
         sim.wind.dir = st.windDir;
         sim.wind.speed = st.windSpeed;
      }
      if (Number.isFinite(st.seaWind) && Number.isFinite(st.phaseT)) {
         const k = clamp(dt / SEA_TAU, 0, 1);
         sim.sea.seaWind = lerp(sim.sea.seaWind, st.seaWind, k);
         sim.sea.phaseT = lerp(sim.sea.phaseT, st.phaseT, k);
      }

      st.ships.forEach((s, id) => {
         if (id === this.shipId) {
            this._serverMe = s;
            return;
         }
         const r = this.remotes.get(id);
         if (r) r.push(s, now);
      });

      this._correctLocal(dt);
      this._routeEvents();
   }

   /**
    * Reconcile the local ship with the authoritative copy: ghost <- server
    * state, replay unacknowledged inputs, local <- ghost; the view keeps the
    * old picture and eases onto the new one.
    */
   _correctLocal(dt) {
      const s = this._serverMe;
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.heading)) return;
      const player = this.sim.player;
      // The multipliers the server stepped with - ours for the next steps too.
      player.serverDriven = {
         driveMul: s.driveMul, rudderMul: s.rudderMul, dragMul: s.dragMul,
         turnBias: s.turnBias, heelBias: s.heelBias, stopped: !!s.stopped,
      };
      if (this.predictor) {
         const c = this.predictor.reconcile(s, this.sim.boat, this.sim._windObj ? this.sim._windObj() : { dir: this.sim.wind.dir, speedKts: this.sim.wind.speed });
         if (c) this.viewOffset.absorb(c);
      }
      // Damage is the server's alone; the local battery only shows.
      player.applyDamageState(s);
      player.battery.reloadTime = s.reloadTime || player.battery.reloadTime;
   }

   /** Last reconciliation, for the HUD and the tests. */
   get correction() {
      return this.predictor ? this.predictor.last : null;
   }

   /**
    * The HUD's course panel in a regatta room: the server's leg, lap, times
    * and progress for our ship, plus distance and bearing to the next mark
    * from the shared course geometry. Same shape as Course.update().
    */
   raceStatus(pos) {
      const s = this._serverMe;
      const L = this.course;
      if (!s || !L) return null;
      const leg = L.legs[Math.min(Math.max(s.raceLeg | 0, 0), L.legs.length - 1)];
      const next = leg.ref ? { x: leg.ref.x, z: leg.ref.z, radius: leg.ref.radius } : { x: L.origin.x, z: L.lineZ, radius: 0 };
      const dx = next.x - pos.x;
      const dz = next.z - pos.z;
      return {
         next,
         dist: Math.hypot(dx, dz),
         bearing: normDeg((Math.atan2(dx, dz) * 180) / Math.PI),
         leg: s.raceLeg,
         legType: leg.type,
         legName: leg.name,
         lap: s.raceLap,
         best: s.raceBest >= 0 ? s.raceBest : null,
         time: s.raceTime,
         progress: s.raceProgress,
         message: "",
         justPassed: null,
      };
   }

   /** Standings in a regatta: every boat by laps, then progress. */
   standings() {
      const rows = [];
      const push = (id, name, s, me) => rows.push({ id, name, me, lap: s.raceLap, progress: s.raceProgress, best: s.raceBest });
      if (this._serverMe) push(this.shipId, "you", this._serverMe, true);
      for (const r of this.remotes.values()) if (r.latest) push(r.id, r.name, r.latest, false);
      return rows.sort((a, b) => b.lap - a.lap || b.progress - a.progress);
   }

   _routeEvents() {
      const player = this.sim.player;
      for (const ev of this.net.drainEvents()) {
         this._events.push(ev);
         const mine = ev.shipId === this.shipId;
         if (ev.kind === "ship") {
            if (mine) {
               if (ev.type === "mastLost") player._dropMast(ev.mast, ev.cause || "shot");
               else if (ev.type === "cutAway" && this.sim.debris) this.sim.debris.cutTethers(player.id);
            } else {
               const r = this.remotes.get(ev.shipId);
               if (r) r.onEvent(ev);
            }
         } else if (ev.kind === "salvo") {
            if (mine) player.battery.playSalvo(ev);
            else this.remotes.get(ev.shipId)?.onEvent(ev);
         } else if (ev.kind === "shots") {
            if (mine) player.battery.replayShots(ev.shots);
            else this.remotes.get(ev.shipId)?.onEvent(ev);
         } else if (ev.kind === "hit") {
            // The ball came from `from`; take it out of the air there, and
            // show the strike on the target.
            const firer = ev.from === this.shipId ? player : this.findShip(ev.from);
            if (firer) firer.battery.removeBallNear(ev.world);
            if (mine) player.showHit(ev);
            else this.remotes.get(ev.shipId)?.onEvent(ev);
         }
      }
   }

   /** Step the remote ships' battery visuals (smoke, balls in flight, splashes). */
   stepBatteries(dt, gunCtx) {
      for (const r of this.remotes.values()) r.stepFixed(dt, gunCtx);
   }

   /**
    * Gun status for the HUD from the server's state, in the shape
    * Battery.status() has - so the panel does not know the difference.
    */
   gunStatus() {
      const s = this._serverMe;
      const B = this.sim.player.battery;
      if (!s || !s.guns) return B.status();
      const rt = Math.max(s.reloadTime || B.reloadTime, 0.1);
      const side = (reload, frac) => ({
         ready: reload <= 0 && frac > 0,
         progress: clamp(1 - reload / rt, 0, 1),
      });
      return {
         PORT: side(s.reloadPort, s.gunsPort),
         STBD: side(s.reloadStbd, s.gunsStbd),
         guns: s.guns,
         gunsReady: { PORT: Math.round(s.guns * clamp(s.gunsPort, 0, 1)), STBD: Math.round(s.guns * clamp(s.gunsStbd, 0, 1)) },
         ammo: B.ammoSpec(),
         shots: B.shotsFired,
         broadsides: B.broadsides,
      };
   }

   /** Events since the last call, for messages and effects. */
   drainEvents() {
      const e = this._events;
      this._events = [];
      return e;
   }

   /** Draw the remote ships. */
   render(ctx, frameDt) {
      const now = this.now();
      for (const r of this.remotes.values()) r.render(now, ctx, frameDt);
   }

   /** The HUD's enemy list: every other ship, nearest first. */
   others(from) {
      const out = [];
      for (const r of this.remotes.values()) {
         const s = r.latest;
         if (!s) continue;
         const dx = s.x - from.x;
         const dz = s.z - from.z;
         out.push({
            name: r.name,
            dist: Math.hypot(dx, dz),
            bearing: ((Math.atan2(dx, dz) * 180) / Math.PI + 360) % 360,
            hull: s.hullIntegrity,
            masts: s.mastsStanding,
            struck: !!s.struck,
            sunk: !!s.sunk,
            rate: r.ship.vessel.rate + (r.ai ? "" : " · player"),
         });
      }
      return out.sort((a, b) => a.dist - b.dist);
   }

   async stop() {
      for (const r of this.remotes.values()) r.dispose();
      this.remotes.clear();
      if (this.sim.player) {
         this.sim.player.serverDriven = null;
         this.sim.player.viewOffset = null;
      }
      if (this.net) await this.net.leave();
      this.net = null;
   }
}
