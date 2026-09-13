// tests/pending/factions.test.js - NOCH NICHT IMPLEMENTIERT
//
// Diese Faelle standen bis Phase 0 in tests/damage.test.js und haben dort
// verhindert, dass `npm test` ueberhaupt startet: die Datei importierte
// `forcesFor`, `shipsOfFaction` und `shipOfTier`, die es nirgends im Projekt
// gibt. Der Import schlug fehl, also lief KEINER der 100+ uebrigen Faelle in
// damage.test.js - auch die nicht, die laengst gruen gewesen waeren.
//
// Was fehlt, damit diese Datei laufen kann:
//
//   1. vessels: die Felder `faction`, `tier` und `paint` an jedem Eintrag.
//   2. vessels: sechs Schiffe, die factions.js bereits namentlich auffuehrt,
//      aber die es im Katalog nicht gibt - descubierta, gamo, nepomuceno
//      (Armada) sowie seeteufel, rache, schwarzekrone (Piraten).
//      getVessel() faellt fuer sie stillschweigend auf die Yacht zurueck.
//   3. vessels: shipsOfFaction(factionId) und shipOfTier(factionId, tier).
//   4. fleet: forcesFor(scenarioId, vessel, enemyFaction) - Gegner passend
//      zur Partei statt der fest verdrahteten SCENARIOS[].forces-Tabelle.
//   5. damage: die Option `neverStrikes`, damit Piraten die Flagge nie
//      streichen (factions.js kennt das Flag bereits).
//
// Das ist ein Inhalts-Feature, kein Teil der Multiplayer-Umstellung, deshalb
// liegt es hier und nicht in der Standard-Suite. `node tests/run.js --pending`
// fuehrt es mit aus.

import * as THREE from "three";
import { DamageModel, AMMO } from "../../packages/client/src/damage.js";
import { getVessel, ENEMIES, shipsOfFaction, shipOfTier } from "../../packages/client/src/vessels.js";
import { FACTIONS, getFaction, enemyFactionFor } from "../../packages/client/src/factions.js";
import { SCENARIOS, forcesFor } from "../../packages/client/src/fleet.js";

import { createSuite } from "../lib/harness.js";

const suite = createSuite("Parteien (offen)");
const ok = suite.ok;

ok(ENEMIES.length === 3 && ENEMIES.every((v) => v.faction === "fr"),
   "drei franzoesische Schiffe im Katalog");

// ---- Parteien -------------------------------------------------------------
console.log("\n== Parteien ==");
ok(FACTIONS.length === 4, "vier Parteien", FACTIONS.map((f) => f.short).join(" "));
for (const f of FACTIONS) {
   const list = shipsOfFaction(f.id);
   ok(list.length >= 3, f.name + ": mindestens drei Schiffe", list.map((v) => v.name).join(", "));
   // shipOfTier() braucht jede Groessenklasse besetzt. Mehrere Schiffe in
   // derselben Klasse sind erlaubt - als Gegner zieht es davon das erste.
   ok([1, 2, 3].every((t) => list.some((v) => v.tier === t)),
      f.name + ": jede Groessenklasse besetzt", list.map((v) => v.tier).join());
   ok(list.every((v) => v.guns && v.paint && v.rig === "square"),
      f.name + ": alle bewaffnet, eigener Anstrich");
}
ok(shipsOfFaction("yacht").length === 0 && getVessel("yacht").faction === null,
   "die Yacht gehoert keiner Partei an");
// Jede Partei hat einen Gegner, und nie sich selbst
for (const f of FACTIONS) {
   const e = enemyFactionFor(f.id);
   ok(e && e.id !== f.id, f.name + " hat einen Gegner", e.name);
}
// Gefechtslagen funktionieren mit jeder Paarung
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
ok(bad === 0, "jede Kombination aus Partei, Schiff und Lage ergibt Gegner",
   combos + " Kombinationen geprueft");
ok(shipOfTier("es", 3).name === "San Juan Nepomuceno", "Groessenklasse 3 der Armada");
// Die Indefatigable teilt sich die zweite Klasse mit der Lydia. Gegner bleibt
// die Lydia - sonst haette ein fahrbares Schiff die Gegnerliste verschoben.
ok(shipOfTier("gb", 2).name === "Lydia", "britischer Zweier bleibt die Lydia",
   shipOfTier("gb", 2).name);

// Piraten streichen nie die Flagge
{
   const pir = shipsOfFaction("pirate")[1];
   const d = new DamageModel(pir, { isPlayer: false, neverStrikes: true });
   for (let i = 0; i < 200; i++) {
      d.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6,
         ammo: AMMO.ball, lb: 24, range01: 0.1, freeboard: 4 });
   }
   d.update(0.1, {});
   ok(d.beaten() && !d.struck, "ein geschlagener Pirat streicht trotzdem nicht");
   const nav = new DamageModel(pir, { isPlayer: false });
   for (let i = 0; i < 200; i++) {
      nav.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6,
         ammo: AMMO.ball, lb: 24, range01: 0.1, freeboard: 4 });
   }
   nav.update(0.1, {});
   ok(nav.struck, "ein Kriegsschiff derselben Bauart schon");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
