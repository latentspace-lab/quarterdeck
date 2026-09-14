// tests/unit/utils.test.js - angles, interpolation, dt-invariant smoothing.
import {
   clamp, lerp, invLerp, smoothstep, normDeg, diffDeg, absDiffDeg,
   dirVec, interpTable, approach, approachHalfLife, DEG, RAD, KNOT_TO_MS,
} from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("utils");
const { ok, near, eq } = suite;

suite.section("Scalars");
eq(clamp(5, 0, 1), 1, "clamp caps at the top");
eq(clamp(-5, 0, 1), 0, "clamp caps at the bottom");
eq(clamp(0.5, 0, 1), 0.5, "clamp passes through");
eq(lerp(10, 20, 0.25), 12.5, "lerp");
eq(invLerp(10, 20, 12.5), 0.25, "invLerp is the inverse");
eq(smoothstep(0, 1, 0.5), 0.5, "smoothstep in the middle");
eq(smoothstep(0, 1, -3), 0, "smoothstep clamps at the bottom");
eq(smoothstep(0, 1, 3), 1, "smoothstep clamps at the top");

suite.section("Angles");
eq(normDeg(-10), 350, "normDeg(-10)");
eq(normDeg(370), 10, "normDeg(370)");
eq(normDeg(0), 0, "normDeg(0)");
eq(diffDeg(350, 10), 20, "diffDeg across zero");
eq(diffDeg(10, 350), -20, "diffDeg backwards across zero");
eq(absDiffDeg(10, 350), 20, "absDiffDeg is unsigned");
ok(Math.abs(diffDeg(0, 180)) === 180, "opposite sits at 180");
near(DEG * RAD, 1, 1e-12, "DEG and RAD are each other's inverse");
near(KNOT_TO_MS, 0.514444, 1e-6, "one knot in m/s");

suite.section("Direction vectors (0 = north/+Z, 90 = east/+X)");
near(dirVec(0).z, 1, 1e-12, "north points to +Z");
near(dirVec(0).x, 0, 1e-12, "north has no X");
near(dirVec(90).x, 1, 1e-12, "east points to +X");
near(dirVec(180).z, -1, 1e-12, "south points to -Z");
for (const d of [0, 37, 91, 180, 271, 359]) {
   near(Math.hypot(dirVec(d).x, dirVec(d).z), 1, 1e-12, "dirVec(" + d + ") is normalized");
}

suite.section("Table interpolation");
const TAB = [[0, 0], [90, 10], [180, 0]];
eq(interpTable(0, TAB), 0, "left knot");
eq(interpTable(90, TAB), 10, "middle knot");
eq(interpTable(45, TAB), 5, "linear in between");
eq(interpTable(135, TAB), 5, "linear in the second segment");
eq(interpTable(180, TAB), 0, "right knot");

// ---------------------------------------------------------------------------
suite.section("approach(): dt-invariant smoothing");
// This is the guarantee client prediction rests on: the smoothing may only
// depend on the elapsed time, not on how many steps it was split across.
{
   const target = 100;
   const tau = 0.25;

   // One step over 1 s versus 100 steps of 10 ms each.
   let a = 0;
   a = approach(a, target, 1.0, tau);
   let b = 0;
   for (let i = 0; i < 100; i++) b = approach(b, target, 0.01, tau);
   near(a, b, 1e-9, "1 x 1000 ms == 100 x 10 ms");

   // And against 30 steps of 1/30 s - the actual simulation rate.
   let c = 0;
   for (let i = 0; i < 30; i++) c = approach(c, target, 1 / 30, tau);
   near(a, c, 1e-9, "1 x 1000 ms == 30 x 1/30 s");

   // Analytically: after tau, 1 - 1/e of the distance has been closed.
   near(approach(0, 1, tau, tau), 1 - Math.exp(-1), 1e-12, "after one tau: 1-1/e");

   ok(approach(5, 5, 0.017, tau) === 5, "already at the target stays there");
   eq(approach(0, 1, 0, tau), 0, "dt = 0 changes nothing");
   near(approach(0, 1, 1e6, tau), 1, 1e-12, "a very large dt lands right on the target");
   near(approachHalfLife(0, 1, 0.3, 0.3), 0.5, 1e-12, "half-life halves the distance");

   // Monotonicity: the approach never overshoots the target.
   let over = false;
   let x = 0;
   for (let i = 0; i < 500; i++) { x = approach(x, 1, 0.2, 0.05); if (x > 1 + 1e-12) over = true; }
   ok(!over, "no overshoot, even with dt >> tau");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
