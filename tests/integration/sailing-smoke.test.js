// tests/sim.smoke.js - Integrations-Smoke: Physikalische Simulationen + Trainer-Logik
// Ausfuehren:  node tests/sim.smoke.js
import { BoatDynamics } from "../../packages/client/src/physics.js";
import { Wind } from "../../packages/client/src/wind.js";
import { makeTrainer } from "../../packages/client/src/trainer.js";
import { normDeg } from "../../packages/client/src/utils.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Segeln ueber Zeit");
const ok = suite.ok;
const section = (t) => suite.section(t);


console.log("== Simulation-Smoke ==\n");

// 1) Upwind-Tackwechsel: Tackwechsel (Stbd->Port) wird waehrend des Wendens beobachtet
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
   ok(flipped, "Tackwechsel STBD->PORT wird beobachtet (-> " + sawOther + ")");
   console.log("   End-TWA " + boat.twaSigned.toFixed(1) + " Tack " + boat.tack);
}

// 2) Speed-Aufbau auf dem Krausen-Kurs (Upwind): Boot erreicht > 3,5 kn
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
   ok(maxSpeed > 3.5, "Boot gewinnt auf 45 TWA Speed (" + maxSpeed.toFixed(1) + " kn max)");
   ok(!boat.isCapsized, "kein Kenter bei 14 kn auf 45 TWA");
}

// 3) Kenter bei sehr starkem Wind (30 kn bei 50 TWA)
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
   ok(capped, "Kenter bei 30 kn / Giermax " + boat.heelMaxSeen.toFixed(1) + "°");
   if (capped) {
      for (let i = 0; i < 40; i++) boat.step(0.1, { dir: 0, speedKts: 14 });
      ok(!boat.isCapsized, "Boot richtet sich automatisch nach ~3 s auf");
    }
}

// 4) Trainer: Edge-Detection (Tackwechsel) mit synthetischen Boot-Zustaenden
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
   ok(done, "Trainer: Tackwechsel-Herausforderung (Edge-Detection) funktioniert");
}

// 5) Wind-Schwankungen (Gusts + Veer)
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
   ok(hi > 13.5, "Gust: Staerke-Anstieg (max " + hi.toFixed(1) + " kn)");
   ok(lo < 10.5, "Gust: Staerke-Abfall (min " + lo.toFixed(1) + " kn)");
   ok(maxDir > 1, "Veer: Richtungswandlung (max " + maxDir.toFixed(1) + "°)");
}

// 6) Wind ohne Gusts (variability=0) bleibt stabil
{
   const w = new Wind({ dir: 30, speed: 9, variability: 0 });
   let lo = 999;
   let hi = -1;
   for (let i = 0; i < 300; i++) {
      w.update(0.033, i * 0.033);
      lo = Math.min(lo, w.speed);
      hi = Math.max(hi, w.speed);
   }
   ok(Math.abs(hi - 9) < 0.01 && Math.abs(lo - 9) < 0.01, "Wind ohne Gusts bleibt bei 9 kn");
}


export default () => suite.done();

// Direkt aufgerufen (`node tests/<datei>`) gibt die Suite ihre eigene
// Zusammenfassung aus; unter dem Runner uebernimmt das der Runner.
if (!process.env.SEGEL_TEST_RUNNER) suite.done();
