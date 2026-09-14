// tests/sim.smoke.js - integration smoke test: physics simulations + trainer logic
// Run:  node tests/sim.smoke.js
import { BoatDynamics } from "../../packages/client/src/physics.js";
import { Wind } from "../../packages/client/src/wind.js";
import { makeTrainer } from "../../packages/client/src/trainer.js";
import { normDeg } from "../../packages/client/src/utils.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Sailing over time");
const ok = suite.ok;
const section = (t) => suite.section(t);


console.log("== Simulation smoke ==\n");

// 1) Upwind tack change: the tack change (Stbd->Port) is observed during the tack
{
   const boat = new BoatDynamics({ heading: 315, autoTrim: true });
   const wind = { dir: 0, speedKts: 14 };
   let prevTack = "STBD";
   let sawOther = boat.tack;
   let flipped = false;
   for (let i = 0; i < 900; i++) {
      boat.snapRudder(i < 3 ? 0 : 1.0);
      boat.step(0.033, wind);
      boat.heading = normDeg(boat.heading);
      if (boat.tack !== prevTack) {
         flipped = true;
         sawOther = boat.tack;
         break;
      }
      prevTack = boat.tack;
    }
   ok(flipped, "the STBD->PORT tack change is observed (-> " + sawOther + ")");
   console.log("   final TWA " + boat.twaSigned.toFixed(1) + " tack " + boat.tack);
}

// 2) Speed build-up on a close-hauled course (upwind): boat reaches > 3.5 kn
{
   const boat = new BoatDynamics({ heading: 45, autoTrim: true });
   const wind = { dir: 0, speedKts: 14 };
   let maxSpeed = 0;
   for (let i = 0; i < 400; i++) {
      boat.snapRudder(0);
      boat.step(0.033, wind);
      boat.heading = normDeg(boat.heading);
      maxSpeed = Math.max(maxSpeed, boat.speed);
    }
   ok(maxSpeed > 3.5, "the boat picks up speed at 45 TWA (" + maxSpeed.toFixed(1) + " kn max)");
   ok(!boat.isCapsized, "no capsize at 14 kn on 45 TWA");
}

// 3) Capsize in very strong wind (30 kn at 50 TWA)
{
   const boat = new BoatDynamics({ heading: 50, capsizeHeel: 24, maxHeel: 28 });
   let capped = false;
   for (let i = 0; i < 600; i++) {
      boat.snapRudder(0);
      boat.step(0.05, { dir: 0, speedKts: 30 });
      boat.heading = normDeg(boat.heading);
      if (boat.isCapsized) {
         capped = true;
         break;
       }
    }
   ok(capped, "capsizes at 30 kn / max heel " + boat.heelMaxSeen.toFixed(1) + "°");
   if (capped) {
      for (let i = 0; i < 40; i++) boat.step(0.1, { dir: 0, speedKts: 14 });
      ok(!boat.isCapsized, "the boat rights itself automatically after ~3 s");
    }
}

// 4) Trainer: edge detection (tack change) with synthetic boat states
{
   const trainer = makeTrainer();
   let done = false;
   for (let s = 0; s < 400; s++) {
      const tack = s < 150 ? "PORT" : "STBD";
      const st = {
         boat: {
            twa: 45,
            twaSigned: tack === "STBD" ? -45 : 45,
            tack,
            luffing: false,
            speed: 5,
            capsize: false,
            heading: 0,
            pos: { x: 0, z: 0 },
          },
         wind: { dir: 0, speed: 14 },
         t: s * 0.033,
       };
      const r = trainer.update(st, 0.033);
      if (r.done) {
         done = true;
         break;
      }
   }
   ok(done, "trainer: the tack-change challenge (edge detection) works");
}

// 5) Wind fluctuations (gusts + veer)
{
   const w = new Wind({ dir: 10, speed: 12, gust: 0.5, veer: 0.6 });
   let lo = 999;
   let hi = -1;
   let maxDir = 0;
   for (let i = 0; i < 800; i++) {
      w.update(0.033, i * 0.033);
      lo = Math.min(lo, w.speed);
      hi = Math.max(hi, w.speed);
      maxDir = Math.max(maxDir, Math.abs((w.dir % 360) - 10));
   }
   ok(hi > 13.5, "gust: strength increase (max " + hi.toFixed(1) + " kn)");
   ok(lo < 10.5, "gust: strength drop (min " + lo.toFixed(1) + " kn)");
   ok(maxDir > 1, "veer: direction shift (max " + maxDir.toFixed(1) + "°)");
}

// 6) Wind without gusts (variability=0) stays steady
{
   const w = new Wind({ dir: 30, speed: 9, variability: 0 });
   let lo = 999;
   let hi = -1;
   for (let i = 0; i < 300; i++) {
      w.update(0.033, i * 0.033);
      lo = Math.min(lo, w.speed);
      hi = Math.max(hi, w.speed);
   }
   ok(Math.abs(hi - 9) < 0.01 && Math.abs(lo - 9) < 0.01, "wind without gusts stays at 9 kn");
}


export default () => suite.done();

// When run directly (`node tests/<file>`), the suite prints its own summary;
// under the runner, the runner takes care of that.
if (!process.env.SEGEL_TEST_RUNNER) suite.done();
