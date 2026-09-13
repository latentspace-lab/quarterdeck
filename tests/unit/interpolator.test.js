// tests/unit/interpolator.test.js - drawing remote ships a little in the past.
import { SnapshotBuffer, blend, lerpAngleDeg } from "../../packages/client/src/net/Interpolator.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("interpolator");
const { ok, near, eq } = suite;

const S = (t, over = {}) => ({ x: t, z: -t, heading: 10, speed: 5, tack: "STBD", mastsStanding: 3, ...over });

suite.section("Angles blend the short way");
{
   near(lerpAngleDeg(350, 10, 0.5), 0, 1e-9, "350 -> 10 passes through 0");
   near(lerpAngleDeg(10, 350, 0.25), 5, 1e-9, "10 -> 350 goes backwards");
   near(lerpAngleDeg(90, 270, 0), 90, 1e-9, "u=0 is the start");
   near(lerpAngleDeg(90, 270, 1), 270, 1e-9, "u=1 is the end");
}

suite.section("blend(): numbers lerp, angles wrap, steps snap");
{
   const m = blend(S(0, { heading: 355, tack: "PORT", luffing: false }), S(10, { heading: 5, tack: "STBD", luffing: true }), 0.5);
   near(m.x, 5, 1e-9, "x halfway");
   near(m.z, -5, 1e-9, "z halfway");
   near(m.heading, 0, 1e-9, "heading through north");
   eq(m.tack, "STBD", "tack from the later state");
   eq(m.luffing, true, "luffing from the later state");
   eq(m.mastsStanding, 3, "counters are not blended");
}

suite.section("SnapshotBuffer samples behind the newest state");
{
   const b = new SnapshotBuffer({ delay: 100 });
   eq(b.sample(0), null, "empty: nothing to draw");
   b.push(S(0), 1000);
   b.push(S(100), 1033);
   b.push(S(200), 1066);
   eq(b.size, 3, "three states kept");
   const s = b.sample(1166 - 50); // render time 1016 -> between 1000 and 1033
   near(s.x, 100 * (16 / 33), 1e-6, "interpolated between the bracketing states", s.x.toFixed(2));
   near(b.sample(1050).x, 0, 1e-9, "before the first state: the first one");
   near(b.sample(5000).x, 200, 1e-9, "far in the future: holds the newest, never extrapolates");
   eq(b.latest.x, 200, "latest is the newest push");
}

suite.section("Out-of-order and stale states");
{
   const b = new SnapshotBuffer({ delay: 100, keep: 200 });
   b.push(S(1), 1000);
   b.push(S(2), 1100);
   b.push(S(0), 1050); // late packet
   eq(b.size, 2, "a late packet is dropped");
   b.push(S(3), 1400);
   b.push(S(4), 1500);
   ok(b.size <= 3, "old states are trimmed", b.size + " kept");
   ok(b.sample(1600).x === 4 || b.sample(1600).x > 3, "and sampling still works");
}

suite.section("Only plain values are copied");
{
   const b = new SnapshotBuffer();
   const src = { x: 1, name: "a", alive: true, nested: { y: 2 }, fn() {} };
   b.push(src, 0);
   const s = b.sample(1000);
   eq(s.x, 1, "numbers");
   eq(s.name, "a", "strings");
   eq(s.alive, true, "booleans");
   eq(s.nested, undefined, "objects are ignored");
   eq(s.fn, undefined, "functions are ignored");
   src.x = 99;
   eq(b.latest.x, 1, "the buffer holds a copy");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
