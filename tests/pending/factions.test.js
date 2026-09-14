// tests/pending/factions.test.js - NOT YET IMPLEMENTED
//
// These cases lived in tests/damage.test.js until Phase 0 and, while there,
// prevented `npm test` from even starting: the file imported `forcesFor`,
// `shipsOfFaction` and `shipOfTier`, none of which exist anywhere in the
// project. The import failed, so NONE of the 100+ other cases in
// damage.test.js ran - not even the ones that would long since have been
// green.
//
// What is missing before this file can run:
//
//   1. vessels: the fields `faction`, `tier` and `paint` on every entry.
//   2. vessels: six ships that factions.js already names but which do not
//      exist in the catalogue - descubierta, gamo, nepomuceno (Armada), and
//      seeteufel, rache, schwarzekrone (pirates). getVessel() silently falls
//      back to the yacht for them.
//   3. vessels: shipsOfFaction(factionId) and shipOfTier(factionId, tier).
//   4. fleet: forcesFor(scenarioId, vessel, enemyFaction) - opponents that
//      fit the faction instead of the hardwired SCENARIOS[].forces table.
//   5. damage: the `neverStrikes` option, so pirates never strike their
//      colours (factions.js already knows the flag).
//
// This is a content feature, not part of the multiplayer conversion, which
// is why it lives here and not in the standard suite. `node tests/run.js
// --pending` runs it as well.

import * as THREE from "three";
import { DamageModel, AMMO } from "../../packages/client/src/damage.js";
import { getVessel, ENEMIES, shipsOfFaction, shipOfTier } from "../../packages/client/src/vessels.js";
import { FACTIONS, getFaction, enemyFactionFor } from "../../packages/client/src/factions.js";
import { SCENARIOS, forcesFor } from "../../packages/client/src/fleet.js";

import { createSuite } from "../lib/harness.js";

const suite = createSuite("Factions (open)");
const ok = suite.ok;

ok(ENEMIES.length === 3 && ENEMIES.every((v) => v.faction === "fr"),
   "three French ships in the catalogue");

// ---- Factions ---------------------------------------------------------
console.log("\n== Factions ==");
ok(FACTIONS.length === 4, "four factions", FACTIONS.map((f) => f.short).join(" "));
for (const f of FACTIONS) {
   const list = shipsOfFaction(f.id);
   ok(list.length >= 3, f.name + ": at least three ships", list.map((v) => v.name).join(", "));
   // shipOfTier() needs every size class filled. Several ships in the same
   // class are allowed - as an opponent it picks the first of them.
   ok([1, 2, 3].every((t) => list.some((v) => v.tier === t)),
      f.name + ": every size class filled", list.map((v) => v.tier).join());
   ok(list.every((v) => v.guns && v.paint && v.rig === "square"),
      f.name + ": all armed, each with its own paint scheme");
}
ok(shipsOfFaction("yacht").length === 0 && getVessel("yacht").faction === null,
   "the yacht belongs to no faction");
// Every faction has an enemy, and never itself
for (const f of FACTIONS) {
   const e = enemyFactionFor(f.id);
   ok(e && e.id !== f.id, f.name + " has an enemy", e.name);
}
// Battle scenarios work with every pairing
let combos = 0, bad = 0;
for (const f of FACTIONS) {
   for (const v of shipsOfFaction(f.id)) {
      for (const sc of SCENARIOS) {
         const force = forcesFor(sc.id, v, enemyFactionFor(f.id));
         combos++;
         if (!force.length || force.some((x) => !x || !x.guns)) bad++;
      }
   }
}
ok(bad === 0, "every combination of faction, ship and scenario yields opponents",
   combos + " combinations checked");
ok(shipOfTier("es", 3).name === "San Juan Nepomuceno", "size class 3 of the Armada");
// The Indefatigable shares the second class with the Lydia. The opponent
// stays the Lydia - otherwise a playable ship would have shifted the
// opponent list.
ok(shipOfTier("gb", 2).name === "Lydia", "the British class-two ship stays the Lydia",
   shipOfTier("gb", 2).name);

// Pirates never strike their colours
{
   const pir = shipsOfFaction("pirate")[1];
   const d = new DamageModel(pir, { isPlayer: false, neverStrikes: true });
   for (let i = 0; i < 200; i++) {
      d.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6,
         ammo: AMMO.ball, lb: 24, range01: 0.1, freeboard: 4 });
   }
   d.update(0.1, {});
   ok(d.beaten() && !d.struck, "a beaten pirate still does not strike");
   const nav = new DamageModel(pir, { isPlayer: false });
   for (let i = 0; i < 200; i++) {
      nav.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6,
         ammo: AMMO.ball, lb: 24, range01: 0.1, freeboard: 4 });
   }
   nav.update(0.1, {});
   ok(nav.struck, "a warship of the same build does");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
