// Interpolator.js - render remote ships a little in the past, smoothly.
//
// The server publishes a ship's state 30 times a second; a screen draws 60
// or 144 times a second and packets do not arrive on a metronome. Drawing
// the latest state as it comes in would stutter. Instead each remote ship
// keeps a short history of states and is drawn `delay` milliseconds behind
// the newest one, interpolated between the two states that bracket that
// moment. This is the standard technique of networked games: never
// extrapolate, never jump, pay a fixed small latency for it.

import { shortestAngle } from "@segel/shared";

/** Fields that are angles in degrees and must wrap the short way. */
const ANGLE_FIELDS = new Set(["heading", "twa"]);
/** Fields that are not blended: booleans, strings, counters. */
const STEP_FIELDS = new Set([
   "id", "vesselId", "name", "ai", "disconnected", "tack", "luffing", "isCapsized",
   "alive", "struck", "sunk", "stopped", "mastsStanding", "ammo", "lastSeq",
]);

const DEG = Math.PI / 180;

/** Blend two headings in degrees along the short arc. */
export function lerpAngleDeg(a, b, t) {
   const d = shortestAngle(a * DEG, b * DEG) / DEG;
   return ((a + d * t) % 360 + 360) % 360;
}

export class SnapshotBuffer {
   /**
    * @param {object} [opts]
    * @param {number} [opts.delay=100]   render this many ms behind the newest state
    * @param {number} [opts.keep=1000]   drop states older than this (ms)
    */
   constructor(opts = {}) {
      this.delay = opts.delay ?? 100;
      this.keep = opts.keep ?? 1000;
      /** @type {Array<{t:number, s:object}>} */
      this.buf = [];
   }

   get size() {
      return this.buf.length;
   }

   /** Newest state pushed, or null. */
   get latest() {
      return this.buf.length ? this.buf[this.buf.length - 1].s : null;
   }

   /** Record a state as of time `t` (ms). Copies the fields it is given. */
   push(state, t) {
      const s = {};
      for (const k in state) {
         const v = state[k];
         if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") s[k] = v;
      }
      // Out-of-order arrivals are dropped rather than sorted: with a 100 ms
      // delay they would be drawn from the past anyway.
      if (this.buf.length && t <= this.buf[this.buf.length - 1].t) return;
      this.buf.push({ t, s });
      const cutoff = t - this.keep;
      while (this.buf.length > 2 && this.buf[0].t < cutoff) this.buf.shift();
   }

   /**
    * The state to draw at time `now` (ms), i.e. as of `now - delay`.
    * Returns null until anything was pushed; holds the newest state when the
    * render time runs ahead of the buffer (never extrapolates).
    */
   sample(now) {
      const n = this.buf.length;
      if (!n) return null;
      const t = now - this.delay;
      if (t <= this.buf[0].t) return this.buf[0].s;
      if (t >= this.buf[n - 1].t) return this.buf[n - 1].s;
      let i = n - 1;
      while (i > 0 && this.buf[i - 1].t > t) i--;
      const a = this.buf[i - 1];
      const b = this.buf[i];
      const u = (t - a.t) / Math.max(b.t - a.t, 1e-6);
      return blend(a.s, b.s, u);
   }
}

/** Blend two states; angles the short way, step fields from the later one. */
export function blend(a, b, u) {
   const out = {};
   for (const k in b) {
      const vb = b[k];
      const va = a[k];
      if (STEP_FIELDS.has(k) || typeof vb !== "number" || typeof va !== "number") {
         out[k] = vb;
      } else if (ANGLE_FIELDS.has(k)) {
         out[k] = lerpAngleDeg(va, vb, u);
      } else {
         out[k] = va + (vb - va) * u;
      }
   }
   return out;
}
