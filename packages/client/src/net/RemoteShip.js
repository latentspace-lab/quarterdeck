// RemoteShip.js - another player's (or the server's AI's) ship on this screen.
//
// A client Ship whose dynamics are never stepped here: the server owns them.
// Each patch is pushed into a SnapshotBuffer; every frame the ship is drawn
// at the interpolated state a little in the past. Damage arrives two ways -
// as values in the state (flooding, struck, sunk, fire) and as events (a
// mast goes over the side, the wreck is cut away), which drive the same
// visual machinery the single-player game uses.

import { Ship } from "../ship.js";
import { getVessel } from "../vessels.js";
import { shipPose, SIM_DT, lerp, clamp } from "@segel/shared";
import { SnapshotBuffer } from "./Interpolator.js";

export class RemoteShip {
   /**
    * @param {object} o
    * @param {string} o.id           server ship id
    * @param {string} o.vesselId
    * @param {string} [o.name]
    * @param {boolean} [o.ai]
    * @param {object} o.scene        scene API (add/remove)
    * @param {object} [o.debris]     DebrisField for falling masts
    * @param {number} [o.delay]      interpolation delay (ms)
    */
   constructor(o) {
      this.id = o.id;
      this.vesselId = o.vesselId;
      this.name = o.name || getVessel(o.vesselId).name;
      this.ai = !!o.ai;
      this.ship = new Ship({
         id: o.id,
         name: this.name,
         vessel: getVessel(o.vesselId),
         scene: o.scene,
         debris: o.debris || null,
         targets: () => [],
         sound: false,
         isPlayer: false,
      });
      this.buffer = new SnapshotBuffer({ delay: o.delay ?? 100 });
      this.sinkTimer = 0;
      this._lastMasts = 3;
      this._lastVisual = "";
   }

   get pos() {
      return this.ship.pos;
   }
   get model() {
      return this.ship.model;
   }
   /** Newest server state, or null. */
   get latest() {
      return this.buffer.latest;
   }

   /** A state patch arrived. `t` in ms. */
   push(state, t) {
      this.buffer.push(state, t);
   }

   /** A server event about this ship. */
   onEvent(ev) {
      const sh = this.ship;
      if (ev.type === "mastLost") {
         sh._dropMast(ev.mast, ev.cause || "shot");
      } else if (ev.type === "cutAway") {
         if (sh.debris) sh.debris.cutTethers(sh.id);
      } else if (ev.type === "sunk" || ev.type === "exploded") {
         sh.dmg.sunk = true;
         sh._syncAppearance();
      } else if (ev.type === "struck") {
         sh.dmg.struck = true;
         sh._syncAppearance();
      }
   }

   /**
    * Draw the ship as of `now` (ms). `ctx` is the Simulator's world context
    * for this frame: { wind, t, waveT, waveRad, amp, lambda, seaFull }.
    */
   render(now, ctx, frameDt = SIM_DT) {
      const s = this.buffer.sample(now);
      if (!s) return;
      const sh = this.ship;
      const dyn = sh.dyn;

      // The interpolated state IS the dynamics here - written, never stepped.
      dyn.pos.x = s.x;
      dyn.pos.z = s.z;
      dyn.heading = s.heading;
      dyn.groundHeading = s.heading;
      dyn.speed = s.speed;
      dyn.heel = s.heel;
      dyn.heelLerp = s.heel;
      dyn.sailSet = s.sailSet;
      dyn.rudder = s.rudder;
      dyn.rudderCmd = s.rudder;
      dyn.twaSigned = s.twa;
      dyn.twa = Math.abs(s.twa);
      dyn.tack = s.tack;
      dyn.luffing = !!s.luffing;
      dyn.isCapsized = !!s.isCapsized;
      dyn.driveMul = s.driveMul;
      dyn.stopped = !!s.stopped;

      const D = sh.dmg;
      D.flooding = s.flooding;
      D.afire = s.afire;
      D.struck = !!s.struck;
      D.sunk = !!s.sunk;
      sh.wreckDrag = s.wreckDrag;
      sh.alive = !!s.alive;
      const visual = `${D.struck}|${D.afire > 0.02}|${D.sunk}`;
      if (visual !== this._lastVisual) {
         this._lastVisual = visual;
         sh._syncAppearance();
      }

      if (D.sunk) {
         this.sinkTimer += frameDt;
         sh.sinkTimer = this.sinkTimer;
         sh._sinkStep(frameDt, ctx);
         if (this.sinkTimer > 16) sh.model.visible = false;
         return;
      }

      // Recoil roll is not in the state; it decays on its own here.
      sh.recoilRoll = lerp(sh.recoilRoll, 0, clamp(frameDt * 9, 0, 1));
      const pose = shipPose(
         {
            pos: dyn.pos,
            heading: dyn.heading,
            heel: dyn.heel,
            twaSigned: dyn.twaSigned,
            flooding: D.flooding,
            recoilRoll: sh.recoilRoll,
            hull: sh.vessel.hull,
         },
         ctx.seaFull,
      );
      sh._applyPoseExact(pose, dyn.pos);
      sh.animate(frameDt, ctx);
      sh.updateCrewView(frameDt, { ...ctx, crewLod: ctx.crewLod });
   }

   dispose() {
      if (this.ship.debris) this.ship.debris.cutTethers(this.id);
      this.ship.dispose();
   }
}
