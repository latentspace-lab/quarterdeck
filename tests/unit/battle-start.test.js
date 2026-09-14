// tests/unit/battle-start.test.js - the opening of a single-player battle.
//
// Issue #6: every battle should feel different. The wind and the enemy's
// position come from a seeded generator, so a battle can also be replayed.
import { makeRng } from "@quarterdeck/shared";
import { battleWind, battleSpawns, WIND_KTS, SPAWN_M, UPWIND_M, STAGGER_M } from "../../packages/client/src/battleStart.js";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("battle start");
const { ok, eq, near } = suite;

const player = { x: 0, z: 0 };
const plan = (seed, random, enemies = ["amelie", "hirondelle"]) =>
   battleSpawns({ enemies, player, windDir: 0, random, rng: makeRng(seed) });
const dist = (s) => Math.hypot(s.x - player.x, s.z - player.z);
const bearingTo = (s) => (Math.atan2(player.x - s.x, player.z - s.z) * 180 / Math.PI + 360) % 360;

suite.section("wind");
{
   for (let seed = 1; seed <= 200; seed++) {
      const w = battleWind(makeRng(seed));
      if (!(w.dir >= 0 && w.dir < 360 && w.dir % 5 === 0) || !(w.speed >= WIND_KTS[0] && w.speed <= WIND_KTS[1])) {
         ok(false, "wind stays in the band and on the menu's 5° grid", JSON.stringify(w));
         break;
      }
      if (seed === 200) ok(true, "wind stays in the band and on the menu's 5° grid, 200 seeds");
   }
   const dirs = new Set(), speeds = new Set();
   for (let seed = 1; seed <= 60; seed++) { const w = battleWind(makeRng(seed)); dirs.add(w.dir); speeds.add(w.speed); }
   ok(dirs.size > 30 && speeds.size > 8, "and varies from seed to seed", dirs.size + " directions, " + speeds.size + " speeds");
   eq(fingerprint(Object.values(battleWind(makeRng(7)))), fingerprint(Object.values(battleWind(makeRng(7)))), "same seed, same wind");
}

suite.section("classic opening: a line abreast dead upwind");
{
   const s = plan(1, false);
   eq(s.length, 2, "one spawn per enemy");
   ok(s.every((e) => Math.abs(dist(e) - Math.hypot(UPWIND_M, STAGGER_M / 2)) < 1e-6), "900 m out, half a stagger to each side");
   near(Math.hypot(s[0].x - s[1].x, s[0].z - s[1].z), STAGGER_M, 1e-6, "spaced one stagger apart");
   ok(s.every((e) => e.z > 0), "upwind of the player (wind from 0 = +z)");
   const t = plan(2, false);
   ok(s.every((e, i) => e.x === t[i].x && e.z === t[i].z), "positions do not depend on the seed");
   ok(s.every((e, i) => e.skill !== t[i].skill), "the captains' skill does");
}

suite.section("random opening");
{
   const bearings = new Set();
   let inBand = true, pointing = true;
   for (let seed = 1; seed <= 100; seed++) {
      const s = plan(seed, true, ["amelie"]);
      const e = s[0];
      if (dist(e) < SPAWN_M[0] - 1e-6 || dist(e) > SPAWN_M[1] + 1e-6) inBand = false;
      if (Math.abs(((e.heading - bearingTo(e) + 540) % 360) - 180) > 1e-6) pointing = false;
      bearings.add(Math.round(bearingTo(e) / 30));
   }
   ok(inBand, "700 to 1400 m out, 100 seeds");
   ok(pointing, "and the enemy heads for the player");
   ok(bearings.size >= 10, "from all round the compass", bearings.size + " of 12 sectors");
   const a = plan(42, true), b = plan(42, true), c = plan(43, true);
   eq(fingerprint(a.flatMap((e) => [e.x, e.z, e.heading, e.skill, e.engage])),
      fingerprint(b.flatMap((e) => [e.x, e.z, e.heading, e.skill, e.engage])), "same seed, same battle");
   ok(a[0].x !== c[0].x || a[0].z !== c[0].z, "another seed, another battle");
   const gap = Math.hypot(a[0].x - a[1].x, a[0].z - a[1].z);
   ok(gap > STAGGER_M * 0.9 - 1e-6 && gap < STAGGER_M * 1.2 + 1e-6, "two ships stay roughly a stagger apart", gap.toFixed(0) + " m");
   eq(plan(5, true, []).length, 0, "no enemies, no spawns");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
