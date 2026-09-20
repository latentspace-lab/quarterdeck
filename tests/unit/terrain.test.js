// tests/unit/terrain.test.js - nautical chart as a computational model.
import {
   World, generateWorld, activeWorld, setActiveWorld, worldInfo,
   groundHeight, waterDepth, isOpenWater, findOpenWater, nearestShoal,
   makeRng, PLAY_RADIUS,
} from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("terrain-math");
const { ok, near, eq } = suite;

const featureSig = (w) => fingerprint(w.features.flatMap((f) => [f.x, f.z, f.r, f.h]), 9);

suite.section("Determinism");
{
   const a = new World(4242);
   const b = new World(4242);
   eq(featureSig(a), featureSig(b), "same seed, same map");
   ok(featureSig(a) !== featureSig(new World(4243)), "different seed, different map");
   ok(a.features.length > 0, "the map is not empty", a.features.length + " features");
   eq(a.seed, 4242, "the seed is carried along");

   // This is the Phase 1 guarantee: the server only sends the seed.
   const client = new World(a.seed);
   let same = true;
   for (let i = 0; i < 200; i++) {
      const x = -1500 + i * 15;
      const z = 900 - i * 11;
      if (Math.abs(client.groundHeight(x, z) - a.groundHeight(x, z)) > 1e-12) same = false;
   }
   ok(same, "the seed alone reproduces the same depth chart");
}

suite.section("Empty world");
{
   const empty = new World(1, { islands: 0, freeReefs: 0 });
   eq(empty.features.length, 0, "no features");
   ok(empty.waterDepth(0, 0) > 0, "open water has depth");
   eq(empty.waterDepth(0, 0), empty.waterDepth(5000, -5000), "uniform depth without features");
}

suite.section("Depth and land");
{
   const w = new World(777);
   ok(Number.isFinite(w.groundHeight(0, 0)), "ground height is finite");
   near(w.waterDepth(123, -456), -w.groundHeight(123, -456), 1e-12,
      "depth is the negated ground profile");

   // A clear area stays open around the origin - otherwise a ship would
   // start on a reef.
   let minHome = Infinity;
   for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      minHome = Math.min(minHome, w.waterDepth(Math.cos(a) * 300, Math.sin(a) * 300));
   }
   ok(minHome > 15, "the starting area is water everywhere", minHome.toFixed(1) + " m");

   // Islands stick out, reefs sit just below.
   if (w.islands.length) {
      const isle = w.islands[0];
      ok(w.groundHeight(isle.x, isle.z) > 0, "the island rises above the water",
         w.groundHeight(isle.x, isle.z).toFixed(1) + " m");
   }
   for (const r of w.reefs.slice(0, 3)) {
      const d = w.waterDepth(r.x, r.z);
      ok(d < 26, "the reef raises the bottom", d.toFixed(1) + " m residual depth");
   }
   ok(w.reefs.every((r) => Math.hypot(r.x, r.z) >= 0), "reefs have coordinates");
   ok(w.islands.every((i) => Math.hypot(i.x, i.z) < PLAY_RADIUS + 500), "islands lie within the area");
}

suite.section("Finding open water");
{
   const w = new World(31337);
   const rng = makeRng(9);
   for (let k = 0; k < 25; k++) {
      const p = w.findOpenWater({ rng, near: { x: 0, z: 0 }, minDist: 200, maxDist: 1200 });
      if (!w.isOpenWater(p.x, p.z, 15, 220) && !(p.x === 0 && p.z === 0)) {
         ok(false, "findOpenWater returns open water");
         break;
      }
      if (k === 24) ok(true, "all 25 requested spots lie in the open");
   }
   // With the same generator the same sequence of spots comes out.
   const seqA = Array.from({ length: 5 }, () => w.findOpenWater({ rng: makeRng(4) }));
   const seqB = Array.from({ length: 5 }, () => w.findOpenWater({ rng: makeRng(4) }));
   eq(fingerprint(seqA.flatMap((p) => [p.x, p.z])), fingerprint(seqB.flatMap((p) => [p.x, p.z])),
      "the same generator gives the same spots");

   const sh = w.nearestShoal(0, 0);
   ok(sh && Number.isFinite(sh.dist), "nearestShoal reports a distance",
      sh ? sh.dist.toFixed(0) + " m" : "-");
}

suite.section("Active map (single-player path)");
{
   const w = generateWorld(2468);
   eq(activeWorld(), w, "generateWorld sets the active map");
   eq(worldInfo().seed, 2468, "worldInfo returns it");
   near(groundHeight(100, 100), w.groundHeight(100, 100), 1e-12, "the free functions read from it");
   near(waterDepth(100, 100), w.waterDepth(100, 100), 1e-12, "waterDepth as well");
   eq(isOpenWater(0, 0), w.isOpenWater(0, 0), "isOpenWater as well");
   ok(typeof findOpenWater({ rng: makeRng(1) }).x === "number", "findOpenWater as well");
   ok(nearestShoal(0, 0) !== undefined, "nearestShoal as well");

   // Switching to another map takes effect immediately - that's how, in
   // Phase 1, every room gets its own world.
   const other = new World(1);
   setActiveWorld(other);
   near(groundHeight(100, 100), other.groundHeight(100, 100), 1e-12, "setActiveWorld switches over");
   setActiveWorld(w);
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
