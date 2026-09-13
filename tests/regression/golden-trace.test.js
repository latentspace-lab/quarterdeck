// tests/regression/golden-trace.test.js
//
// Golden-Test: ein festgeschriebener Simulationslauf. Die Spur liegt als
// Fixture auf der Platte; weicht der Lauf davon ab, hat sich das Verhalten der
// Simulation geaendert.
//
// Das ist absichtlich grob und absichtlich unbequem. Es sagt nicht, WAS falsch
// ist - es sagt nur, dass sich etwas geaendert hat, und zwingt dazu, die
// Aenderung entweder zu erklaeren oder zurueckzunehmen. Fuer eine Physik, die
// demnaechst auf zwei Rechnern gleichzeitig laufen soll, ist genau das der
// Punkt: stille Drift ist die teuerste Sorte Fehler.
//
// Fixture neu schreiben (nur, wenn die Aenderung gewollt ist):
//     node tests/regression/golden-trace.test.js --update
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
   BoatDynamics, DamageModel, Crew, SeaState, Wind, World, setActiveWorld,
   spawnSalvo, deriveRng, getVessel, AMMO, SIM_DT, shipPose,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Golden-Spur");
const { ok, near, eq } = suite;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "..", "fixtures", "golden-trace.json");
const UPDATE = process.argv.includes("--update");

const SEED = 1805;   // Trafalgar
const TICKS = 1800;  // eine Minute Spielzeit

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
      if (i === 600) dyn.sailSet = 0.5;           // reffen
      if (i === 1200) dyn.sailSet = 1;            // wieder setzen
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

      // Alle 30 Ticks eine Probe - eine Sekunde Spielzeit.
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
   console.log((UPDATE ? "  Fixture neu geschrieben: " : "  Fixture angelegt: ") + FIXTURE);
}

const golden = JSON.parse(readFileSync(FIXTURE, "utf8"));

suite.section("Die Fixture ist in sich schluessig");
// Sonst faellt eine von Hand verbogene Fixture nicht auf: die Signatur wird
// aus den Proben nachgerechnet und muss zu der passen, die danebensteht.
{
   const recomputed = fingerprint(golden.samples.flatMap((s) => Object.values(s)));
   eq(recomputed, golden.sig,
      "die gespeicherte Signatur passt zu den gespeicherten Proben",
      recomputed === golden.sig ? golden.sig : golden.sig + " != " + recomputed);
}

suite.section("Die Spur stimmt mit der Fixture ueberein");
eq(actual.seed, golden.seed, "derselbe Seed");
eq(actual.ticks, golden.ticks, "dieselbe Laenge");
eq(actual.worldSig, golden.worldSig, "dieselbe Seekarte", actual.worldSig);
eq(actual.samples.length, golden.samples.length, "gleich viele Proben");

if (actual.sig === golden.sig) {
   ok(true, "die gesamte Spur ist unveraendert", actual.sig);
} else {
   ok(false, "die Spur hat sich geaendert", golden.sig + " -> " + actual.sig);
   // Erste Abweichung benennen - sonst sucht man in 60 Proben.
   const n = Math.min(actual.samples.length, golden.samples.length);
   outer: for (let i = 0; i < n; i++) {
      for (const k of Object.keys(golden.samples[i])) {
         const a = actual.samples[i][k];
         const b = golden.samples[i][k];
         if (a !== b) {
            suite.note(`erste Abweichung bei Tick ${golden.samples[i].tick}, Feld "${k}": ${b} -> ${a}`);
            break outer;
         }
      }
   }
   suite.note("War die Aenderung gewollt? Dann: node tests/regression/golden-trace.test.js --update");
}

suite.section("Der Lauf ist in sich plausibel");
{
   const last = actual.samples[actual.samples.length - 1];
   ok(actual.samples.every((s) => Number.isFinite(s.x) && Number.isFinite(s.z)),
      "die Position bleibt endlich");
   ok(actual.samples.every((s) => s.speed >= 0 && s.speed < 25), "die Fahrt bleibt plausibel",
      "max " + Math.max(...actual.samples.map((s) => s.speed)).toFixed(1) + " kn");
   ok(actual.samples.every((s) => Math.abs(s.heel) < 90), "sie kentert nicht");
   ok(actual.samples.every((s) => s.hull >= 0 && s.hull <= 1), "der Rumpfzustand bleibt normiert");
   ok(actual.samples.every((s) => Math.abs(s.rudder) <= 1), "die Ruderlage bleibt im Anschlag");
   ok(actual.samples.every((s) => Math.abs(s.pitchX) <= 0.18 + 1e-9), "Stampfen bleibt gedeckelt");
   ok(last.fit <= actual.samples[0].fit, "die Mannschaft wird nicht mehr");
   ok(last.seaWind > 17 && last.seaWind < 20, "der Seegang steht beim Wind",
      last.seaWind.toFixed(2) + " kn");
   // Reffen bei Tick 600 muss sichtbar sein.
   const before = actual.samples.find((s) => s.tick === 600);
   const after = actual.samples.find((s) => s.tick === 1050);
   ok(after.speed < before.speed, "nach dem Reffen laeuft sie langsamer",
      before.speed.toFixed(2) + " -> " + after.speed.toFixed(2) + " kn");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
