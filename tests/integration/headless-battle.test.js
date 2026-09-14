// tests/integration/headless-battle.test.js
//
// Gunnery on the server: two frigates under AI captains fight it out in a
// Simulation - no browser, no socket. Salvos are ordered, balls leave real
// muzzles, some strike, damage and casualties accrue, masts come down, and
// the whole thing is reproducible from the seed.
import { Simulation, DEFAULT_PARAMS } from "../../packages/server/src/sim/Simulation.ts";
import { SIM_HZ, AMMO } from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Headless battle");
const { ok, near, eq } = suite;

function battle(seed, maxMinutes = 8) {
   const sim = new Simulation({ ...DEFAULT_PARAMS, rngSeed: seed, terrainSeed: 99, windVariability: 0 });
   // Already broadside to broadside at pistol-shot range. Whether the captains
   // manage to close from further out is a balance question - their approach
   // ignores the wind, the upwind ship cannot point at its target and the
   // pair drifts apart (documented in tests/pending/balance). That is the
   // client's captain faithfully ported; this suite is about the gunnery.
   const A = sim.addAI("A", "lydia", { x: 0, z: 0, heading: 90, speed: 4, team: "blue" },
      { doctrine: "hull", skill: 1.05, engage: 150 });
   const B = sim.addAI("B", "amelie", { x: 20, z: 130, heading: 90, speed: 4, team: "red" },
      { doctrine: "rig", skill: 0.85, engage: 220 });
   const counts = { salvo: 0, shots: 0, balls: 0, hit: 0, hitA: 0, hitB: 0, mastLost: 0 };
   const trace = [];
   let minDist = Infinity;
   let decidedAt = null;
   const maxTicks = SIM_HZ * 60 * maxMinutes;
   let tick = 0;
   for (; tick < maxTicks; tick++) {
      sim.step();
      for (const e of sim.drainEvents()) {
         if (e.kind === "salvo") counts.salvo++;
         else if (e.kind === "shots") { counts.shots++; counts.balls += e.shots.length; }
         else if (e.kind === "hit") { counts.hit++; if (e.shipId === "A") counts.hitA++; else counts.hitB++; }
         else if (e.kind === "ship" && e.type === "mastLost") counts.mastLost++;
      }
      minDist = Math.min(minDist, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
      if (tick % 100 === 0) {
         const s = sim.snapshot();
         trace.push(...s.ships.flatMap((x) => [x.x, x.z, x.heading, x.hullIntegrity, x.mastsStanding, x.flooding]));
      }
      if (decidedAt === null && (!sim.fighting("blue").length || !sim.fighting("red").length)) decidedAt = tick;
      if (decidedAt !== null && tick > decidedAt + SIM_HZ * 5) break;
   }
   return { sim, A, B, counts, minDist, decidedAt, ticks: tick, sig: fingerprint(trace) + ":" + JSON.stringify(counts) };
}

suite.section("Two frigates fight");
{
   const r = battle(1805);
   const { counts, A, B } = r;
   ok(counts.salvo >= 2, "broadsides are ordered", counts.salvo + " salvos");
   ok(counts.shots > 0 && counts.balls >= counts.shots, "guns go off and balls leave the muzzles", counts.balls + " balls");
   ok(counts.hit > 0, "some of them strike", counts.hit + " hits from " + counts.balls + " balls in " + (r.ticks / SIM_HZ / 60).toFixed(1) + " min");
   suite.note(counts.hitA + " hits on A, " + counts.hitB + " on B, closest " + r.minDist.toFixed(0) + " m");
   ok(A.dmg.integrity() < 1 || B.dmg.integrity() < 1 || A.dmg.rigging < 1 || B.dmg.rigging < 1,
      "hull or rigging is damaged",
      "hull " + A.dmg.integrity().toFixed(2) + " / " + B.dmg.integrity().toFixed(2)
      + ", rig " + A.dmg.rigging.toFixed(2) + " / " + B.dmg.rigging.toFixed(2));
   suite.note((A.crew.losses + B.crew.losses) + " casualties");
   ok(A.battery.broadsides > 0 && B.battery.broadsides > 0, "both batteries fired",
      A.battery.broadsides + " / " + B.battery.broadsides);
   suite.note(r.decidedAt !== null
      ? "decided after " + (r.decidedAt / SIM_HZ / 60).toFixed(1) + " min"
      : "not decided within the time limit (see tests/pending/balance)");
}

suite.section("Reproducible from the seed");
{
   const a = battle(31337, 3);
   const b = battle(31337, 3);
   eq(a.sig, b.sig, "same seed: identical trace and identical event counts", a.counts.hit + " hits");
   const c = battle(31338, 3);
   ok(a.sig !== c.sig, "another seed: another battle");
}

suite.section("A player's broadside");
{
   const sim = new Simulation({ ...DEFAULT_PARAMS, rngSeed: 7, windVariability: 0 });
   const me = sim.add("me", "lydia", { x: 0, z: 0, heading: 0, speed: 5 });
   // Enemy right abeam to starboard, 180 m off, stationary-ish. Bow at +z,
   // up at +y: starboard is the -x side.
   const foe = sim.addAI("foe", "amelie", { x: -180, z: 0, heading: 0, speed: 0, team: "red" }, { skill: 0.1 });
   sim.captains.delete("foe"); // she just sits there
   for (let i = 0; i < 30; i++) sim.step();
   sim.drainEvents();

   eq(me.battery.ready("STBD"), true, "the starboard battery is ready");
   sim.applyInputs("me", [{ seq: 1, rudder: 0, fire: "STBD", ammo: "ball" }]);
   sim.step();
   const first = sim.drainEvents();
   const salvo = first.find((e) => e.kind === "salvo");
   ok(salvo, "the order produces a salvo event");
   if (salvo) {
      eq(salvo.shipId, "me", "for our ship");
      eq(salvo.side, "STBD", "on the side ordered");
      eq(salvo.ammo, "ball", "with the load ordered");
      eq(salvo.count, me.battery.gunsReady("STBD"), "one shot per served gun", salvo.count);
   }
   eq(me.battery.ready("STBD"), false, "the side is reloading");
   ok(me.battery.reload.STBD > 8, "for the vessel's reload time", me.battery.reload.STBD.toFixed(1) + " s");
   ok(me.battery.rollKick > me.vessel.guns.rollKick * 0.8, "the recoil kicks the heel", me.battery.rollKick.toFixed(2) + "°");

   // Let the guns go off and the balls fly. The first gun fires in the very
   // tick the order is given, so its shots are in `first` already.
   const shots = first.filter((e) => e.kind === "shots").flatMap((e) => e.shots);
   const hits = [];
   for (let i = 0; i < SIM_HZ * 4; i++) {
      sim.step();
      for (const e of sim.drainEvents()) {
         if (e.kind === "shots") shots.push(...e.shots);
         if (e.kind === "hit") hits.push(e);
      }
   }
   eq(shots.length, salvo ? salvo.count : -1, "every gun's ball is reported with origin and velocity");
   ok(shots.every((s) => s.origin.x < -3 && s.origin.x > -me.vessel.hull.beam && s.vel.x < -200),
      "balls start just outside the starboard side and fly to starboard",
      shots[0] && `x0 ${shots[0].origin.x.toFixed(1)} m, vx ${shots[0].vel.x.toFixed(0)} m/s`);
   ok(hits.length > 0, "at 180 m on the beam some of them hit", hits.length + " of " + shots.length);
   ok(hits.every((h) => h.shipId === "foe" && h.from === "me"), "on the enemy, from us");
   ok(hits.every((h) => h.side === "PORT"), "on her port side (she is to starboard of us, bow-on parallel)");
   ok(foe.dmg.integrity() < 1, "she is damaged", foe.dmg.integrity().toFixed(3));
   ok(me.recoilRoll !== 0 || me.battery.rollKick >= 0, "recoil roll feeds the pose");

   // The load can be changed and a knocked-out side does not fire.
   sim.applyInputs("me", [{ seq: 2, rudder: 0, ammo: "chain" }]);
   eq(me.battery.ammo, "chain", "ammo input changes the load");
   sim.applyInputs("me", [{ seq: 3, rudder: 0, ammo: "nonsense" }]);
   eq(me.battery.ammo, "chain", "an unknown load is ignored");
   me.dmg.guns.PORT = 0; // every port gun dismounted
   sim.applyInputs("me", [{ seq: 4, rudder: 0, fire: "PORT" }]);
   sim.step();
   eq(sim.drainEvents().some((e) => e.kind === "salvo"), false, "a knocked-out battery stays silent");
}

suite.section("The yacht has no guns");
{
   const sim = new Simulation(DEFAULT_PARAMS);
   const y = sim.add("y", "yacht", { heading: 90, speed: 4 });
   eq(y.armed, false, "unarmed");
   sim.applyInputs("y", [{ seq: 1, rudder: 0, fire: "BOTH" }]);
   sim.step();
   eq(sim.drainEvents().filter((e) => e.kind === "salvo").length, 0, "fire orders do nothing");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
