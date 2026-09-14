// tests/unit/ballistics.test.js - trajectory, salvo, hit detection.
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import {
   rangeForElevation, elevationForRange, segmentBox, spawnSalvo,
   dischargeShots, stepProjectile, checkProjectileHits, rangeToTarget,
   makeRng, AMMO, SIM_DT, getVessel,
} from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("ballistics");
const { ok, near, eq } = suite;

const BALL = AMMO.ball;

suite.section("Throw range");
{
   ok(rangeForElevation(0, 330, 0.22) > 0, "horizontal from 2.5 m height still flies some distance",
      rangeForElevation(0, 330, 0.22).toFixed(0) + " m");
   ok(rangeForElevation(6, 330, 0.22) > rangeForElevation(2, 330, 0.22),
      "more elevation, more range");
   ok(rangeForElevation(6, 250, 0.55) < rangeForElevation(6, 330, 0.22),
      "chain shot stays short");
   ok(rangeForElevation(6, 330, 0.85) < rangeForElevation(6, 330, 0.22),
      "more drag, less range");
   ok(rangeForElevation(-1, 330, 0.22) < rangeForElevation(0, 330, 0.22),
      "aimed downward, even shorter");
   ok(Number.isFinite(rangeForElevation(21, 330, 0.22)), "finite even at the upper limit");
}

suite.section("Fire solution (inversion)");
{
   for (const R of [120, 300, 500, 800]) {
      const e = elevationForRange(R, BALL.v0, BALL.drag);
      const got = rangeForElevation(e, BALL.v0, BALL.drag);
      near(got, R, R * 0.02, "fire solution for " + R + " m hits", got.toFixed(0) + " m at " + e.toFixed(2) + "°");
   }
   ok(elevationForRange(800, BALL.v0, BALL.drag) > elevationForRange(200, BALL.v0, BALL.drag),
      "farther means aiming higher");
   eq(elevationForRange(400, 330, 0.22), elevationForRange(400, 330, 0.22), "pure and reproducible");
}

suite.section("segmentBox()");
{
   const P = (x, y, z) => ({ x, y, z });
   ok(segmentBox(P(-10, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1) !== null, "straight through hits");
   eq(segmentBox(P(-10, 5, 0), P(10, 5, 0), -1, 1, -1, 1, -1, 1), null, "passing above misses");
   eq(segmentBox(P(-10, 0, 0), P(-5, 0, 0), -1, 1, -1, 1, -1, 1), null,
      "a segment that ends before the box misses");
   eq(segmentBox(P(5, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1), null,
      "a segment behind the box misses");
   const t = segmentBox(P(-10, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1);
   near(t, 0.45, 1e-9, "the entry parameter is correct", String(t));
   eq(segmentBox(P(0, 0, 0), P(0, 0, 0.5), -1, 1, -1, 1, -1, 1), 0,
      "if the segment starts inside, t = 0");
   // Axis-aligned degeneracy: direction 0 on one axis.
   eq(segmentBox(P(5, 0, 0), P(5, 10, 0), -1, 1, -100, 100, -1, 1), null,
      "parallel and outside misses");
   ok(segmentBox(P(0, -10, 0), P(0, 10, 0), -1, 1, -1, 1, -1, 1) !== null,
      "parallel and inside hits");
}

suite.section("spawnSalvo(): all the randomness in one place");
{
   const opts = {
      side: "PORT", ammo: "ball", muzzleCount: 13, readyCount: 13,
      spread: 0.32, gunnery: 1, rangeToTarget: 350, maxRange: 500,
   };
   const sig = (seed) => fingerprint(
      spawnSalvo(opts, makeRng(seed)).flatMap((s) => [s.idx, s.aimElev, s.aimTrain, s.at]));

   eq(sig(11), sig(11), "same seed, same salvo");
   ok(sig(11) !== sig(12), "different seed, different salvo");

   const shots = spawnSalvo(opts, makeRng(11));
   eq(shots.length, 13, "one shot per clear gun");
   ok(shots.every((s) => s.side === "PORT"), "all on the same side");
   ok(shots.every((s) => s.idx >= 0 && s.idx < 13), "gun port indices in range");
   ok(new Set(shots.map((s) => s.idx)).size === 13, "each port exactly once");
   const aims = new Set(shots.map((s) => s.aimElev));
   eq(aims.size, 1, "the whole broadside shares one aiming error (it all goes high or low together)");
   ok(shots.every((s) => s.at >= 0 && s.at <= 0.32 + 0.035), "the thunder rolls along the broadside");
   ok(Math.max(...shots.map((s) => s.at)) > Math.min(...shots.map((s) => s.at)),
      "the guns fire staggered");

   // Guns out of action are spread evenly, not bunched at the front.
   const half = spawnSalvo({ ...opts, readyCount: 6 }, makeRng(3));
   eq(half.length, 6, "six manned guns, six shots");
   ok(Math.max(...half.map((s) => s.idx)) > 8, "they spread across the whole broadside",
      half.map((s) => s.idx).join(","));
   eq(spawnSalvo({ ...opts, readyCount: 0 }, makeRng(3)).length, 0, "a knocked-out side does not fire");

   // Better crews scatter less.
   const spreadOf = (gunnery) => {
      let sum = 0;
      for (let s = 0; s < 200; s++) {
         sum += Math.abs(spawnSalvo({ ...opts, gunnery }, makeRng(s))[0].aimTrain);
      }
      return sum / 200;
   };
   ok(spreadOf(1.4) < spreadOf(0.6), "drilled crews scatter less",
      spreadOf(1.4).toExponential(2) + " vs " + spreadOf(0.6).toExponential(2));

   // Without a target in the firing arc, aim is set to half range.
   const blind = spawnSalvo({ ...opts, rangeToTarget: 0 }, makeRng(1));
   ok(blind.length === 13 && Number.isFinite(blind[0].aimElev), "still aimed even without a target");
}

suite.section("dischargeShots() and trajectory");
{
   const rng = makeRng(42);
   const shots = dischargeShots({
      origin: { x: 0, y: 3, z: 0 }, flat: { x: -1, y: 0, z: 0 }, // -x = starboard
      ammo: "ball", aimElev: 2, aimTrain: 0, lb: 18,
   }, rng);
   eq(shots.length, 1, "one round ball per gun");
   const b = shots[0];
   ok(b.vel.x < -200, "it heads out to starboard", b.vel.x.toFixed(0) + " m/s");
   ok(b.vel.y > 0, "and slightly upward");
   near(Math.hypot(b.vel.x, b.vel.y, b.vel.z), BALL.v0, BALL.v0 * 0.06, "muzzle velocity");

   eq(dischargeShots({ origin: { x: 0, y: 3, z: 0 }, flat: { x: 1, y: 0, z: 0 },
      ammo: "grape", aimElev: 0, aimTrain: 0, lb: 18 }, makeRng(1)).length,
      AMMO.grape.pellets, "grapeshot throws a swarm");

   // The flight: gravity and drag, fixed step.
   let apex = -Infinity;
   let flightT = 0;
   while (b.pos.y > 0 && flightT < 30) { stepProjectile(b, SIM_DT); apex = Math.max(apex, b.pos.y); flightT += SIM_DT; }
   ok(apex > 3, "it climbs above muzzle height", apex.toFixed(1) + " m");
   ok(flightT > 0.5 && flightT < 30, "and comes back down", flightT.toFixed(1) + " s");
   ok(b.pos.x < -100, "and flies a good distance while doing it", (-b.pos.x).toFixed(0) + " m");
   // prev/pos span the segment that hit detection tests against.
   ok(b.prev.x !== b.pos.x, "prev and pos differ after the step");

   // Determinism of the whole chain.
   const trace = (seed) => {
      const s = dischargeShots({ origin: { x: 0, y: 3, z: 0 }, flat: { x: 1, y: 0, z: 0 },
         ammo: "ball", aimElev: 2, aimTrain: 0, lb: 18 }, makeRng(seed))[0];
      const out = [];
      for (let i = 0; i < 60; i++) { stepProjectile(s, SIM_DT); out.push(s.pos.x, s.pos.y, s.pos.z); }
      return fingerprint(out);
   };
   eq(trace(7), trace(7), "same seed, same trajectory");
   ok(trace(7) !== trace(8), "different seed, different trajectory");
}

suite.section("Hit detection");
{
   const v = getVessel("amelie");
   const target = {
      id: "B", matrixWorld: new Matrix4().makeTranslation(150, 0, 0),
      LOA: v.hull.loa, BEAM: v.hull.beam, DRAFT: v.hull.draft, FB: 5,
      rigTop: 46, rigHalfWidth: v.hull.beam,
   };
   const mk = (from, to) => ({
      origin: { ...from }, prev: { ...from }, pos: { ...to },
      vel: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
      ammo: "ball", lb: 18, drag: 0.22,
   });
   const rng = makeRng(1);

   const hit = checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [target], 500, rng, "A");
   ok(hit !== null, "a ball through the hull hits");
   if (hit) {
      eq(hit.target.id, "B", "the right target");
      ok(hit.side === "PORT" || hit.side === "STBD", "a side is determined", hit.side);
      ok(hit.s >= 0 && hit.s <= 1, "longitudinal position normalized", hit.s.toFixed(2));
      ok(typeof hit.local.clone === "function", "local is a Vector3 (the client clones it)");
      ok(typeof hit.world.clone === "function", "world is a Vector3");
      ok(typeof hit.dir.clone === "function", "dir is a Vector3");
      near(hit.dir.length(), 1, 1e-9, "dir is normalized");
      ok(hit.speed > 0, "impact speed");
      eq(hit.ammo.id, "ball", "the ammo type is passed through");
   }

   eq(checkProjectileHits(mk({ x: 140, y: 200, z: 0 }, { x: 160, y: 200, z: 0 }), [target], 500, rng, "A"),
      null, "passing far overhead hits nothing");
   eq(checkProjectileHits(mk({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }), [target], 500, rng, "A"),
      null, "a ball that never reaches the target does not hit");
   eq(checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [target], 500, rng, "B"),
      null, "your own ship is skipped");
   eq(checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [], 500, rng, "A"),
      null, "no targets, no hit");

   // The rig is mostly air: the same trajectory does not always hit.
   let caught = 0;
   const r2 = makeRng(5);
   for (let i = 0; i < 400; i++) {
      const s = mk({ x: 140, y: 25, z: 0 }, { x: 160, y: 25, z: 0 });
      if (checkProjectileHits(s, [target], 500, r2, "A")) caught++;
   }
   ok(caught > 0 && caught < 400, "only some of the shots are caught in the rig",
      caught + " of 400");

   // For each projectile and target the dice are rolled exactly ONCE - after
   // that it just flies through.
   const persistent = mk({ x: 140, y: 25, z: 0 }, { x: 160, y: 25, z: 0 });
   const first = checkProjectileHits(persistent, [target], 500, makeRng(9), "A");
   const second = checkProjectileHits(persistent, [target], 500, makeRng(9), "A");
   eq(!!first, !!second, "the dice roll for the rig stays decided");

   // Chain shot is caught more often than round shot.
   const catchRate = (ammo) => {
      const r = makeRng(3);
      let n = 0;
      for (let i = 0; i < 600; i++) {
         const s = mk({ x: 140, y: 20, z: 0 }, { x: 160, y: 20, z: 0 });
         s.ammo = ammo;
         if (checkProjectileHits(s, [target], 500, r, "A")) n++;
      }
      return n / 600;
   };
   ok(catchRate("chain") > catchRate("ball"), "chain shot gets caught in the rigging more often",
      (catchRate("chain") * 100).toFixed(0) + " % vs " + (catchRate("ball") * 100).toFixed(0) + " %");
}

suite.section("rangeToTarget(): what stands in the broadside");
{
   const own = new Matrix4(); // own ship at the origin, bow toward +Z, starboard = -X
   const at = (x, z) => ({
      id: "t" + x + "_" + z, matrixWorld: new Matrix4().makeTranslation(x, 0, z),
      LOA: 40, BEAM: 10, DRAFT: 4, FB: 5,
   });
   near(rangeToTarget(own, "STBD", [at(-200, 0)], 500, "me"), 200, 1e-6, "abeam to starboard: 200 m");
   eq(rangeToTarget(own, "PORT", [at(-200, 0)], 500, "me"), 0, "on the wrong side: nothing");
   near(rangeToTarget(own, "PORT", [at(150, 0)], 500, "me"), 150, 1e-6, "abeam to port: 150 m");
   eq(rangeToTarget(own, "STBD", [at(-20, 400)], 500, "me"), 0,
      "nearly dead ahead cannot be reached by the broadside");
   eq(rangeToTarget(own, "STBD", [at(-2000, 0)], 500, "me"), 0, "far out of range does not count");
   near(rangeToTarget(own, "STBD", [at(-400, 0), at(-180, 0)], 500, "me"), 180, 1e-6,
      "the nearest target wins");
   eq(rangeToTarget(own, "STBD", [], 500, "me"), 0, "empty list: 0");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
