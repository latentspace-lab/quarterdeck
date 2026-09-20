// tests/unit/course.test.js - the regatta course judged in pure maths.
import { courseLayout, newRace, raceStep, crossedLineNorth } from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("course");
const { ok, near, eq } = suite;

const L = courseLayout({ x: 0, z: 0 });

suite.section("Layout");
{
   eq(L.legs.length, 4, "start, windward, leeward, finish");
   ok(L.windward.z > 0, "windward mark is upwind");
   ok(L.leeward.z < 0, "leeward mark is downwind");
   ok(Math.abs(L.committee.x - L.pin.x) > 0, "the line has width");
   const M = courseLayout({ x: 500, z: -200 });
   near(M.windward.x, 500, 0, "a moved course moves its marks");
   near(M.lineZ, -200, 0, "and its line");
}

suite.section("Crossing the line");
{
   ok(crossedLineNorth(L, -1, { x: 0, z: 1 }), "south to north across the line counts");
   ok(!crossedLineNorth(L, 1, { x: 0, z: -1 }), "north to south does not");
   ok(!crossedLineNorth(L, -1, { x: 60, z: 1 }), "outside the line's width does not");
   ok(crossedLineNorth(L, -1, { x: 50, z: 1 }), "a little slack past the pin end is allowed");
}

/** Sail a boat straight along a list of waypoints at v m/s, stepping the race. */
function sail(r, from, waypoints, dt = 1 / 30, v = 5, t0 = 0) {
   let pos = { ...from };
   let t = t0;
   const steps = [];
   for (const wp of waypoints) {
      const dx = wp.x - pos.x, dz = wp.z - pos.z;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (v * dt)));
      for (let i = 1; i <= n; i++) {
         pos = { x: pos.x + dx / n, z: pos.z + dz / n };
         t += dt;
         steps.push(raceStep(L, r, pos, t));
      }
   }
   return { steps, t, pos };
}

suite.section("A whole lap");
{
   const r = newRace(L, 0);
   eq(r.leg, 0, "starts on the start leg");
   const { steps, t } = sail(r, { x: 0, z: -150 }, [
      { x: 0, z: 5 },       // over the start line
      { x: 5, z: 845 },     // to the windward mark
      { x: 30, z: -795 },   // down to the leeward mark
      { x: 0, z: -20 },     // back below the line
      { x: 0, z: 5 },       // finish
   ]);
   const passes = steps.filter((s) => s.advanced);
   eq(passes.length, 4, "four passes: start, windward, leeward, finish");
   eq(passes[0].passed, "start", "first the start line");
   eq(passes[1].legName, "Leeward mark", "after the windward mark the next leg is the leeward mark");
   eq(passes[3].lapDone, true, "the finish completes the lap");
   eq(r.lap, 1, "one lap done");
   ok(r.best !== null && r.best > 0, "with a best time", r.best.toFixed(1) + " s");
   near(r.best, r.lastLap, 1e-9, "the first lap is the best lap");
   ok(r.best < t, "the lap took less than the whole sail (the run-up is not counted)");
   eq(r.leg, 0, "back on the start leg for the next lap");
   near(r.progress, 0, 1e-12, "progress reset");
}

suite.section("Progress and guidance");
{
   const r = newRace(L, 0);
   const a = raceStep(L, r, { x: 0, z: -100 }, 1);
   near(a.dist, 100, 1e-9, "distance to the start line");
   near(a.bearing, 0, 1e-9, "bearing north");
   eq(a.legType, "start", "on the start leg");
   sail(r, { x: 0, z: -100 }, [{ x: 0, z: 5 }]);
   const b = raceStep(L, r, { x: 0, z: 10 }, 40);
   eq(b.legType, "turn", "after the start the next target is a mark");
   near(b.next.z, L.windward.z, 0, "the windward mark");
   near(r.progress, 0.25, 1e-12, "a quarter of the lap");
   ok(b.time > 0 && b.time < 40, "lap time counts from the start crossing", b.time.toFixed(1) + " s");
}

suite.section("Wrong-way and time base");
{
   const r = newRace(L, 100, { x: 0, z: 50 }); // a boat that starts north of the line
   sail(r, { x: 0, z: 50 }, [{ x: 0, z: -50 }], 1 / 30, 5, 100); // north to south over the line
   eq(r.leg, 0, "crossing the line southwards starts nothing");
   const s = raceStep(L, r, { x: 0, z: -50 }, 130);
   near(s.time, 30, 1e-9, "time is simulation time relative to lapStart, not the wall clock");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
