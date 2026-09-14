// tests/unit/timestep.test.js - accumulator for "fixed simulation, free rendering".
import { Accumulator, SIM_DT, SIM_HZ, MAX_STEPS_PER_FRAME } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("timestep");
const { ok, near, eq } = suite;

suite.section("Constants");
eq(SIM_HZ, 30, "simulation runs at 30 Hz");
near(SIM_DT, 1 / 30, 1e-15, "SIM_DT is the reciprocal");
ok(MAX_STEPS_PER_FRAME >= 2, "at least two steps per frame can be caught up");

suite.section("Basic behaviour");
{
   const acc = new Accumulator(SIM_DT);
   eq(acc.advance(1000), 0, "the very first call only sets the time base");
   eq(acc.advance(1000), 0, "no time elapsed, no step");
   // Exactly one dt: this must be a step, even if (now-last)/1000 lands a
   // bit under SIM_DT in floating point.
   eq(acc.advance(1000 + 1000 / 30), 1, "after exactly one dt: one step");
   eq(acc.advance(1000 + 1000 / 30 + 5), 0, "5 ms later, still no second one");
   ok(acc.alpha > 0 && acc.alpha < 1, "alpha lies in between", acc.alpha.toFixed(3));
}

suite.section("No time is lost");
{
   // 60 frames of 16.67 ms are 1 s of game time - so exactly 30 steps,
   // no matter how they fall across the frames.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let steps = 0;
   for (let f = 1; f <= 60; f++) steps += acc.advance((f * 1000) / 60);
   eq(steps, 30, "60 frames of 16.7 ms give 30 steps");

   // The same at 144 Hz.
   const acc2 = new Accumulator(SIM_DT);
   acc2.reset(0);
   let steps2 = 0;
   for (let f = 1; f <= 144; f++) steps2 += acc2.advance((f * 1000) / 144);
   eq(steps2, 30, "144 frames of 6.9 ms also give 30 steps");

   // And at a frame rate BELOW the simulation rate.
   const acc3 = new Accumulator(SIM_DT);
   acc3.reset(0);
   let steps3 = 0;
   for (let f = 1; f <= 20; f++) steps3 += acc3.advance((f * 1000) / 20);
   eq(steps3, 30, "20 frames of 50 ms also give 30 steps");
}

suite.section("alpha");
{
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let ms = 1000 / 30 / 2;
   acc.advance(ms); // half a dt
   near(acc.alpha, 0.5, 1e-6, "half a dt -> alpha 0.5");
   ms += 1000 / 30; // another full dt (timestamps are absolute)
   acc.advance(ms);
   near(acc.alpha, 0.5, 1e-6, "alpha stays the remainder, not the sum");
   ok(acc.alpha >= 0 && acc.alpha < 1, "alpha is always in [0, 1)");
}

suite.section("The death spiral is throttled");
{
   // A machine that can't keep up with the simulation must not try to
   // catch up the backlog with ever more steps - that only makes it worse.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   const steps = acc.advance(900); // 0.9 s in one go = 27 steps owed
   eq(steps, MAX_STEPS_PER_FRAME, "never more than MAX_STEPS_PER_FRAME per frame");
   ok(acc.dropped > 0, "the remainder is discarded, not stacked up", acc.dropped + " steps");
   ok(acc.alpha >= 0 && acc.alpha < 1, "alpha stays valid");
}

suite.section("Time jumps");
{
   const acc = new Accumulator(SIM_DT);
   acc.reset(1000);
   eq(acc.advance(500), 0, "a clock running backwards produces no steps");
   eq(acc.advance(500 + 60000), 0, "a jump of over a second is discarded (sleeping tab)");
   acc.reset(0);
   eq(acc.advance(1000 / 30), 1, "after reset() it runs normally again");
}

suite.section("Fixed step size");
{
   // The actual guarantee: every step is exactly SIM_DT long. The
   // accumulator only ever returns a COUNT, never a remainder.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let simTime = 0;
   let wall = 0;
   const frames = [7, 23, 4, 51, 16, 16, 9, 33, 12, 40]; // irregular frames
   for (const ms of frames) {
      wall += ms;
      simTime += acc.advance(wall) * SIM_DT;
   }
   const drift = wall / 1000 - simTime;
   ok(drift >= 0 && drift < SIM_DT, "simulation time lags behind by at most one dt",
      (drift * 1000).toFixed(1) + " ms");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
