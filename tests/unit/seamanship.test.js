// tests/unit/seamanship.test.js - water over the rail.
//
// swampStep() changes flooding and crew, so it is gameplay that has to come
// out the same on the client and on the server.
import { swampStep, shipPose, getVessel, freeboardOf, makeRng } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("seamanship");
const { ok, near, eq } = suite;

const HULL = getVessel("lydia").hull;
const FB = freeboardOf(HULL);
const halfBeam = HULL.beam / 2;
const flat = () => 0;

function dmgStub() {
   const events = [];
   return { flooding: 0, sunk: false, events, _event: (type, data) => events.push({ type, ...data }) };
}
function crewStub() {
   const c = { hits: 0, lost: 0, shocks: 0 };
   return {
      c,
      hit(n) { c.hits++; c.lost += n; return { hurt: n, killed: 0 }; },
      shock() { c.shocks++; },
   };
}
const poseAt = (heel, twaSigned = 1, flooding = 0) => shipPose({
   pos: { x: 0, z: 0 }, heading: 0, heel, twaSigned, flooding, recoilRoll: 0, hull: HULL,
}, flat);

suite.section("Upright there is nothing to book");
{
   const st = { swampT: 0, railClear: 0 };
   const dmg = dmgStub();
   const crew = crewStub();
   const clear = swampStep(st, 1 / 30, poseAt(0), FB, halfBeam, { dmg, crew }, makeRng(1));
   near(clear, FB, 1e-9, "the clearance is the full freeboard");
   eq(dmg.flooding, 0, "no flooding");
   eq(crew.c.hits, 0, "nobody overboard");
   eq(st.swampT, 0, "the timer stays at zero");
}

suite.section("Heeled far enough the sea comes over the rail");
{
   const st = { swampT: 0, railClear: 0 };
   const dmg = dmgStub();
   const crew = crewStub();
   const rng = makeRng(7);
   let clear = 0;
   for (let i = 0; i < 60; i++) {
      clear = swampStep(st, 1 / 30, poseAt(70), FB, halfBeam, { dmg, crew }, rng);
   }
   ok(clear < 0, "the lee rail is under water", clear.toFixed(2) + " m");
   eq(st.railClear, clear, "the state carries the last clearance");
   ok(dmg.flooding > 0, "the ship takes water", dmg.flooding.toFixed(4));
   ok(crew.c.hits > 0, "people go overboard over two seconds", crew.c.hits + " times");
   ok(dmg.events.some((e) => e.type === "swamped"), "a 'swamped' event is raised after 1.2 s");
   const swamped = dmg.events.find((e) => e.type === "swamped");
   ok(swamped.depth > 0 && swamped.depth <= 2.5, "the reported depth is capped at 2.5 m", swamped.depth.toFixed(2));
}

suite.section("Righting the ship stops the water and resets the timer");
{
   const st = { swampT: 0, railClear: 0 };
   const dmg = dmgStub();
   const rng = makeRng(3);
   for (let i = 0; i < 20; i++) swampStep(st, 1 / 30, poseAt(70), FB, halfBeam, { dmg, crew: null }, rng);
   ok(st.swampT > 0, "the timer was running");
   const before = dmg.flooding;
   swampStep(st, 1 / 30, poseAt(5), FB, halfBeam, { dmg, crew: null }, rng);
   eq(st.swampT, 0, "upright again the timer resets");
   eq(dmg.flooding, before, "and no more water comes in");
}

suite.section("A sunk ship is left alone");
{
   const st = { swampT: 0, railClear: 0 };
   const dmg = dmgStub();
   dmg.sunk = true;
   dmg.flooding = 1;
   swampStep(st, 1 / 30, poseAt(70), FB, halfBeam, { dmg, crew: null }, makeRng(1));
   eq(dmg.flooding, 1, "flooding is not pushed past sunk");
   eq(dmg.events.length, 0, "no events on a wreck");
}

suite.section("Deterministic for a seed");
{
   const run = (seed) => {
      const st = { swampT: 0, railClear: 0 };
      const dmg = dmgStub();
      const crew = crewStub();
      const rng = makeRng(seed);
      for (let i = 0; i < 90; i++) swampStep(st, 1 / 30, poseAt(65), FB, halfBeam, { dmg, crew }, rng);
      return JSON.stringify([dmg.flooding, crew.c.hits, crew.c.lost, dmg.events.length]);
   };
   eq(run(11), run(11), "same seed, same water and the same casualties");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
