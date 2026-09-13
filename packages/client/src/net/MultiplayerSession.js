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
import { lerp, clamp } from "@segel/shared";
import { lerpAngleDeg } from "./Interpolator.js";

/** Seconds over which the local ship is blended onto the server's copy. */
const CORRECTION_TAU = 0.35;
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
   async start({ url, vesselId, name, roomId, create }) {
      const sim = this.sim;
      this.net = new NetClient(url);
      this.net.onShipAdd((id, ship) => this._shipAdded(id, ship));
      this.net.onShipRemove((id) => this._shipRemoved(id));
      this.net.onLeave((code) => {
         this.closed = true;
         this.closeCode = code;
      });
      this.welcome = await this.net.join({ vesselId, name, roomId, create });

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

      const st = this.net.state;
      if (!st || !st.ships) return;
      const now = this.now();

      // Wind and sea follow the server. The fields are undefined until the
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

   /** Blend the local ship toward the authoritative copy. */
   _correctLocal(dt) {
      const s = this._serverMe;
      if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.heading)) return;
      const b = this.sim.boat;
      const k = clamp(dt / CORRECTION_TAU, 0, 1);
      b.pos.x = lerp(b.pos.x, s.x, k);
      b.pos.z = lerp(b.pos.z, s.z, k);
      b.heading = lerpAngleDeg(b.heading, s.heading, k);
      b.speed = lerp(b.speed, s.speed, k);
      // Damage is the server's alone.
      const D = this.sim.player.dmg;
      D.flooding = s.flooding;
      D.afire = s.afire;
      if (s.struck && !D.struck) { D.struck = true; this.sim.player._syncAppearance(); }
      if (s.sunk && !D.sunk) { D.sunk = true; this.sim.player._syncAppearance(); }
      this.sim.player.wreckDrag = s.wreckDrag;
   }

   _routeEvents() {
      for (const ev of this.net.drainEvents()) {
         this._events.push(ev);
         if (ev.kind === "ship") {
            if (ev.shipId === this.shipId) {
               if (ev.type === "mastLost") this.sim.player._dropMast(ev.mast, ev.cause || "shot");
               else if (ev.type === "cutAway" && this.sim.debris) this.sim.debris.cutTethers(this.sim.player.id);
            } else {
               const r = this.remotes.get(ev.shipId);
               if (r) r.onEvent(ev);
            }
         }
      }
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
      if (this.net) await this.net.leave();
      this.net = null;
   }
}
