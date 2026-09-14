// tests/regression/golden-trace.test.js
//
// Golden test: a pinned-down simulation run. The trace sits on disk as a
// fixture; if the run deviates from it, the simulation's behaviour has
// changed.
//
// This is deliberately coarse and deliberately inconvenient. It does not say
// WHAT is wrong - it only says that something has changed, and forces you to
// either explain the change or revert it. For a physics engine soon meant to
// run on two machines at once, that is exactly the point: silent drift is
// the most expensive kind of bug.
//
// Rewrite the fixture (only when the change is intentional):
//     node tests/regression/golden-trace.test.js --update
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
   BoatDynamics, DamageModel, Crew, SeaState, Wind, World, setActiveWorld,
   spawnSalvo, deriveRng, getVessel, AMMO, SIM_DT, shipPose,
} from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Golden trace");
const { ok, near, eq } = suite;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "golden-trace.json");
const UPDATE = process.argv.includes("--update");

const SEED = 1805;   // Trafalgar
const TICKS = 1800;  // one minute of game time

function goldenRun() {
   const world = setActiveWorld(new World(SEED));
   const wind = new Wind({ dir: 20, speed: 18, variability: 1 });
   const sea = new SeaState(18);
   const vessel = getVessel("lydia");
   const dyn = new BoatDynamics({ vessel, heading: 115, x: 0, z: 0 });
   const dmg = new DamageModel(vessel, { rng: deriveRng(SEED, "dmg") });
   const crew = new Crew(vessel, { rng: deriveRng(SEED, "crew") });
   const salvoRng = deriveRng(SEED, "salvo");

   const samples = [];
   let t = 0;
   for (let i = 0; i < TICKS; i++) {
      t += SIM_DT;
      wind.update(SIM_DT, t);
      sea.step(SIM_DT, wind.speed, wind.dir);

      dyn.setRudder(Math.sin(i * 0.011) * 0.6 + Math.cos(i * 0.003) * 0.3);
      if (i === 600) dyn.sailSet = 0.5;           // reef
      if (i === 1200) dyn.sailSet = 1;            // set sail again
      dyn.driveMul = dmg.driveFactor();
      dyn.rudderMul = dmg.rudderFactor();
      dyn.dragMul = 1 + 0.7 * dmg.flooding;
      dyn.heelBias = dmg.floodHeel();
      dyn.step(SIM_DT, { dir: wind.dir, speedKts: wind.speed });

      if (i % 90 === 45) {
         spawnSalvo({
            side: "STBD", ammo: "ball", muzzleCount: 13, readyCount: 12,
            spread: 0.32, gunnery: 1.1, rangeToTarget: 300, maxRange: 500,
         }, salvoRng);
         const res = dmg.applyHit({
            side: "PORT", s: (i % 400) / 400, y: 1.5 + (i % 9),
            ammo: AMMO.ball, lb: 18, range01: 0.25, freeboard: 5,
         });
         if (res) crew.hit(res.crew.n, res.crew.where);
      }
      dmg.stressRig(SIM_DT, { windKts: wind.speed, sailSet: dyn.sailSet, twa: dyn.twa });
      dmg.update(SIM_DT, { heel: dyn.heel, pump: crew.pumping() });
      crew.update(SIM_DT);

      // One sample every 30 ticks - one second of game time.
      if (i % 30 === 29) {
         const pose = shipPose({
            pos: dyn.pos, heading: dyn.heading, heel: dyn.heel,
            twaSigned: dyn.twaSigned, flooding: dmg.flooding,
            recoilRoll: 0, hull: vessel.hull,
         }, sea.sampler(0.9));
         samples.push({
            tick: i + 1,
            x: r(dyn.pos.x), z: r(dyn.pos.z), heading: r(dyn.heading),
            speed: r(dyn.speed), heel: r(dyn.heel), rudder: r(dyn.rudder),
            seaWind: r(sea.seaWind), phaseT: r(sea.phaseT),
            poseY: r(pose.y), rollZ: r(pose.rollZ), pitchX: r(pose.pitchX),
            hull: r(dmg.integrity()), masts: dmg.mastsStanding(),
            rig: r(dmg.rigging), flooding: r(dmg.flooding), fit: crew.fit,
         });
      }
   }
   return {
      seed: SEED, ticks: TICKS,
      worldFeatures: world.features.length,
      worldSig: fingerprint(world.features.flatMap((f) => [f.x, f.z, f.r, f.h]), 9),
      samples,
      sig: fingerprint(samples.flatMap((s) => Object.values(s))),
   };
}

const r = (v) => Number(v.toFixed(6));

const actual = goldenRun();

if (UPDATE || !existsSync(FIXTURE)) {
   writeFileSync(FIXTURE, JSON.stringify(actual, null, 1) + "\n");
   console.log((UPDATE ? "  Fixture rewritten: " : "  Fixture created: ") + FIXTURE);
}

const golden = JSON.parse(readFileSync(FIXTURE, "utf8"));

suite.section("The fixture is internally consistent");
// Otherwise a hand-edited fixture would go unnoticed: the signature is
// recomputed from the samples and must match the one stored next to them.
{
   const recomputed = fingerprint(golden.samples.flatMap((s) => Object.values(s)));
   eq(recomputed, golden.sig,
      "the stored signature matches the stored samples",
      recomputed === golden.sig ? golden.sig : golden.sig + " != " + recomputed);
}

suite.section("The trace matches the fixture");
eq(actual.seed, golden.seed, "the same seed");
eq(actual.ticks, golden.ticks, "the same length");
eq(actual.worldSig, golden.worldSig, "the same chart", actual.worldSig);
eq(actual.samples.length, golden.samples.length, "the same number of samples");

if (actual.sig === golden.sig) {
   ok(true, "the entire trace is unchanged", actual.sig);
} else {
   ok(false, "the trace has changed", golden.sig + " -> " + actual.sig);
   // Name the first deviation - otherwise you're searching through 60 samples.
   const n = Math.min(actual.samples.length, golden.samples.length);
   outer: for (let i = 0; i < n; i++) {
      for (const k of Object.keys(golden.samples[i])) {
         const a = actual.samples[i][k];
         const b = golden.samples[i][k];
         if (a !== b) {
            suite.note(`first deviation at tick ${golden.samples[i].tick}, field "${k}": ${b} -> ${a}`);
            break outer;
         }
      }
   }
   suite.note("Was the change intentional? Then run: node tests/regression/golden-trace.test.js --update");
}

suite.section("The run is internally plausible");
{
   const last = actual.samples[actual.samples.length - 1];
   ok(actual.samples.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)),
      "position stays finite");
   ok(actual.samples.every((s) => s.speed >= 0 && s.speed < 25), "speed stays plausible",
      "max " + Math.max(...actual.samples.map((s) => s.speed)).toFixed(1) + " kn");
   ok(actual.samples.every((s) => Math.abs(s.heel) < 90), "she does not capsize");
   ok(actual.samples.every((s) => s.hull >= 0 && s.hull <= 1), "hull condition stays normalized");
   ok(actual.samples.every((s) => Math.abs(s.rudder) <= 1), "rudder angle stays within its stops");
   ok(actual.samples.every((s) => Math.abs(s.pitchX) <= 0.18 + 1e-9), "pitch stays capped");
   ok(last.fit <= actual.samples[0].fit, "the crew never grows");
   ok(last.seaWind > 17 && last.seaWind < 20, "sea state tracks the wind",
      last.seaWind.toFixed(2) + " kn");
   // Reefing at tick 600 must be visible.
   const before = actual.samples.find((s) => s.tick === 600);
   const after = actual.samples.find((s) => s.tick === 1050);
   ok(after.speed < before.speed, "after reefing she runs slower",
      before.speed.toFixed(2) + " -> " + after.speed.toFixed(2) + " kn");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
