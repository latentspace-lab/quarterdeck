// tests/pending/balance.test.js - OPEN BALANCE QUESTIONS
//
// These cases used to be assertions in the regular suite and were always red
// there (on main too). They do not claim an IS, but a SHOULD that the
// simulation currently does not reach. Whether the SHOULD or the model needs
// to change is a design decision - that is why they live here and not in the
// standard suite.
//
// Run:  node tests/run.js --pending
import * as THREE from "three";
import { DamageModel, AMMO } from "../../packages/client/src/damage.js";
import { getVessel } from "../../packages/client/src/vessels.js";
import { makeRng } from "@quarterdeck/shared";
import { Ship } from "../../packages/client/src/ship.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import { Captain } from "../../packages/client/src/fleet.js";
import { seaHeight, ampForWind } from "../../packages/client/src/ocean.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Balance (open)");
const { ok } = suite;

const LY = getVessel("lydia");

suite.section("1) Does a broadside hit hard enough?");
{
   // Hull damage per hit: dmg = (lb/18) * reach * ammo.hull * 0.03 / scantling
   // For the Lydia (scantling 0.82) that is exactly 0.015625 fighting power
   // per round shot at 0.25 range - independent of randomness.
   const pound = (n) => {
      const rng = makeRng(1);
      const d = new DamageModel(LY, { rng });
      for (let i = 0; i < n; i++) {
         d.applyHit({ side: "STBD", s: 0.15 + rng() * 0.7, y: 2.6,
            ammo: AMMO.ball, lb: 18, range01: 0.25, freeboard: 4.3 });
      }
      return d;
   };
   const eight = pound(8).integrity();
   const twenty = pound(20).integrity();
   suite.note(`measured: 8 hits -> ${eight.toFixed(4)}, 20 hits -> ${twenty.toFixed(4)}`);
   ok(eight < 0.85, "SHOULD: one broadside (8 hits) costs roughly a quarter",
      "is " + eight.toFixed(3));
   ok(twenty < 0.40, "SHOULD: two and a half broadsides (20 hits) put her out of the fight",
      "is " + twenty.toFixed(3));
   suite.note("To hit the SHOULD, the factor 0.055 in damage.ts would need to rise to about 0.11");
   suite.note("- or the cases describe a battle with more than 8 hits per broadside.");
}

suite.section("2) Do the captains close to fighting range?");
{
   // Captain.engage is the desired fighting range. The manoeuvring part does
   // not hold it: both stay well outside.
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 400 });
   const all = [];
   const targets = () => all.map((s) => s.targetInfo());
   const onHit = (h) => h.target.ship.takeHit(h);
   const mk = (id, x, z, hd) => {
      const s = new Ship({ vessel: getVessel(id), scene, debris, targets, onHit, sound: false });
      s.place(x, z, hd, 5); all.push(s); return s;
   };
   const A = mk("lydia", 0, 0, 90);
   const B = mk("amelie", 300, 90, 270);
   const ENGAGE_A = 160;
   const capA = new Captain(A, { doctrine: "hull", skill: 1.0, engage: ENGAGE_A });
   const capB = new Captain(B, { doctrine: "rig", skill: 0.85, engage: 220 });
   const wind = { dir: 20, speedKts: 16 };
   const amp = ampForWind(wind.speedKts), waveRad = Math.PI;
   let t = 0; const dt = 1 / 30;
   let minDist = Infinity;
   while (t < 1200 && !A.dmg.struck && !B.dmg.struck && !A.dmg.sunk && !B.dmg.sunk) {
      const gunCtx = { windDir: wind.dir, windSpeed: wind.speedKts,
         seaHeight: (x, z) => seaHeight(x, z, t, waveRad, amp) * 0.9 };
      const ctx = { wind, t, waveRad, amp, gunCtx };
      capA.update(dt, { wind, target: B }); capB.update(dt, { wind, target: A });
      A.update(dt, ctx); B.update(dt, ctx);
      A.battery.update(dt, gunCtx); B.battery.update(dt, gunCtx);
      minDist = Math.min(minDist, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
      t += dt;
   }
   suite.note(`measured: closest distance ${minDist.toFixed(0)} m at engage ${ENGAGE_A} m, duration ${t.toFixed(0)} s`);
   ok(minDist < ENGAGE_A * 1.35, "SHOULD: the captains close to fighting range",
      minDist.toFixed(0) + " m");
   ok(t < 1200, "SHOULD: the battle is decided within 20 minutes", t.toFixed(0) + " s");
   suite.note("Captain._steer() does not hold the range - starting point: fleet.js line ~91/94");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
