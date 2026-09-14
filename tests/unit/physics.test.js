// tests/physics.test.js - assertion tests for the sailing physics model
// Run:  node tests/physics.test.js    (plain Node, no npm)
import {
    BoatDynamics,
    twa,
    apparentWind,
    polarSpeedAt,
    vmgUp,
    vmgDown,
    isLuffing,
    pointOfSail,
} from "../../packages/client/src/physics.js";
import { normDeg, diffDeg } from "../../packages/client/src/utils.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("sailing physics");
const ok = suite.ok;
const section = (t) => suite.section(t);

function approx(a, b, eps) {
   return Math.abs(a - b) < eps;
}

console.log("== Physics tests ==\n");

// 1. TWA sign
const twaPort = twa(90, 0);
ok(twaPort < 0, "course east / wind N   => TWA negative (port)   [" + twaPort.toFixed(1) + "]");
const twaStbd = twa(270, 0);
ok(twaStbd > 0, "course west / wind N  => TWA positive  (stbd) [" + twaStbd.toFixed(1) + "]");

// 2. Apparent wind
const aw = apparentWind(0, 12, 90, 6);
ok(aw.speed > 6, "AWA speed > boat speed (vector mixing)   [" + aw.speed.toFixed(1) + " kn]");
ok(aw.from > 0 && aw.from < 90, "AWA-from between 0 and 90   [" + aw.from.toFixed(1) + "]");
console.log("   AWA: " + aw.speed.toFixed(1) + " kn from " + aw.from.toFixed(1));

// 3. Polar curve
const beam = polarSpeedAt(90, 15, 1, 1);
const close = polarSpeedAt(45, 15, 1, 1);
ok(beam > close, "beam reach (90 deg) faster than close-hauled (45)   [" + close.toFixed(1) + " < " + beam.toFixed(1) + " kn]");

// 4. No-go zone / luffing
ok(isLuffing(20, 12) === true, "20 TWA luffs (no-go zone)");
ok(isLuffing(90, 12) === false, "90 TWA does not luff");
ok(isLuffing(0, 12) === true, "0 TWA luffs");
ok(isLuffing(45, 0.1) === true, "0.1 kn wind: luffs (too little)");

// 5. Best VMG
let bestUp = 0;
let bestUpT = 0;
for (let t = 33; t <= 90; t++) {
   const m = vmgUp(t, polarSpeedAt(t, 15, 1, 1));
   if (m > bestUp) {
      bestUp = m;
      bestUpT = t;
    }
}
let bestDn = 0;
let bestDnT = 0;
for (let t = 91; t <= 180; t++) {
   const m = vmgDown(t, polarSpeedAt(t, 15, 1, 1));
   if (m > bestDn) {
      bestDn = m;
      bestDnT = t;
    }
}
ok(bestUpT >= 38 && bestUpT <= 52, "best upwind TWA ~45 (measured " + bestUpT + ")");
ok(bestDnT >= 115 && bestDnT <= 165, "best downwind TWA ~140 (measured " + bestDnT + ")");
console.log("   Best upwind TWA=" + bestUpT + "  VMG=" + bestUp.toFixed(1));
console.log("   Best downwind TWA=" + bestDnT + "  VMG=" + bestDn.toFixed(1));

// 6. Boat builds up speed
const boat = new BoatDynamics({ heading: 45, x: 0, z: 0 });
const wind = { dir: 0, speedKts: 12 };
let anySpeed = false;
for (let i = 0; i < 200; i++) {
   boat.snapRudder(0);
   boat.step(0.1, wind);
   if (boat.speed > 3) anySpeed = true;
}
ok(anySpeed, "boat builds up speed at 45/12kn");
ok(boat.speed > polarSpeedAt(45, 12, 1, 1) * 0.8, "boat speed close to polar (measured " + boat.speed.toFixed(1) + ")");
console.log(
   "   After 20s: speed=" + boat.speed.toFixed(2) + " kn, heel=" + boat.heel.toFixed(1) + ", luffing=" + boat.luffing
);

// 7. Capsize
const boatHeavy = new BoatDynamics({ heading: 50, capsizeHeel: 20 });
let capped = false;
for (let i = 0; i < 600; i++) {
   boatHeavy.snapRudder(0);
   boatHeavy.step(0.05, { dir: 0, speedKts: 32 });
   if (boatHeavy.isCapsized) {
      capped = true;
      break;
    }
}
ok(capped || boatHeavy.heelMaxSeen > 30, "capsize/heel under extreme wind (32 kn @50)");
console.log("   Capsized:", capped ? "YES" : "NO", "| max heel=" + boatHeavy.heelMaxSeen.toFixed(1));

// 8. Helper functions
ok(approx(normDeg(-10), 350, 1e-3), "normDeg(-10) = 350");
ok(approx(diffDeg(350, 10), 20, 1e-3), "diffDeg(350,10) = 20");
ok(approx(diffDeg(10, 350), -20, 1e-3), "diffDeg(10,350) = -20");

// 9. Point of sail
ok(pointOfSail(45, false) === "Close-Hauled", "PoS @45 = close-hauled");
ok(pointOfSail(20, false) === "No-Go Zone", "PoS @20 = no-go");
ok(pointOfSail(180, false).startsWith("Dead Run"), "PoS @180 = before the wind");


export default () => suite.done();

// Run directly (`node tests/<file>`), the suite prints its own summary;
// under the runner, the runner takes care of that.
if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
