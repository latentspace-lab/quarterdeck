// tests/integration/headless-sim.test.js
//
// The proof Phase 1 stands on: the server simulation runs in Node - no DOM,
// no WebGL, no renderer, no socket - and carries a complete room.
//
// When something breaks here it is almost always the same thing: a Three.js
// dependency has crept into the shared logic and works silently in the
// browser.
import { Simulation, ServerShip, DEFAULT_PARAMS } from "../../packages/server/src/headless.ts";
import { wreckLoadFor } from "../../packages/server/src/sim/ServerShip.ts";
import { SIM_HZ, SIM_DT, SeaState, getVessel } from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Headless simulation");
const { ok, near, eq } = suite;

const steer = (sim, id, i, rudder) => sim.applyInputs(id, [{ seq: i, rudder }]);

suite.section("No browser needed");
{
   eq(typeof globalThis.document, "undefined", "there is no document");
   eq(typeof globalThis.window, "undefined", "there is no window");
   const sim = new Simulation(DEFAULT_PARAMS);
   ok(sim.world.features.length > 0, "and still there is a chart", sim.world.features.length + " features");
   ok(sim instanceof Simulation, "a simulation can be set up");
}

suite.section("A room runs");
{
   const sim = new Simulation(DEFAULT_PARAMS);
   const a = sim.add("a", "lydia", { heading: 110 });
   const b = sim.add("b", "amelie", { x: 420, z: 120, heading: 270 });
   ok(a instanceof ServerShip && b instanceof ServerShip, "two ships in the room");
   eq(sim.tick, 0, "the tick counter starts at 0");

   for (let i = 0; i < SIM_HZ * 60; i++) {
      steer(sim, "a", i, Math.sin(i * 0.004) * 0.12);
      sim.step();
   }
   eq(sim.tick, SIM_HZ * 60, "1800 ticks computed");
   near(sim.t, 60, 1e-9, "which is exactly 60 s of game time");

   const snap = sim.snapshot();
   eq(snap.ships.length, 2, "the snapshot lists both ships");
   eq(snap.tick, sim.tick, "and the tick counter");
   ok(snap.sea.seaWind > 0 && snap.sea.phaseT > 0, "and the sea state");

   const A = snap.ships.find((s) => s.id === "a");
   eq(A.lastSeq, SIM_HZ * 60 - 1, "the last applied input is acknowledged");
   ok(A.speed > 0, "the ship has gathered way", A.speed.toFixed(2) + " kn");
   ok(Math.hypot(A.x, A.z) > 100, "and made distance", Math.hypot(A.x, A.z).toFixed(0) + " m");
   ok(a.pose !== null, "the ship has a pose for the hit test", a.pose.y.toFixed(2) + " m");
}

suite.section("The snapshot is complete");
{
   // Every input BoatDynamics.step() needs must be there - otherwise a client
   // cannot re-simulate from an acknowledged state.
   const sim = new Simulation(DEFAULT_PARAMS);
   sim.add("a", "lydia", { heading: 110 });
   for (let i = 0; i < 60; i++) { steer(sim, "a", i, 0.3); sim.step(); }
   const s = sim.snapshot().ships[0];
   for (const key of [
      "id", "vesselId", "x", "z", "heading", "speed", "heel", "sailSet", "rudder",
      "twa", "tack", "luffing", "leeway", "isCapsized", "alive",
      "hullIntegrity", "mastsStanding", "flooding", "afire", "struck", "sunk",
      "hullPortBow", "hullPortMid", "hullPortQuarter", "hullStbdBow", "hullStbdMid", "hullStbdQuarter",
      "rigging", "sails", "rudderState", "gunsPort", "gunsStbd",
      "mastFore", "mastMain", "mastMizzen", "mastForeState", "mastMainState", "mastMizzenState",
      "reloadPort", "reloadStbd", "reloadTime", "ammo", "guns",
      "driveMul", "rudderMul", "dragMul", "turnBias", "heelBias", "stopped", "wreckDrag",
      "lastSeq",
   ]) {
      ok(s[key] !== undefined, "ShipState contains " + key);
   }
   ok(JSON.stringify(sim.snapshot()).length > 0, "the snapshot serialises");
}

suite.section("Inputs arrive");
{
   const mk = (rudder) => {
      const sim = new Simulation(DEFAULT_PARAMS);
      sim.add("a", "lydia", { heading: 110 });
      for (let i = 0; i < 300; i++) { steer(sim, "a", i, rudder); sim.step(); }
      return sim.snapshot().ships[0];
   };
   const left = mk(-1);
   const straight = mk(0);
   const right = mk(1);
   ok(left.heading !== straight.heading, "port rudder changes the course");
   ok(right.heading !== straight.heading, "starboard rudder likewise");
   ok(Math.sign(((left.heading - straight.heading + 540) % 360) - 180) !==
      Math.sign(((right.heading - straight.heading + 540) % 360) - 180),
      "and in opposite directions",
      left.heading.toFixed(1) + "° / " + straight.heading.toFixed(1) + "° / " + right.heading.toFixed(1) + "°");
   near(straight.rudder, 0, 1e-9, "without input the rudder stays amidships");
   near(right.rudder, 1, 1e-6, "after 10 s the rudder is hard over");

   // Sail handling only means something on a square-rigger.
   const sim = new Simulation(DEFAULT_PARAMS);
   sim.add("f", "lydia", { heading: 110 });
   sim.add("y", "yacht", { heading: 110, x: 300 });
   sim.applyInputs("f", [{ seq: 1, rudder: 0, sailSet: 0.5 }]);
   sim.applyInputs("y", [{ seq: 1, rudder: 0, sailSet: 0.5 }]);
   eq(sim.ships.get("f").dyn.sailSet, 0.5, "the frigate reefs");
   eq(sim.ships.get("y").dyn.sailSet, 1, "the yacht ignores sailSet");
   sim.applyInputs("f", [{ seq: 2, rudder: 0, sailSet: 0.01 }]);
   eq(sim.ships.get("f").dyn.sailSet, 0.25, "and never below the minimum canvas");
}

suite.section("Reproducible");
{
   const run = () => {
      const sim = new Simulation(DEFAULT_PARAMS);
      sim.add("a", "lydia", { heading: 110 });
      sim.add("b", "amelie", { x: 420, z: 120, heading: 270 });
      const trace = [];
      for (let i = 0; i < 600; i++) {
         steer(sim, "a", i, Math.sin(i * 0.01));
         sim.step();
         if (i % 25 === 0) {
            sim.ships.get("b").dmg.applyHit({ side: "PORT", s: (i % 300) / 300, y: 3 });
         }
         const snap = sim.snapshot();
         trace.push(...snap.ships.flatMap((s) => [s.x, s.z, s.heading, s.speed, s.hullIntegrity]));
         trace.push(snap.sea.seaWind, snap.sea.phaseT);
      }
      return fingerprint(trace);
   };
   eq(run(), run(), "two runs from the same parameters: identical trace", run());
}

suite.section("Rooms do not share a world");
{
   // Two simulations in one process, different seeds, both alive at once.
   const a = new Simulation({ ...DEFAULT_PARAMS, terrainSeed: 1 });
   const b = new Simulation({ ...DEFAULT_PARAMS, terrainSeed: 2 });
   ok(a.world.waterDepth(900, 400) !== b.world.waterDepth(900, 400) ||
      a.world.features.length !== b.world.features.length,
      "different seeds, different charts");
   eq(a.world.seed, 1, "and each keeps its own");
   eq(b.world.seed, 2, "");
}

suite.section("The sea state can be transferred");
{
   // SeaSync is the part the client CANNOT recompute.
   const sim = new Simulation(DEFAULT_PARAMS);
   sim.add("a", "lydia", { heading: 110 });
   for (let i = 0; i < 900; i++) { steer(sim, "a", i, 0); sim.step(); }

   const client = new SeaState(0);
   client.fromSync(sim.snapshot().sea);
   client.windRad = sim.sea.windRad;
   near(client.heightAt(37.5, -82.25), sim.sea.heightAt(37.5, -82.25), 1e-12,
      "the client stands on exactly the same wave");
   near(client.amp, sim.sea.amp, 1e-12, "same amplitude");

   const guessing = new SeaState(DEFAULT_PARAMS.windBaseSpeed);
   ok(Math.abs(guessing.heightAt(37.5, -82.25) - sim.sea.heightAt(37.5, -82.25)) > 1e-6,
      "whoever guesses the sea state stands on a different wave");
}

suite.section("Two ships on converging courses collide");
{
   // Both start bow-on, 60 m apart, with way on. The collision module runs
   // inside step() and must book the ram on both hulls exactly once.
   const sim = new Simulation({ ...DEFAULT_PARAMS, windBaseDir: 90, windVariability: 0 });
   const a = sim.add("a", "lydia", { x: 0, z: -35, heading: 0, speed: 7 });
   const b = sim.add("b", "amelie", { x: 0, z: 35, heading: 180, speed: 7 });
   let collision = null;
   let ticks = 0;
   while (!collision && ticks++ < SIM_HZ * 20) {
      sim.step();
      collision = sim.drainEvents().find((e) => e.kind === "world" && e.type === "collision") || null;
   }
   ok(collision, "a collision event is raised", ticks + " ticks");
   if (collision) {
      ok(collision.closing > 1.2, "with a closing speed above the damage threshold", collision.closing.toFixed(1) + " kn");
      ok([collision.a, collision.b].sort().join() === "a,b", "naming both ships by id");
   }
   ok(a.dmg.integrity() < 1 && b.dmg.integrity() < 1, "both hulls are damaged",
      a.dmg.integrity().toFixed(3) + " / " + b.dmg.integrity().toFixed(3));
   ok(a.dmg.log.length + b.dmg.log.length >= 0 && a._ramCooldown > 0, "the ram cooldown is running");
   const dist = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
   ok(dist >= (a.vessel.hull.beam + b.vessel.hull.beam) * 0.5 - 1, "the hulls were pushed apart", dist.toFixed(1) + " m");
}

suite.section("Running onto a reef");
{
   const sim = new Simulation(DEFAULT_PARAMS);
   const reef = sim.world.reefs[0];
   ok(reef, "the chart has a reef", reef && `${reef.x.toFixed(0)}, ${reef.z.toFixed(0)}`);
   // Start 300 m up-track from the reef, sailing straight at it.
   const dx = reef.x, dz = reef.z;
   const L = Math.hypot(dx, dz);
   const ux = dx / L, uz = dz / L;
   const heading = ((Math.atan2(ux, uz) * 180) / Math.PI + 360) % 360;
   const s = sim.add("a", "lydia", { x: dx - ux * 300, z: dz - uz * 300, heading, speed: 8 });
   // Keep her driving: no wind dependency for this test, just speed.
   let aground = false;
   for (let i = 0; i < SIM_HZ * 120 && !aground; i++) {
      s.dyn.speed = Math.max(s.dyn.speed, 4);
      sim.step();
      if (sim.drainEvents().some((e) => e.kind === "ship" && e.type === "aground")) aground = true;
   }
   ok(aground, "an 'aground' event is raised");
   ok(s.groundedFor > 0, "the ship has been on the ground", s.groundedFor.toFixed(2) + " s");
   ok(s.dmg.holes.some((h) => h.below), "the keel is holed below the waterline");
}

suite.section("Wreck drag substitute");
{
   const lydia = getVessel("lydia");
   const yacht = getVessel("yacht");
   const main = wreckLoadFor(lydia, "main");
   ok(main > 0.3 && main <= 0.7, "a frigate's mainmast alongside is a serious brake", main.toFixed(2));
   ok(wreckLoadFor(lydia, "mizzen") < main, "the mizzen less so");
   ok(wreckLoadFor(yacht, "main") < main, "a yacht's mast is lighter still", wreckLoadFor(yacht, "main").toFixed(2));

   const sim = new Simulation({ ...DEFAULT_PARAMS, windVariability: 0 });
   const s = sim.add("a", "lydia", { heading: 110 });
   for (let i = 0; i < 300; i++) sim.step();
   const before = s.dyn.speed;
   s.dmg.breakMast("main", "test");
   for (let i = 0; i < 300; i++) sim.step();
   ok(s.wreckage.has("main"), "the fallen mast hangs alongside");
   ok(s.wreckDrag > 0, "and drags", s.wreckDrag.toFixed(2));
   ok(s.dyn.speed < before, "the ship is slower", before.toFixed(2) + " -> " + s.dyn.speed.toFixed(2) + " kn");
   sim.applyInputs("a", [{ seq: 1, rudder: 0, cutWreck: true }]);
   sim.step();
   eq(s.wreckDrag, 0, "cut away, the drag is gone");
   ok(sim.drainEvents().some((e) => e.type === "cutAway"), "and the clients are told");
}

suite.section("Speed");
{
   const sim = new Simulation(DEFAULT_PARAMS);
   for (let i = 0; i < 4; i++) sim.add("s" + i, i % 2 ? "amelie" : "lydia", { x: i * 200, z: i * 90, heading: i * 80 });
   const t0 = Date.now();
   const TICKS = SIM_HZ * 120;
   for (let i = 0; i < TICKS; i++) { steer(sim, "s0", i, 0.2); sim.step(); }
   const ms = Date.now() - t0;
   const realtime = (TICKS * SIM_DT * 1000) / Math.max(ms, 1);
   ok(realtime > 50, "four ships, two minutes of game time run far faster than real time",
      ms + " ms, factor " + realtime.toFixed(0));
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
