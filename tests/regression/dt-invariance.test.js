// tests/regression/dt-invariance.test.js
//
// The promise of Phase 0B': the simulation depends EXCLUSIVELY on the step
// size, never on the call rate or the screen.
//
// Why this is the most important test of the whole rework: client prediction
// means the client runs inputs ahead of time, which the server later
// computes again. If the two do not arrive at the same result, the player
// sees a jolt on every server packet. The old loop called sim.step(dt) with
// the frame interval - so on a 144 Hz screen with different dt values than
// on a 60 Hz screen, and therefore with a different result.
import { BoatDynamics, Wind, SeaState, SIM_DT, getVessel, approach, RUDDER_TAU }
   from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("dt invariance");
const { ok, near, eq } = suite;

const VESSEL = getVessel("lydia");
const WIND = { dir: 20, speedKts: 16 };

/** A command sequence that is not random, but is not boring either. */
const rudderAt = (tick) => Math.sin(tick * 0.013) * 0.8 + Math.sin(tick * 0.071) * 0.2;

function sail(ticks, dt, commandsPerTick = 1) {
   const b = new BoatDynamics({ vessel: VESSEL, heading: 110, x: 0, z: 0 });
   const trace = [];
   for (let i = 0; i < ticks; i++) {
      // Multiple setRudder() calls per step: previously every single call
      // pulled the rudder further over (lerp 0.3 per call). Today it only
      // sets the command - smoothing happens exactly once, in step().
      for (let k = 0; k < commandsPerTick; k++) b.setRudder(rudderAt(i));
      b.step(dt, WIND);
      trace.push(b.heading, b.speed, b.heel, b.rudder, b.pos.x, b.pos.z);
   }
   return { b, sig: fingerprint(trace) };
}

suite.section("Rudder smoothing no longer depends on the call count");
{
   // This was the actual defect: Controls.read() smoothed with dt*8, and
   // BoatDynamics.setRudder() smoothed AGAIN with a fixed 0.3 PER CALL.
   const once = sail(600, SIM_DT, 1);
   const thrice = sail(600, SIM_DT, 3);
   const many = sail(600, SIM_DT, 17);
   eq(once.sig, thrice.sig, "one setRudder() per step == three");
   eq(once.sig, many.sig, "== seventeen");
   suite.note("previously every call pulled the rudder 30% further - calling three times moved it three times as far");
}

suite.section("Same step size, same result");
{
   eq(sail(900, SIM_DT).sig, sail(900, SIM_DT).sig, "computed twice, the same both times");
   const a = sail(900, SIM_DT).b;
   const b = sail(900, SIM_DT).b;
   near(a.pos.x, b.pos.x, 0, "the same position down to the last bit");
   near(a.heading, b.heading, 0, "the same heading");
}

suite.section("The smoother itself is analytically exact");
{
   // approach() is the core piece. If it is dt-invariant, so is the whole
   // input chain.
   const steps = (n, dt) => {
      let x = 0;
      for (let i = 0; i < n; i++) x = approach(x, 1, dt, RUDDER_TAU);
      return x;
   };
   near(steps(1, 0.5), steps(50, 0.01), 1e-12, "1 x 500 ms == 50 x 10 ms");
   near(steps(15, 1 / 30), steps(30, 1 / 60), 1e-12, "15 steps of 1/30 s == 30 of 1/60 s");
   near(steps(1, 1 / 30), 1 - Math.exp(-SIM_DT / RUDDER_TAU), 1e-15, "and matches the analytic solution");
}

suite.section("Wind is a pure function of simulation time");
{
   // The wind does not need to be transmitted at all: whoever is at the same
   // tick count sees the same wind.
   const run = (dt, n) => {
      const w = new Wind({ dir: 20, speed: 16, variability: 1 });
      let t = 0;
      const out = [];
      for (let i = 0; i < n; i++) { t += dt; w.update(dt, t); out.push(w.dir, w.speed); }
      return { w, sig: fingerprint(out) };
   };
   eq(run(SIM_DT, 600).sig, run(SIM_DT, 600).sig, "reproducible");
   // At the same game time it stands at the same point, no matter how finely it was computed.
   const coarse = run(SIM_DT, 600).w;      // 20 s in 600 steps
   const fine = run(SIM_DT / 4, 2400).w;   // 20 s in 2400 steps
   near(coarse.dir, fine.dir, 1e-9, "the same direction after 20 s");
   near(coarse.speed, fine.speed, 1e-9, "and the same strength");
}

suite.section("The sea state stays tied to the step size - deliberately");
{
   // SeaState integrates exponentially, so it is only APPROXIMATELY equal
   // across different step sizes. That is exactly why the state belongs in
   // the snapshot (SeaSync) and is never recomputed.
   const run = (dt, n) => {
      const s = new SeaState(12);
      for (let i = 0; i < n; i++) s.step(dt, 28, 20);
      return s;
   };
   const coarse = run(SIM_DT, 900);      // 30 s
   const fine = run(SIM_DT / 8, 7200);   // 30 s
   // seaWind integrates exp(-dt/tau) and is therefore practically
   // step-size-independent ...
   near(coarse.seaWind, fine.seaWind, 1e-9, "the trailing wind matches",
      Math.abs(coarse.seaWind - fine.seaWind).toExponential(2));
   // ... the wave phase, on the other hand, sums dt/sqrt(lambda), and lambda
   // depends on seaWind. It drifts apart across different step sizes.
   ok(coarse.phaseT !== fine.phaseT,
      "the wave phase drifts apart at a different step size",
      Math.abs(coarse.phaseT - fine.phaseT).toExponential(2) + " s");
   suite.note("this is exactly why the water state is part of the snapshot (SeaSync) and is never recomputed");
   eq(run(SIM_DT, 900).phaseT, run(SIM_DT, 900).phaseT, "exactly equal at the same step size");
}

suite.section("A slower machine computes the same thing, just later");
{
   // 900 steps stay 900 steps - whether they are worked off in 30 frames of
   // 30 each or 900 frames of one each changes nothing.
   const burst = (chunks) => {
      const b = new BoatDynamics({ vessel: VESSEL, heading: 110 });
      const trace = [];
      let tick = 0;
      for (const n of chunks) {
         for (let k = 0; k < n; k++) {
            b.setRudder(rudderAt(tick));
            b.step(SIM_DT, WIND);
            trace.push(b.heading, b.speed, b.pos.x, b.pos.z);
            tick++;
         }
      }
      return fingerprint(trace);
   };
   const smooth = burst(new Array(900).fill(1));         // 900 frames of 1 step
   const stuttering = burst(chunked(900));               // irregular blocks
   const chunky = burst(new Array(180).fill(5));         // 180 frames of 5 steps
   eq(smooth, stuttering, "smooth or stuttering - the same trace");
   eq(smooth, chunky, "and in blocks of five as well");
}

function chunked(total) {
   // Irregular blocks that sum to `total`.
   const out = [];
   let left = total;
   let i = 0;
   while (left > 0) {
      const n = Math.min(left, 1 + ((i * 7 + 3) % 5));
      out.push(n);
      left -= n;
      i++;
   }
   return out;
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
