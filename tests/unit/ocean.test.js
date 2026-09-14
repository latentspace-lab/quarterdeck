// tests/unit/ocean.test.js - wave math and sea state.
import {
   WAVES, seaHeight, ampForWind, lambdaForWind, waveHeightForWind,
   whitecapsForWind, seaStateName, SeaState, SIM_DT,
} from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("ocean-math");
const { ok, near, eq } = suite;

suite.section("Wave table");
ok(WAVES.length >= 4, "several wave components", WAVES.length + " of them");
ok(WAVES.every((w) => w.a > 0 && w.L > 0 && w.q > 0), "all components physically sensible");
ok(WAVES.every((w, i, a) => i === 0 || w.a <= a[i - 1].a), "sorted descending by amplitude");

suite.section("Sea state from wind (Pierson-Moskowitz)");
eq(waveHeightForWind(0), 0, "calm: no wave");
ok(waveHeightForWind(30) > waveHeightForWind(12), "more wind, higher sea");
// Hs grows with the square of wind speed: double the wind -> quadruple the height
near(waveHeightForWind(20) / waveHeightForWind(10), 4, 0.02, "double the wind, quadruple the height");
ok(waveHeightForWind(200) <= 11.5 + 1e-9, "capped, so a hurricane doesn't turn into a tsunami",
   waveHeightForWind(200).toFixed(2) + " m");
ok(lambdaForWind(30) > lambdaForWind(12), "a storm sea has longer waves");
ok(lambdaForWind(30) / lambdaForWind(12) < waveHeightForWind(30) / waveHeightForWind(12),
   "length grows more slowly than height (the sea stays steep)");
eq(whitecapsForWind(5), 0, "below Bft 4, no whitecaps");
ok(whitecapsForWind(20) > 0 && whitecapsForWind(20) < 1, "partial in between");
eq(whitecapsForWind(60), 1, "fully covered in a storm");
eq(seaStateName(0), "calm", "Douglas scale: calm");
ok(seaStateName(40) === "high" || seaStateName(40) === "very high", "Douglas scale: heavy",
   seaStateName(40));

suite.section("seaHeight()");
{
   const amp = ampForWind(16);
   let finite = true;
   let maxAbs = 0;
   for (let i = 0; i < 400; i++) {
      const h = seaHeight(i * 7.3 - 900, i * -3.1 + 400, i * 0.11, 1.9, amp, lambdaForWind(16));
      if (!Number.isFinite(h)) finite = false;
      maxAbs = Math.max(maxAbs, Math.abs(h));
   }
   ok(finite, "finite everywhere");
   ok(maxAbs < waveHeightForWind(16) * 1.2, "stays within range of the significant height",
      maxAbs.toFixed(2) + " m at Hs " + waveHeightForWind(16).toFixed(2) + " m");
   eq(seaHeight(10, 20, 3, 1.0, 0.2, 1), seaHeight(10, 20, 3, 1.0, 0.2, 1), "pure (same input, same output)");
   ok(seaHeight(10, 20, 3, 1.0, 0.4, 1) !== seaHeight(10, 20, 3, 1.0, 0.2, 1), "reacts to the amplitude");
   ok(seaHeight(10, 20, 4, 1.0, 0.2, 1) !== seaHeight(10, 20, 3, 1.0, 0.2, 1), "runs forward with time");
   eq(seaHeight(0, 0, 0, Math.PI, 0, 1), 0, "amplitude 0 gives a flat mirror surface");
}

suite.section("SeaState: sea lag behind the wind");
{
   const s = new SeaState(12);
   eq(s.seaWind, 12, "starts at the initial wind");
   eq(s.phaseT, 0, "phase starts at 0");

   // Freshening: the sea follows, but slowly (tau 45 s).
   for (let i = 0; i < 30; i++) s.step(SIM_DT, 30, 0); // one second
   ok(s.seaWind > 12 && s.seaWind < 13, "after 1 s the sea has barely followed", s.seaWind.toFixed(3));
   for (let i = 0; i < 30 * 180; i++) s.step(SIM_DT, 30, 0); // three minutes
   near(s.seaWind, 30, 0.6, "after 3 min it is almost fully up with the wind", s.seaWind.toFixed(2));

   // Decay is slower than build-up (tau 95 s vs 45 s).
   const up = new SeaState(10);
   const down = new SeaState(30);
   for (let i = 0; i < 30 * 30; i++) { up.step(SIM_DT, 30, 0); down.step(SIM_DT, 10, 0); }
   const climbed = (up.seaWind - 10) / 20;
   const fell = (30 - down.seaWind) / 20;
   ok(climbed > fell, "a sea builds up faster than it dies down",
      (climbed * 100).toFixed(0) + " % vs " + (fell * 100).toFixed(0) + " %");
}

suite.section("SeaState: wave phase");
{
   const s = new SeaState(12);
   for (let i = 0; i < 30; i++) s.step(SIM_DT, 12, 0);
   ok(s.phaseT > 0 && s.phaseT < 1.2, "phase runs, but slower than the clock",
      s.phaseT.toFixed(3) + " s in 1.0 s");

   // Long waves run slower: more wind -> more lambda -> less phase.
   const calm = new SeaState(6);
   const storm = new SeaState(40);
   for (let i = 0; i < 300; i++) { calm.step(SIM_DT, 6, 0); storm.step(SIM_DT, 40, 0); }
   ok(storm.phaseT < calm.phaseT, "storm waves run slower through the phase",
      storm.phaseT.toFixed(2) + " vs " + calm.phaseT.toFixed(2));
}

suite.section("SeaState: determinism and transfer");
{
   const trace = (n) => {
      const s = new SeaState(12);
      const out = [];
      for (let i = 0; i < n; i++) {
         s.step(SIM_DT, 12 + Math.sin(i * 0.01) * 8, 20 + i * 0.02);
         out.push(s.seaWind, s.phaseT, s.heightAt(30, -12));
      }
      return out;
   };
   eq(fingerprint(trace(600)), fingerprint(trace(600)),
      "same input history, identical trace");

   // SeaSync: the transferred state must fully reconstruct the water
   // surface - otherwise client and server compute on different waves.
   const a = new SeaState(12);
   for (let i = 0; i < 500; i++) a.step(SIM_DT, 22, 47);
   const b = new SeaState(0);
   b.fromSync(a.toSync());
   b.windRad = a.windRad;
   near(b.heightAt(12.5, -33.25), a.heightAt(12.5, -33.25), 1e-12,
      "restored from SeaSync: same wave height");
   near(b.amp, a.amp, 1e-12, "same amplitude");
   near(b.lambda, a.lambda, 1e-12, "same stretch");

   const sam = a.sampler(0.9);
   near(sam(5, 5), a.heightAt(5, 5) * 0.9, 1e-12, "sampler() returns the scaled surface");
   // The sampler freezes the state - so all systems in a tick compute on
   // exactly the same surface, even though the sea keeps running afterward.
   const frozen = sam(5, 5);
   a.step(SIM_DT, 22, 47);
   near(sam(5, 5), frozen, 1e-12, "sampler() stays stable within the tick");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
