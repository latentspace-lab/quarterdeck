// tests/damage.test.js - Schadensmodell, Wrackphysik, Ballistik und Gefecht.
// Laeuft headless mit reinem Node:  node tests/damage.test.js
import * as THREE from "three";
import { DamageModel, AMMO, sectionAt } from "../src/damage.js";
import { DebrisField, RHO } from "../src/debris.js";
import { getVessel, ENEMIES, shipsOfFaction, shipOfTier } from "../src/vessels.js";
import { FACTIONS, getFaction, enemyFactionFor } from "../src/factions.js";
import { buildWarship } from "../src/warship.js";
import { Battery, segmentBox, rangeForElevation, elevationForRange } from "../src/guns.js";
import { Ship } from "../src/ship.js";
import { Captain, sailableHeading, SCENARIOS, forcesFor } from "../src/fleet.js";
import { waterDepth, groundHeight, generateWorld, worldInfo, isOpenWater, findOpenWater } from "../src/terrain.js";
import { whitecapsForWind } from "../src/ocean.js";
import { testPair, groundStep } from "../src/collide.js";
import { seaHeight, ampForWind } from "../src/ocean.js";

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
   if (cond) { pass++; console.log("  ok    " + name + (extra ? "   [" + extra + "]" : "")); }
   else { fail++; console.log("  FAIL  " + name + (extra ? "   [" + extra + "]" : "")); }
}

const LY = getVessel("lydia");

// ------------------------------------------------------------ Schadensmodell
console.log("== Schadensmodell ==");
ok(sectionAt(0.1) === "BOW" && sectionAt(0.5) === "MID" && sectionAt(0.9) === "QUARTER",
   "Laengsposition -> Rumpfabschnitt");

function pound(vessel, ammo, n, o = {}) {
   const d = new DamageModel(vessel);
   for (let i = 0; i < n; i++) {
      d.applyHit({
         side: o.side || "STBD", s: o.s ?? (0.15 + Math.random() * 0.7),
         y: o.y ?? 2.6, ammo: AMMO[ammo], lb: o.lb ?? 18,
         range01: o.range01 ?? 0.25, freeboard: 4.3,
      });
   }
   return d;
}
const hull8 = pound(LY, "ball", 8);
ok(hull8.integrity() < 0.85 && hull8.integrity() > 0.45,
   "eine volle Breitseite kostet die Fregatte ein Viertel ihrer Gefechtskraft",
   hull8.integrity().toFixed(2));
const hull20 = pound(LY, "ball", 20);
ok(hull20.integrity() < 0.40,
   "zweieinhalb Breitseiten machen sie gefechtsunfaehig",
   hull20.integrity().toFixed(2));
ok(hull20.guns.STBD < 0.9, "Vollkugeln schlagen Rohre aus", hull20.guns.STBD.toFixed(2));
const rig20 = pound(LY, "chain", 20, { y: 14 });
ok(rig20.integrity() > 0.95, "Kettenkugeln lassen den Rumpf weitgehend heil",
   rig20.integrity().toFixed(2));
ok(rig20.sails < 0.75, "Kettenkugeln zerfetzen das Tuch", rig20.sails.toFixed(2));
ok(rig20.driveFactor() < 0.8, "und kosten Segelkraft", rig20.driveFactor().toFixed(2));

// Bordwandstaerke: der Zweidecker steckt mehr weg als die Sloop
const perHit = (id) => {
   const v = getVessel(id), d = new DamageModel(v);
   d.applyHit({ side: "STBD", s: 0.5, y: 2.6, ammo: AMMO.ball, lb: 18, range01: 0, freeboard: 4.3 });
   return 1 - d.hull.STBD_MID;
};
ok(perHit("hotspur") > perHit("lydia") && perHit("lydia") > perHit("sutherland"),
   "Schaden je Treffer sinkt mit der Bordwandstaerke",
   [perHit("hotspur"), perHit("lydia"), perHit("sutherland")].map((x) => x.toFixed(3)).join(" > "));

// Lecks unter Wasser fuellen das Schiff, die Pumpen halten wenige in Schach
const fewHoles = new DamageModel(LY);
fewHoles.holes.push({ side: "STBD", sec: "MID", below: true, size: 0.05 });
for (let i = 0; i < 3000; i++) fewHoles.update(0.1, { heel: 5 });
ok(fewHoles.flooding < 0.02, "ein kleines Leck halten die Pumpen",
   fewHoles.flooding.toFixed(3));
const manyHoles = new DamageModel(LY);
for (let i = 0; i < 9; i++) manyHoles.holes.push({ side: "STBD", sec: "MID", below: true, size: 0.06 });
let sinkT = 0;
while (!manyHoles.sunk && sinkT < 2000) { manyHoles.update(0.1, { heel: 8 }); sinkT += 0.1; }
ok(manyHoles.sunk && sinkT > 60 && sinkT < 600,
   "neun Lecks versenken sie, aber nicht sofort", sinkT.toFixed(0) + " s");

// Ruder und Flagge
const beat = pound(LY, "ball", 140);
ok(beat.beaten(), "nach schwerem Beschuss ist sie geschlagen");
const foe = new DamageModel(getVessel("amelie"), { isPlayer: false });
for (let i = 0; i < 140; i++) {
   foe.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6, ammo: AMMO.ball, lb: 18, range01: 0.2, freeboard: 4.3 });
}
foe.update(0.1, {});
ok(foe.struck, "ein geschlagener Gegner streicht die Flagge");
const me = new DamageModel(LY, { isPlayer: true });
for (let i = 0; i < 140; i++) {
   me.applyHit({ side: "STBD", s: 0.15 + Math.random() * 0.7, y: 2.6, ammo: AMMO.ball, lb: 18, range01: 0.2, freeboard: 4.3 });
}
me.update(0.1, {});
ok(!me.struck, "das Schiff des Spielers streicht nie von selbst");

// Sturm
const stormCases = [[24, 1, false], [28, 1, false], [34, 1, true], [42, 1, true], [42, 0.3, false]];
for (const [w, set, shouldBreak] of stormCases) {
   const d = new DamageModel(LY);
   let t = 0, broke = null;
   while (t < 600 && !broke) { broke = d.stressRig(0.1, { windKts: w, sailSet: set, twa: 60 }); t += 0.1; }
   ok(!!broke === shouldBreak,
      `${w} kn mit ${Math.round(set * 100)} % Tuch: ${shouldBreak ? "Mast bricht" : "haelt"}`,
      broke ? t.toFixed(0) + " s" : "600 s");
}

// Rammstoss und Grundberuehrung
const ram = new DamageModel(LY);
const rr = ram.applyRam({ closingKts: 7, otherTons: 1100, ownTons: 950, side: "STBD", s: 0.2 });
ok(ram.integrity() < 1 && rr.splinters > 0, "Rammstoss beschaedigt und wirft Splitter",
   ram.integrity().toFixed(2));
const ag = new DamageModel(LY);
ag.applyGrounding({ speedKts: 8, draft: 4.6, depth: 2.0 });
ok(ag.integrity() < 0.95 && ag.holes.some((h) => h.below),
   "Auflaufen reisst den Boden auf", ag.integrity().toFixed(2));

// ------------------------------------------------------------ Wrackphysik
console.log("\n== Wrackteile (Starrkoerper) ==");
{
   const scene = new THREE.Scene();
   const D = new DebrisField(scene, { max: 200 });
   const sea = () => 0;
   D.spawnSplinters(new THREE.Vector3(0, 6, 0), new THREE.Vector3(1, 0.2, 0), 12, { speed: 18 });
   for (let i = 0; i < 900; i++) D.update(1 / 60, { seaHeight: sea });
   const ys = D.pieces.map((p) => p.pos.y);
   ok(D.count() === 12 && Math.max(...ys) < 0.6 && Math.min(...ys) > -1.2,
      "Eichensplitter treiben an der Oberflaeche",
      Math.min(...ys).toFixed(2) + " .. " + Math.max(...ys).toFixed(2) + " m");

   const m = new THREE.Mesh(new THREE.SphereGeometry(0.16), new THREE.MeshStandardMaterial());
   const vol = 4 / 3 * Math.PI * 0.16 ** 3;
   D.addBody(m, { pos: new THREE.Vector3(0, 3, 0), mass: vol * RHO.iron, volume: vol, radius: 0.16, life: 999 });
   const iron = D.pieces[D.pieces.length - 1];
   for (let i = 0; i < 400; i++) D.update(1 / 60, { seaHeight: sea });
   ok(iron.pos.y < -5, "Eisen sinkt", iron.pos.y.toFixed(1) + " m");

   // Drehimpuls bleibt in der Luft nahezu erhalten
   const m2 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
   const p2 = D.addBody(m2, {
      pos: new THREE.Vector3(0, 400, 0), omega: new THREE.Vector3(0, 3, 0),
      mass: 50, volume: 0.08, radius: 0.5, life: 999,
   });
   const w0 = p2.omega.length();
   for (let i = 0; i < 60; i++) D.update(1 / 60, { seaHeight: sea });
   ok(p2.omega.length() > w0 * 0.9, "Rotation bleibt in der Luft weitgehend erhalten",
      w0.toFixed(2) + " -> " + p2.omega.length().toFixed(2) + " rad/s");
   D.clear();
   ok(D.count() === 0, "clear() raeumt alles ab");
}

// Trosse: ein gefallener Mast haengt am Schiff und bremst
{
   const scene = new THREE.Scene();
   const D = new DebrisField(scene);
   const anchor = new THREE.Vector3(0, 2, 0);
   const g = new THREE.Group();
   g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 20), new THREE.MeshStandardMaterial()));
   g.position.set(0, 8, 0);
   scene.add(g);
   D.capture(g, {
      mass: 12000, volume: 23, radius: 9, life: 999,
      vel: new THREE.Vector3(3, 0, 0),
      tether: { owner: "me", local: new THREE.Vector3(0, 0, 0), len: 18 },
   });
   const anchorOf = (id, local, out) => out.copy(anchor);
   for (let i = 0; i < 900; i++) D.update(1 / 60, { seaHeight: () => 0, anchorOf });
   const p = D.pieces[0];
   ok(D.hasWreckage("me"), "Wrack haengt weiter am Schiff");
   ok(p.pos.distanceTo(anchor) <= 18 * 1.25,
      "die Trosse haelt es laengsseit", p.pos.distanceTo(anchor).toFixed(1) + " m");
   ok(D.tetherLoad("me") >= 0, "Schleppwiderstand ist bezifferbar", D.tetherLoad("me").toFixed(2));
   const n = D.cutTethers("me");
   ok(n === 1 && !D.hasWreckage("me"), "gekappt treibt es ab");
}

// ------------------------------------------------------------ Ballistik
console.log("\n== Ballistik und Trefferpruefung ==");
const P = (x, y, z) => ({ x, y, z });
ok(segmentBox(P(0, 0, 0), P(1, 0, 0), 50, 52, -1, 1, -1, 1) === null,
   "Box weit voraus auf der Geraden ist kein Treffer");
ok(segmentBox(P(0, 0, 0), P(10, 0, 0), 4, 6, -1, 1, -1, 1) !== null, "Box auf der Strecke trifft");
ok(segmentBox(P(0, 0, 0), P(10, 0, 0), -6, -4, -1, 1, -1, 1) === null, "Box hinter dem Start trifft nicht");
const r1 = rangeForElevation(1, 330, 0.22), r5 = rangeForElevation(5, 330, 0.22);
ok(r5 > r1 && r1 > 300 && r1 < 600, "Wurfweite waechst mit der Erhoehung",
   r1.toFixed(0) + " m / " + r5.toFixed(0) + " m");
ok(Math.abs(rangeForElevation(elevationForRange(450, 330, 0.22), 330, 0.22) - 450) < 25,
   "Richtloesung trifft die gewuenschte Entfernung");
ok(rangeForElevation(8, 250, 0.55) < rangeForElevation(8, 330, 0.22),
   "Kettenkugel fliegt kuerzer als die Vollkugel");

function hitRate(dist, ammo, salvos = 22) {
   const scene = new THREE.Scene();
   const me = buildWarship(LY); scene.add(me);
   const foe = buildWarship(LY); foe.position.set(dist, 0, 0); scene.add(foe);
   foe.updateMatrixWorld(true);
   const tg = {
      id: "foe", heeler: foe.userData.heeler, LOA: LY.hull.loa, BEAM: LY.hull.beam,
      DRAFT: LY.hull.draft, FB: foe.userData.FB,
      rigTop: foe.userData.rigTop, rigHalfWidth: foe.userData.rigHalfWidth,
   };
   let hits = 0;
   const b = new Battery(scene, { sound: false, ownerId: "me", targets: () => [tg], onHit: () => hits++ });
   b.setShip(me, LY); b.setAmmo(ammo);
   for (let s = 0; s < salvos; s++) {
      b.reload.STBD = 0; b.fire("STBD", {});
      for (let i = 0; i < 1400; i++) b.update(0.02, { seaHeight: () => 0 });
   }
   const shots = b.status().shots * (ammo === "grape" ? AMMO.grape.pellets : 1);
   return hits / shots;
}
const h60 = hitRate(60, "ball"), h300 = hitRate(300, "ball"), h700 = hitRate(700, "ball");
ok(h60 > 0.8, "auf Pistolenschussweite sitzt fast jede Kugel", (h60 * 100).toFixed(0) + "%");
ok(h300 < h60 && h300 > 0.15, "auf 300 m trifft rund ein Drittel", (h300 * 100).toFixed(0) + "%");
ok(h700 < h300 * 0.85 && h700 < 0.25, "auf 700 m ist es Munitionsverschwendung",
   (h700 * 100).toFixed(0) + "% gegen " + (h300 * 100).toFixed(0) + "% auf 300 m");
ok(hitRate(500, "chain") < 0.05, "Kettenkugel erreicht 500 m nicht mehr");
ok(hitRate(80, "grape") > 0.5, "Kartaetsche wirkt auf kurze Distanz");
ok(hitRate(400, "grape") < 0.05, "Kartaetsche taugt nicht auf Distanz");

// ------------------------------------------------------------ Modell
console.log("\n== Schiff zerlegen ==");
{
   const ship = buildWarship(LY);
   const before = ship.userData.sails.length;
   const d = ship.detachMast("main");
   ok(d && d.mass > 6000 && d.mass < 25000, "Grossmast wiegt ein gutes Dutzend Tonnen",
      (d.mass / 1000).toFixed(1) + " t");
   ok(ship.mastLost("main"), "der Mast gilt als verloren");
   ok(ship.detachMast("main") === null, "ein zweites Mal geht er nicht ueber Bord");
   let err = null;
   try { for (let i = 0; i < 40; i++) ship.animate(0.05, { awaRel: 100, windKts: 18, time: i * 0.05 }); }
   catch (e) { err = e; }
   ok(!err, "animate() laeuft nach dem Mastbruch weiter");
   ok(before === ship.userData.sails.length, "die Segelliste bleibt konsistent");
   ship.setStruck(true);
   ok(ship.isStruck(), "Flagge gestrichen");
}

// ------------------------------------------------------------ Gelaende
console.log("\n== Untiefen ==");
// Die Seekarte wird jetzt gewuerfelt - der Test erzeugt eine feste Welt und
// sucht sich Riff und Insel darin selbst.
const WORLD = generateWorld(20250913);
ok(WORLD.islands.length >= 2, "der Generator legt ein Archipel an",
   WORLD.islands.length + " Inseln, " + WORLD.reefs.length + " Riffe");
ok(waterDepth(0, 0) > 20, "offenes Wasser ist tief", waterDepth(0, 0).toFixed(0) + " m");
// flachste Stelle aller Untiefen suchen
let SHOAL = null, PEAK = null;
for (const f of [...WORLD.islands, ...WORLD.reefs]) {
   const d = waterDepth(f.x, f.z);
   if (!SHOAL || d < SHOAL.d) SHOAL = { x: f.x, z: f.z, d };
   const h = groundHeight(f.x, f.z);
   if (!PEAK || h > PEAK.h) PEAK = { x: f.x, z: f.z, h };
}
ok(SHOAL && SHOAL.d < LY.hull.draft * 1.12, "auf dem Riff laeuft die Fregatte auf",
   SHOAL ? SHOAL.d.toFixed(1) + " m" : "kein Riff");
ok(PEAK && PEAK.h > 40, "die Insel ragt aus dem Wasser",
   PEAK.h.toFixed(0) + " m");

// ------------------------------------------------------------ Gefecht
console.log("\n== Kapitaene und Gefecht ==");
ok(sailableHeading(0, 0, 65) === 65 || sailableHeading(0, 0, 65) === 295,
   "ein Kurs in der No-Go-Zone wird auf die segelbare Kante gelegt");
ok(sailableHeading(120, 0, 65) === 120, "segelbare Kurse bleiben unveraendert");
ok(SCENARIOS.length === 3, "drei Gefechtslagen");
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

// Ein vollstaendiges Gefecht: beide Seiten KI-gefuehrt
{
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 400 });
   const all = [];
   const targets = () => all.map((s) => s.targetInfo());
   const onHit = (h) => h.target.ship.takeHit(h);
   const mk = (id, x, z, hd) => {
      const s = new Ship({ vessel: getVessel(id), scene, debris, targets, onHit, sound: false });
      s.place(x, z, hd, 5); all.push(s); return s;
   };
   const A = mk("lydia", 0, 0, 90);
   const B = mk("amelie", 300, 90, 270);
   const capA = new Captain(A, { doctrine: "hull", skill: 1.0, engage: 160 });
   const capB = new Captain(B, { doctrine: "rig", skill: 0.85, engage: 220 });
   const wind = { dir: 20, speedKts: 16 };
   const amp = ampForWind(wind.speedKts), waveRad = Math.PI;
   let t = 0; const dt = 1 / 30;
   const anchorOf = (id, local, out) => { const s = all.find((a) => a.id === id); return s ? s.anchorPoint(local, out) : null; };
   let peakDebris = 0, shots = 0;
   while (t < 1200 && !A.dmg.struck && !B.dmg.struck && !A.dmg.sunk && !B.dmg.sunk) {
      const gunCtx = { windDir: wind.dir, windSpeed: wind.speedKts, seaHeight: (x, z) => seaHeight(x, z, t, waveRad, amp) * 0.9 };
      const ctx = { wind, t, waveRad, amp, gunCtx };
      capA.update(dt, { wind, target: B }); capB.update(dt, { wind, target: A });
      A.update(dt, ctx); B.update(dt, ctx);
      A.battery.update(dt, gunCtx); B.battery.update(dt, gunCtx);
      debris.update(dt, { seaHeight: gunCtx.seaHeight, windSpeed: wind.speedKts, windVec: { x: 0, z: 1 }, anchorOf });
      peakDebris = Math.max(peakDebris, debris.count());
      t += dt;
   }
   shots = A.battery.status().shots + B.battery.status().shots;
   ok(t < 1200, "das Gefecht wird entschieden", t.toFixed(0) + " s");
   ok(shots > 50, "es wird ordentlich geschossen", shots + " Schuss");
   ok(peakDebris > 20, "Splitter und Wrackteile fliegen", peakDebris + " Teile");
   const loser = A.dmg.struck || A.dmg.sunk ? A : B;
   ok(loser.dmg.integrity() < 0.99 || loser.dmg.flooding > 0.1 || loser.dmg.mastsStanding() < 3,
      "der Verlierer ist sichtbar gezeichnet",
      "Rumpf " + loser.dmg.integrity().toFixed(2) + ", Leck " + loser.dmg.flooding.toFixed(2)
      + ", Masten " + loser.dmg.mastsStanding());
   // Kollisionspruefung
   B.place(A.pos.x + 4, A.pos.z + 2, A.dyn.heading, 3);
   ok(testPair(A, B) !== null, "dicht beieinander wird eine Kollision erkannt");
   B.place(A.pos.x + 400, A.pos.z, A.dyn.heading, 3);
   ok(testPair(A, B) === null, "auf Distanz nicht");
   // Grundberuehrung
   A.place(SHOAL.x, SHOAL.z, 0, 8);
   const g = groundStep(A, waterDepth, 0.1);
   ok(g !== null, "Grundberuehrung auf dem Riff wird erkannt",
      g ? "Tiefe " + g.depth.toFixed(1) + " m bei " + A.vessel.hull.draft + " m Tiefgang" : "nicht erkannt");
   ok(g && g.hard && A.dyn.stopped, "hart aufgelaufen: das Schiff sitzt fest");
   A.place(0, 0, 0, 8);
   ok(groundStep(A, waterDepth, 0.1) === null, "im tiefen Wasser passiert nichts");
   const free = findOpenWater({ maxDist: 900, minDepth: 20 });
   ok(isOpenWater(free.x, free.z, 20, 220),
      "der Generator findet einen freien Startplatz",
      "(" + free.x.toFixed(0) + ", " + free.z.toFixed(0) + ")");
}


// ------------------------------------------------------- Kippen und Reissen
console.log("\n== Mast kippt, Tuch reisst ==");
{
   // Ein senkrecht schwimmendes Rundholz MUSS flach umkippen. Mit einem
   // einzigen Auftriebspunkt bliebe es wie eine Spierentonne stehen.
   const scene = new THREE.Scene();
   const D = new DebrisField(scene);
   const g = new THREE.Group();
   g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 42, 8), new THREE.MeshStandardMaterial()));
   scene.add(g);
   const H = 42, vol = 23, mass = vol * 520;
   const probes = DebrisField.probesAlongAxis(new THREE.Vector3(0, 1, 0), -H / 2, H / 2, vol, 11, null, 0.5);
   const pc = D.addBody(g, {
      pos: new THREE.Vector3(0, 0, 0), mass, volume: vol, radius: 0.5,
      inertia: mass * H * H / 12, probes, life: 9999,
      omega: new THREE.Vector3(0, 0, 0.08), angDrag: 0.55,
   });
   const up = new THREE.Vector3();
   const tiltNow = () => {
      up.set(0, 1, 0).applyQuaternion(pc.quat);
      return Math.acos(Math.max(-1, Math.min(1, Math.abs(up.y)))) * 180 / Math.PI;
   };
   for (let i = 0; i < 60 * 60; i++) D.update(1 / 60, { seaHeight: () => 0 });
   ok(tiltNow() > 70, "ein schwimmendes Rundholz legt sich flach", tiltNow().toFixed(0) + "° aus der Senkrechten");
   ok(Math.abs(pc.pos.y) < 2, "und treibt an der Oberflaeche", pc.pos.y.toFixed(2) + " m");
}
{
   // Ein abgeschossener Mast geht ueber Bord, kippt und bleibt im Tauwerk
   const scene = new THREE.Scene();
   const D = new DebrisField(scene, { max: 300 });
   const all = [];
   const sh = new Ship({ vessel: LY, scene, debris: D, targets: () => [], sound: false });
   sh.place(0, 0, 90, 7); all.push(sh);
   const wind = { dir: 20, speedKts: 16 };
   const amp = ampForWind(16), wr = Math.PI;
   let t = 0; const dt = 1 / 60;
   const anchorOf = (id, local, out) => { const a = all.find((x) => x.id === id); return a ? a.anchorPoint(local, out) : null; };
   const run = (T) => { while (t < T) { sh.update(dt, { wind, t, waveRad: wr, amp }); D.update(dt, { seaHeight: (x, z) => seaHeight(x, z, t, wr, amp) * 0.9, windSpeed: 16, windVec: { x: 0, z: 1 }, anchorOf }); t += dt; } };
   run(1);
   const speedBefore = sh.dyn.speed;
   sh._dropMast("main", "shot");
   const piece = D.pieces.find((p) => p.tether);
   ok(!!piece, "der Mast wird als Starrkoerper uebernommen");
   const up = new THREE.Vector3();
   const tilt = () => { up.set(0, 1, 0).applyQuaternion(piece.quat); return Math.acos(Math.max(-1, Math.min(1, up.y))) * 180 / Math.PI; };
   run(3);
   const t3 = tilt();
   run(7);
   const t7 = tilt();
   ok(t3 > 8, "er faengt sofort an zu kippen", t3.toFixed(0) + "° nach 2 s");
   ok(t7 > 70, "und liegt nach wenigen Sekunden im Wasser", t7.toFixed(0) + "° nach 6 s");
   run(120);
   const d = Math.hypot(piece.pos.x - sh.pos.x, piece.pos.z - sh.pos.z);
   ok(Number.isFinite(d) && d < 60, "nach zwei Minuten haengt er immer noch laengsseit",
      d.toFixed(0) + " m");
   ok(piece.vel.length() < 12 && piece.omega.length() < 4,
      "die Trosse bleibt numerisch stabil",
      "|v|=" + piece.vel.length().toFixed(1) + " |w|=" + piece.omega.length().toFixed(2));
   ok(sh.wreckDrag > 0.2, "das Wrack bremst spuerbar", sh.wreckDrag.toFixed(2));
   ok(sh.dyn.speed < speedBefore, "und kostet Fahrt",
      speedBefore.toFixed(1) + " -> " + sh.dyn.speed.toFixed(1) + " kn");
   const cut = sh.cutAwayWreckage();
   ok(cut === 1 && !D.hasWreckage(sh.id), "X kappt es los");
}
{
   // Tuch reisst schrittweise auf und fliegt am Ende aus den Lieken
   const scene = new THREE.Scene();
   const D = new DebrisField(scene, { max: 400 });
   const sh = new Ship({ vessel: LY, scene, debris: D, targets: () => [], sound: false });
   sh.place(0, 0, 90, 6);
   const wind = { dir: 20, speedKts: 18 };
   const amp = ampForWind(18), wr = Math.PI;
   let t = 0; const dt = 1 / 60;
   const run = (T) => { while (t < T) { sh.update(dt, { wind, t, waveRad: wr, amp }); D.update(dt, { seaHeight: () => 0, windSpeed: 18, windVec: { x: 0, z: 1 } }); t += dt; } };
   run(0.5);
   const s0 = sh.model.sailStates();
   ok(s0.every((x) => x.tears === 0 && !x.blown), "heiles Tuch hat keine Risse");
   sh.dmg.sails = 0.75; sh._syncAppearance(); run(1.5);
   const s1 = sh.model.sailStates();
   ok(s1.reduce((a, c) => a + c.tears, 0) > 4 && s1.every((x) => !x.blown),
      "leichter Schaden reisst Bahnen auf, aber nichts fliegt weg",
      s1.reduce((a, c) => a + c.tears, 0) + " Risse");
   ok(s1.find((x) => x.level === "topgallant").health < s1.find((x) => x.level === "course").health,
      "die oberen Segel leiden zuerst");
   sh.dmg.sails = 0.25; sh._syncAppearance(); run(3);
   const blown = sh.drainEvents().filter((e) => e.type === "sailBlown");
   const s2 = sh.model.sailStates();
   ok(blown.length > 0 && s2.some((x) => x.blown),
      "bei schwerem Schaden fliegt Tuch aus den Lieken", blown.length + " Segel");
   ok(D.count() > 6, "und treibt als Fetzen davon", D.count() + " Teile");
   ok(s2.some((x) => !x.blown), "die Untersegel halten am laengsten");
   // gezielter Treffer in ein bestimmtes Segel
   const h0 = sh.model.sailStates().find((x) => x.level === "course" && x.mast === "fore").health;
   sh.model.damageSail("fore", "course", 0.3);
   const h1 = sh.model.sailStates().find((x) => x.level === "course" && x.mast === "fore").health;
   ok(h1 < h0 - 0.2, "ein Treffer beschaedigt genau das getroffene Segel",
      h0.toFixed(2) + " -> " + h1.toFixed(2));
}

// Mastbruch kostet Leute - auch ohne einen einzigen Schuss
{
   const scene = new THREE.Scene();
   const D = new DebrisField(scene, { max: 300 });
   const sh = new Ship({ vessel: getVessel("sutherland"), scene, debris: D, targets: () => [], sound: false });
   sh.place(0, 0, 90, 6);
   const before = sh.crew.status();
   const wind = { dir: 20, speedKts: 42 };
   const amp = ampForWind(42);
   let t = 0; const dt = 1 / 30;
   while (t < 400 && sh.dmg.mastsStanding() > 0) {
      sh.update(dt, { wind, t, waveT: t, waveRad: Math.PI, amp, lambda: 1 });
      D.update(dt, { seaHeight: () => 0 });
      t += dt;
   }
   const after = sh.crew.status();
   ok(sh.dmg.mastsStanding() === 0, "voll besegelt im Sturm: alle Masten gehen ueber Bord",
      t.toFixed(0) + " s");
   ok(after.fit < before.fit, "das kostet Leute, obwohl kein Schuss fiel",
      before.fit + " -> " + after.fit);
   const top = after.roles.find((r) => r.id === "top");
   const gun = after.roles.find((r) => r.id === "gun");
   ok(top.frac < gun.frac, "es trifft vor allem die Toppsgasten in den Wanten",
      "Toppsgasten " + (top.frac * 100).toFixed(0) + "%, Geschuetze " + (gun.frac * 100).toFixed(0) + "%");
   ok(after.morale < 0.8, "und die Moral bricht ein", (after.morale * 100).toFixed(0) + "%");
}

// Weisskappen und Seegang haengen am Wind
{
   ok(whitecapsForWind(5) < 0.05 && whitecapsForWind(25) > 0.5 && whitecapsForWind(38) > 0.95,
      "Weisskappen nehmen mit dem Wind zu",
      [5, 25, 38].map((k) => (whitecapsForWind(k) * 100).toFixed(0) + "%").join(" / "));
}

console.log("\n=== Schaden: " + pass + " bestanden, " + fail + " gescheitert ===");
if (fail > 0) process.exit(1);
