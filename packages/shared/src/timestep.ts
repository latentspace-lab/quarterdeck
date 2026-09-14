// timestep.ts - fixed simulation rate.
//
// Why this exists at all:
//
// The physics contains smoothing terms in several places of the form
// `x += (target - x) * f(dt)`. Such terms are only exactly reproducible
// when dt is constant - `f(dt1) then f(dt2)` is not the same as
// `f(dt1 + dt2)`. Client prediction, however, demands exactly that: the
// client recomputes the same inputs the server has already computed and
// must arrive at the same result. So: simulate with a fixed step, render at
// screen rate, and interpolate in between.
//
// 30 Hz is the compromise: fine enough for ballistics and hit testing,
// coarse enough that a server can carry multiple rooms.

/** Simulation step in seconds. Client and server use exactly this value. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/**
 * Maximum number of simulation steps per frame. Prevents the "death
 * spiral": if a machine can't keep up with the simulation anyway, it does
 * not try to catch up on the backlog with even more steps - instead, game
 * time visibly runs slower.
 */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Floating-point slack when counting off steps.
 *
 * Without it, the single most common case - frame rate equal to simulation
 * rate - is the most unpleasant one: `(now - last) / 1000` then lands a bit
 * above or a bit below dt, and the loop alternately yields 0 and 2 steps
 * instead of a steady 1. That shows up as a fine jitter. One nanosecond of
 * slack clears this up, without ever creating time that wasn't there.
 */
const STEP_EPS = 1e-9;

/**
 * Accumulator for the "fixed simulation, free rendering" loop.
 *
 *     const acc = new Accumulator();
 *     function frame(now) {
 *        for (let i = acc.advance(now); i > 0; i--) sim.stepFixed(SIM_DT);
 *        renderer.render(acc.alpha);
 *     }
 */
export class Accumulator {
   readonly dt: number;
   private acc = 0;
   private last = 0;
   private started = false;
   /** Remaining fraction of the current step (0..1) - the interpolation factor. */
   alpha = 0;
   /** Number of steps dropped on the last advance() call. */
   dropped = 0;

   constructor(dt: number = SIM_DT) {
      this.dt = dt;
   }

   /** Reset to a new time base (start, end of pause, tab switch). */
   reset(nowMs: number): void {
      this.last = nowMs;
      this.acc = 0;
      this.alpha = 0;
      this.dropped = 0;
      this.started = true;
   }

   /**
    * Book time up to `nowMs`. Returns the number of simulation steps due
    * and sets `alpha` for rendering.
    */
   advance(nowMs: number): number {
      if (!this.started) {
         this.reset(nowMs);
         return 0;
      }
      const elapsed = (nowMs - this.last) / 1000;
      this.last = nowMs;
      // A negative or absurd jump (system clock, a sleeping tab) must not
      // send the simulation into a catch-up spiral.
      this.acc += elapsed > 0 && elapsed < 1 ? elapsed : 0;

      let steps = Math.floor((this.acc + STEP_EPS) / this.dt);
      this.dropped = 0;
      if (steps > MAX_STEPS_PER_FRAME) {
         this.dropped = steps - MAX_STEPS_PER_FRAME;
         this.acc -= this.dropped * this.dt;
         steps = MAX_STEPS_PER_FRAME;
      }
      this.acc = Math.max(0, this.acc - steps * this.dt);
      this.alpha = this.acc / this.dt;
      return steps;
   }
}
