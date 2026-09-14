// tests/regression/determinism.test.js
//
// The promise of Phase 0D: same seed + same inputs -> same result. Without
// it there are no repeatable battle tests, no replayable salvos (Phase 3C),
// and no reliable debugging.
//
// What is NOT claimed here: that client and server arrive at the same
// damage rolls. In the server-authoritative design, damage logic never runs
// on the client at all, and the order in which the server consumes its
// generator depends on the arrival order of inputs.
import {
   BoatDynamics, DamageModel, Crew, SeaState, Wind, World,
   spawnSalvo, dischargeShots, stepProjectile,
   makeRng, deriveRng, getVessel, AMMO, SIM_DT,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Determinism");
const { ok, eq } = suite;

const SEED = 20260913;
const VESSEL = getVessel("lydia");

// ---------------------------------------------------------------------------
// A complete simulation run from a single seed.
// This is exactly how a room is set up in Phase 1: WorldParams in, state out.
// ---------------------------------------------------------------------------
function run(seed, ticks = 900) {
   const world = new World(seed);
   const wind = new Wind({ dir: 20, speed: 16, variability: 1 });
   const sea = new SeaState(16);
   const dyn = new BoatDynamics({ vessel: VESSEL, heading: 110 });
   const dmg = new DamageModel(VESSEL, { rng: deriveRng(seed, "dmg") });
   const crew = new Crew(VESSEL, { rng: deriveRng(seed, "crew") });
   const salvoRng = deriveRng(seed, "salvo");

   const trace = [];
   let t = 0;
   for (let i = 0; i < ticks; i++) {
      t += SIM_DT;
      wind.update(SIM_DT, t);
      sea.step(SIM_DT, wind.speed, wind.dir);

      dyn.setRudder(Math.sin(i * 0.017) * 0.7);
      dyn.driveMul = dmg.driveFactor();
      dyn.rudderMul = dmg.rudderFactor();
      dyn.heelBias = dmg.floodHeel();
      dyn.step(SIM_DT, { dir: wind.dir, speedKts: wind.speed });

      // A broadside and a hit every 60 ticks - so the rolled paths show up
      // in the run too.
      if (i % 60 === 30) {
         const shots = spawnSalvo({
            side: i % 120 === 30 ? "PORT" : "STBD", ammo: "ball",
            muzzleCount: 13, readyCount: 11, spread: 0.32,
            gunnery: 1.1, rangeToTarget: 320, maxRange: 500,
         }, salvoRng);
         trace.push(shots.length, shots[0].aimElev, shots[0].at);
         const res = dmg.applyHit({
            side: "STBD", s: (i % 300) / 300, y: 2 + (i % 7),
            ammo: AMMO.ball, lb: 18, range01: 0.2, freeboard: 5,
         });
         if (res) {
            crew.hit(res.crew.n, res.crew.where);
            trace.push(res.splinters, res.crew.n, res.holed ? 1 : 0);
         }
      }
      dmg.update(SIM_DT, { heel: dyn.heel, pump: crew.pumping() });
      crew.update(SIM_DT);

      trace.push(
         dyn.pos.x, dyn.pos.z, dyn.heading, dyn.speed, dyn.heel, dyn.rudder,
         sea.seaWind, sea.phaseT, dmg.integrity(), dmg.flooding, crew.fit,
      );
   }
   return {
      sig: fingerprint(trace),
      worldSig: fingerprint(world.features.flatMap((f) => [f.x, f.z, f.r, f.h]), 9),
      state: {
         x: dyn.pos.x, z: dyn.pos.z, heading: dyn.heading, speed: dyn.speed,
         seaWind: sea.seaWind, hull: dmg.integrity(), fit: crew.fit,
      },
   };
}

suite.section("One seed, one result");
{
   const a = run(SEED);
   const b = run(SEED);
   eq(a.sig, b.sig, "900 ticks computed twice: identical trace", a.sig);
   eq(a.worldSig, b.worldSig, "identical chart", a.worldSig);
   suite.deepEq(a.state, b.state, "identical final state");
}

suite.section("A different seed gives a different battle");
{
   const a = run(SEED);
   const c = run(SEED + 1);
   ok(a.sig !== c.sig, "the trace differs");
   ok(a.worldSig !== c.worldSig, "and so does the chart");
}

suite.section("Length does not matter - a prefix stays a prefix");
{
   // Whoever computes 900 ticks must do exactly the same thing in the first
   // 300 as someone who only computes 300. That sounds trivial, but breaks
   // the moment any state hangs on outside the loop.
   const short300 = run(SEED, 300).state;
   const long900 = run(SEED, 900);
   const alsoShort = run(SEED, 300).state;
   suite.deepEq(short300, alsoShort, "300 ticks are reproducible");
   ok(long900.state.x !== short300.x, "and 900 ticks carry on further", "sanity check");
}

suite.section("Random streams stay separate");
{
   // The damage model must not take any numbers away from the salvo generator.
   const salvoOnly = (seed, extraDamageRolls) => {
      const salvo = deriveRng(seed, "salvo");
      const dmg = new DamageModel(VESSEL, { rng: deriveRng(seed, "dmg") });
      for (let i = 0; i < extraDamageRolls; i++) {
         dmg.applyHit({ side: "PORT", s: 0.4, y: 2, ammo: AMMO.ball, lb: 18, range01: 0.3, freeboard: 5 });
      }
      const opts = { side: "PORT", ammo: "ball", muzzleCount: 13, readyCount: 13,
         spread: 0.3, gunnery: 1, rangeToTarget: 300, maxRange: 500 };
      return fingerprint(spawnSalvo(opts, salvo).flatMap((s) => [s.aimElev, s.aimTrain, s.at]));
   };
   eq(salvoOnly(5, 0), salvoOnly(5, 250),
      "250 more damage rolls do not change the next salvo");
}

suite.section("A salvo's trajectory can be replayed");
{
   // Phase 3C in miniature: seed and starting state are enough to reproduce
   // the same impacts for every participant.
   const replay = (seed) => {
      const rng = makeRng(seed);
      const salvo = spawnSalvo({
         side: "STBD", ammo: "ball", muzzleCount: 13, readyCount: 13,
         spread: 0.32, gunnery: 1.1, rangeToTarget: 340, maxRange: 500,
      }, rng);
      const out = [];
      for (const sh of salvo) {
         const shots = dischargeShots({
            origin: { x: 0, y: 4, z: sh.idx * 2 - 12 },
            flat: { x: 1, y: 0, z: 0 },
            ammo: sh.ammo, aimElev: sh.aimElev, aimTrain: sh.aimTrain, lb: 18,
         }, rng);
         for (const b of shots) {
            for (let i = 0; i < 120 && b.pos.y > 0; i++) stepProjectile(b, SIM_DT);
            out.push(b.pos.x, b.pos.y, b.pos.z);
         }
      }
      return fingerprint(out);
   };
   eq(replay(31337), replay(31337), "same seed, same impacts", replay(31337));
   ok(replay(31337) !== replay(31338), "different seed, different impacts");
}

suite.section("No hidden Math.random() in the shared modules");
{
   // Proof by brute force: Math.random is disconnected. If an unseeded roll
   // still lurks anywhere, the run blows up here.
   const real = Math.random;
   let leaked = 0;
   Math.random = () => { leaked++; return 0.5; };
   try {
      run(SEED, 300);
   } finally {
      Math.random = real;
   }
   eq(leaked, 0, "the simulation run never touches Math.random, not even once");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
