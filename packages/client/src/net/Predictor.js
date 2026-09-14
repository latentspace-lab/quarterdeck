// Predictor.js - client-side prediction with server reconciliation.
//
// The player's own ship must answer the helm now, not a round trip later. So
// the client steps its BoatDynamics locally with every input, and keeps the
// inputs it has sent. When the server acknowledges an input (ShipState.lastSeq
// is the last one it applied), the client loads a ghost from that
// authoritative state, replays every input the server has not seen yet, and
// takes the result as its new local state. Because both sides step the same
// physics at the same fixed dt with one input per tick, the ghost lands on the
// local prediction whenever nothing else touched the ship - and where
// something did (a collision, the ground, a damage change), the difference is
// the correction. The correction is handed back so the view can absorb it
// smoothly instead of jumping.

import { BoatDynamics, SIM_DT, clamp } from "@quarterdeck/shared";
import { lerpAngleDeg } from "./Interpolator.js";

/** Degrees, wrapped to [-180, 180). */
function angleDiff(a, b) {
   return ((b - a + 540) % 360) - 180;
}

export class Predictor {
   /**
    * @param {object} vessel
    * @param {object} [opts]
    * @param {number} [opts.snapDistance=8]  metres beyond which the view jumps instead of easing
    * @param {number} [opts.snapHeading=25]  degrees likewise
    * @param {number} [opts.maxHistory=90]   inputs kept while unacknowledged (3 s)
    */
   constructor(vessel, opts = {}) {
      this.ghost = new BoatDynamics({ vessel });
      this.history = [];
      this.acked = -1;
      this.snapDistance = opts.snapDistance ?? 8;
      this.snapHeading = opts.snapHeading ?? 25;
      this.maxHistory = opts.maxHistory ?? 90;
      /** last correction, for the HUD / tests */
      this.last = null;
      this.reconciled = 0;
   }

   /** Remember an input the local ship was stepped with (one per tick). */
   record(cmd) {
      this.history.push({ seq: cmd.seq, rudder: cmd.rudder, sailSet: cmd.sailSet });
      if (this.history.length > this.maxHistory) this.history.splice(0, this.history.length - this.maxHistory);
   }

   /** Inputs the server has not confirmed yet. */
   get pending() {
      return this.history.length;
   }

   /**
    * A server state for our ship arrived. If it acknowledges new inputs:
    * ghost <- state, replay the rest, local <- ghost. Returns the correction
    * the view should absorb ({ dx, dz, dyaw, dist, snapped }) or null when
    * there was nothing new to reconcile.
    */
   reconcile(s, local, wind) {
      if (!s || !Number.isFinite(s.lastSeq) || s.lastSeq === this.acked) return null;
      if (!Number.isFinite(s.x) || !Number.isFinite(s.heading)) return null;
      this.acked = s.lastSeq;

      // Drop what the server has applied.
      let i = 0;
      while (i < this.history.length && this.history[i].seq <= s.lastSeq) i++;
      if (i) this.history.splice(0, i);

      const g = this.ghost;
      Predictor.load(g, s);
      for (const h of this.history) {
         g.setRudder(h.rudder);
         if (h.sailSet !== undefined && h.sailSet !== null) g.sailSet = h.sailSet;
         g.step(SIM_DT, wind, null);
      }

      const dx = local.pos.x - g.pos.x;
      const dz = local.pos.z - g.pos.z;
      const dyaw = angleDiff(g.heading, local.heading);
      const dist = Math.hypot(dx, dz);
      const snapped = dist > this.snapDistance || Math.abs(dyaw) > this.snapHeading;

      Predictor.copy(g, local);
      this.reconciled++;
      this.last = { dx, dz, dyaw, dist, snapped, replayed: this.history.length };
      return this.last;
   }

   /** Load the dynamics from a ShipState (everything step() reads). */
   static load(d, s) {
      d.pos.x = s.x;
      d.pos.z = s.z;
      d.heading = s.heading;
      d.leeway = s.leeway ?? 0;
      const leeSign = s.twa > 0 ? -1 : 1;
      d.groundHeading = ((d.heading + d.leeway * leeSign) % 360 + 360) % 360;
      d.speed = s.speed;
      d.heelBias = s.heelBias ?? 0;
      d.heel = s.heel;
      d.heelLerp = s.heel - d.heelBias;
      d.rudder = s.rudder;
      d.rudderCmd = s.rudder;
      d.sailSet = s.sailSet;
      d.twaSigned = s.twa;
      d.twa = Math.abs(s.twa);
      d.tack = s.tack;
      d.luffing = !!s.luffing;
      d.isCapsized = !!s.isCapsized;
      d.driveMul = s.driveMul ?? 1;
      d.rudderMul = s.rudderMul ?? 1;
      d.dragMul = s.dragMul ?? 1;
      d.turnBias = s.turnBias ?? 0;
      d.stopped = !!s.stopped;
   }

   /** Copy the whole dynamic state from one BoatDynamics to another. */
   static copy(from, to) {
      to.pos.x = from.pos.x;
      to.pos.z = from.pos.z;
      to.heading = from.heading;
      to.groundHeading = from.groundHeading;
      to.leeway = from.leeway;
      to.speed = from.speed;
      to.heel = from.heel;
      to.heelLerp = from.heelLerp;
      to.heelBias = from.heelBias;
      to.rudder = from.rudder;
      to.rudderCmd = from.rudderCmd;
      to.sailSet = from.sailSet;
      to.twaSigned = from.twaSigned;
      to.twa = from.twa;
      to.tack = from.tack;
      to.luffing = from.luffing;
      to.isCapsized = from.isCapsized;
      to.capsizeTimer = from.capsizeTimer;
      to.boatVel.x = from.boatVel.x;
      to.boatVel.z = from.boatVel.z;
      to.driveMul = from.driveMul;
      to.rudderMul = from.rudderMul;
      to.dragMul = from.dragMul;
      to.turnBias = from.turnBias;
      to.stopped = from.stopped;
   }
}

/**
 * The view's share of a correction: an offset that is added to the drawn
 * position and decays, so a corrected ship glides onto its true place.
 */
export class ViewOffset {
   constructor(tau = 0.15) {
      this.x = 0;
      this.z = 0;
      this.yaw = 0;
      this.tau = tau;
   }
   /** The physics moved by (-dx, -dz, -dyaw); keep the picture where it was for now. */
   absorb(c) {
      if (!c || c.snapped) {
         this.x = this.z = this.yaw = 0;
         return;
      }
      this.x += c.dx;
      this.z += c.dz;
      this.yaw += c.dyaw;
   }
   step(dt) {
      const k = Math.exp(-dt / this.tau);
      this.x *= k;
      this.z *= k;
      this.yaw *= k;
      if (Math.abs(this.x) < 1e-4) this.x = 0;
      if (Math.abs(this.z) < 1e-4) this.z = 0;
      if (Math.abs(this.yaw) < 1e-4) this.yaw = 0;
   }
   get active() {
      return this.x !== 0 || this.z !== 0 || this.yaw !== 0;
   }
}

export { lerpAngleDeg, clamp };
