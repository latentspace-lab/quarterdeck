// tests/physics.test.js - Assert-Tests fuer das Segelphysik-Modell
// Ausfuehren:  node tests/physics.test.js    (reines Node, kein npm)
import {
    BoatDynamics,
    twa,
    apparentWind,
    polarSpeedAt,
    vmgUp,
    vmgDown,
    isLuffing,
    pointOfSail,
} from "../src/physics.js";
import { normDeg, diffDeg } from "../src/utils.js";

let pass = 0;
let fail = 0;
function ok(cond, msg) {
   if (cond) {
      pass++;
      console.log("  ok    " + msg);
    } else {
      fail++;
      console.error("  FAIL  " + msg);
    }
}
function approx(a, b, eps) {
   return Math.abs(a - b) < eps;
}

console.log("== Physik-Tests ==\n");

// 1. TWA-Vorzeichen
const twaPort = twa(90, 0);
ok(twaPort < 0, "Kurs Ost / Wind N   => TWA negativ (Port)   [" + twaPort.toFixed(1) + "]");
const twaStbd = twa(270, 0);
ok(twaStbd > 0, "Kurs West / Wind N  => TWA positiv   (Stbd) [" + twaStbd.toFixed(1) + "]");

// 2. Apparent Wind
const aw = apparentWind(0, 12, 90, 6);
ok(aw.speed > 6, "AwA-Speed > Boots-Speed (Winkelmischung)   [" + aw.speed.toFixed(1) + " kn]");
ok(aw.from > 0 && aw.from < 90, "AwA-From zwischen 0 und 90   [" + aw.from.toFixed(1) + "]");
console.log("   AwA: " + aw.speed.toFixed(1) + " kn von " + aw.from.toFixed(1));

// 3. Polar-Kurve
const beam = polarSpeedAt(90, 15, 1, 1);
const close = polarSpeedAt(45, 15, 1, 1);
ok(beam > close, "Beam-Reach (90 grad) schneller als Krausen (45)   [" + close.toFixed(1) + " < " + beam.toFixed(1) + " kn]");

// 4. No-Go-Zone / Luffen
ok(isLuffing(20, 12) === true, "20 TWA lufft (No-Go-Zone)");
ok(isLuffing(90, 12) === false, "90 TWA lufft nicht");
ok(isLuffing(0, 12) === true, "0 TWA lufft");
ok(isLuffing(45, 0.1) === true, "0.1 kn Wind: lufft (zu wenig)");

// 5. Bestes VMG
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
ok(bestUpT >= 38 && bestUpT <= 52, "Best-Upwind-TWA ~45 (gemessen " + bestUpT + ")");
ok(bestDnT >= 115 && bestDnT <= 165, "Best-Downwind-TWA ~140 (gemessen " + bestDnT + ")");
console.log("   Best-Upwind-TWA=" + bestUpT + "  VMG=" + bestUp.toFixed(1));
console.log("   Best-Downwind-TWA=" + bestDnT + "  VMG=" + bestDn.toFixed(1));

// 6. Boot baut Speed auf
const boat = new BoatDynamics({ heading: 45, x: 0, z: 0 });
const wind = { dir: 0, speedKts: 12 };
let anySpeed = false;
for (let i = 0; i < 200; i++) {
   boat.snapRudder(0);
   boat.step(0.1, wind);
   if (boat.speed > 3) anySpeed = true;
}
ok(anySpeed, "Boot baut bei 45/12kn Speed auf");
ok(boat.speed > polarSpeedAt(45, 12, 1, 1) * 0.8, "Boots-Speed nahe Polar (gemessen " + boat.speed.toFixed(1) + ")");
console.log(
   "   Nach 20s: Speed=" + boat.speed.toFixed(2) + " kn, Gier=" + boat.heel.toFixed(1) + ", luffing=" + boat.luffing
);

// 7. Kenter
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
ok(capped || boatHeavy.heelMaxSeen > 30, "Kenter/Gier bei extremem Wind (32 kn @50)");
console.log("   Kenter:", capped ? "JA" : "NEIN", "| max Gier=" + boatHeavy.heelMaxSeen.toFixed(1));

// 8. Hilfsfunktionen
ok(approx(normDeg(-10), 350, 1e-3), "normDeg(-10) = 350");
ok(approx(diffDeg(350, 10), 20, 1e-3), "diffDeg(350,10) = 20");
ok(approx(diffDeg(10, 350), -20, 1e-3), "diffDeg(10,350) = -20");

// 9. Point of Sail
ok(pointOfSail(45, false) === "Krausen (Close-Hauled)", "PoS @45 = Krausen");
ok(pointOfSail(20, false) === "No-Go-Zone (Backen)", "PoS @20 = No-Go");
ok(pointOfSail(180, false).startsWith("Vor dem Wind"), "PoS @180 = Vor dem Wind");

console.log("\n=== " + pass + " bestanden, " + fail + " gescheitert ===");
process.exit(fail === 0 ? 0 : 1);
