// tests/vessels.test.js - Schiffskatalog, Rahsegler-Modell, Brassen, Batterie.
// Laeuft headless mit reinem Node:  node tests/vessels.test.js
import * as THREE from "three";
import { VESSELS, getVessel, vesselLabel, gunCount, broadsideWeight } from "../src/vessels.js";
import { buildWarship } from "../src/warship.js";
import { buildSailboat } from "../src/boat.js";
import { Battery } from "../src/guns.js";
import { BoatDynamics, polarSpeedAt, isLuffing, pointOfSail, profileFromVessel } from "../src/physics.js";
import { makeTrainer } from "../src/trainer.js";
import { clamp } from "../src/utils.js";

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
   if (cond) { pass++; console.log("  ok    " + name + (extra ? "   [" + extra + "]" : "")); }
   else { fail++; console.log("  FAIL  " + name + (extra ? "   [" + extra + "]" : "")); }
}

// ---------------------------------------------------------------- Katalog
console.log("== Schiffskatalog ==");
ok(VESSELS.length === 5, "fuenf Schiffe im Katalog", String(VESSELS.length));
ok(VESSELS.filter((v) => v.rig === "square").length === 4, "vier Rahsegler");
ok(getVessel("lydia").name === "Lydia" && vesselLabel(getVessel("lydia")) === "HMS Lydia",
   "HMS Lydia gefunden");
ok(getVessel("gibtsnicht").id === "yacht", "unbekannte ID faellt auf die Yacht zurueck");
// getVessel() faellt still auf die Yacht zurueck. Fehlt einem Eintrag die id,
// segelt die halbe Flotte unbemerkt als Jolle - darum jede id einzeln pruefen.
ok(VESSELS.every((v) => v.id && getVessel(v.id).name === v.name),
   "jedes Schiff im Katalog hat eine eigene id",
   VESSELS.map((v) => v.id).join(", "));
const indy = polarSpeedAt(140, 15, 1, 1, getVessel("indefatigable").sail.polar);
const lyd = polarSpeedAt(140, 15, 1, 1, getVessel("lydia").sail.polar);
ok(getVessel("indefatigable").name === "Indefatigable" && indy > lyd,
   "die Indefatigable laeuft der Lydia davon",
   indy.toFixed(2) + " kn vs " + lyd.toFixed(2) + " kn");
ok(gunCount(getVessel("yacht")) === 0 && getVessel("yacht").guns === null,
   "die Yacht fuehrt keine Geschuetze");
ok(gunCount(getVessel("hotspur")) === 20, "Hotspur: 20 Rohre", String(gunCount(getVessel("hotspur"))));
ok(gunCount(getVessel("sutherland")) === 56 && broadsideWeight(getVessel("sutherland")) === 700,
   "Sutherland: 56 Rohre / 700 lb Breitseite");
// Groesse und Traegheit steigen monoton vom Sloop zum Linienschiff
const order = ["hotspur", "lydia", "sutherland"].map(getVessel);
ok(order[0].hull.loa < order[1].hull.loa && order[1].hull.loa < order[2].hull.loa,
   "Laenge steigt Sloop < Fregatte < Linienschiff");
ok(order[0].dyn.turnRate > order[1].dyn.turnRate && order[1].dyn.turnRate > order[2].dyn.turnRate,
   "Drehrate sinkt mit der Groesse");
ok(order[0].sail.noGo < order[2].sail.noGo, "das Linienschiff kreuzt am schlechtesten");

// ---------------------------------------------------------------- Physik
console.log("\n== Rahsegler-Physik ==");
const yacht = getVessel("yacht"), frig = getVessel("lydia");
ok(polarSpeedAt(45, 15, 1, 1, frig.sail.polar) === 0,
   "Fregatte macht bei 45 Grad TWA keine Fahrt (No-Go)");
ok(polarSpeedAt(45, 15, 1, 1, yacht.sail.polar) > 6,
   "Yacht kreuzt bei 45 Grad mit ueber 6 kn");
ok(polarSpeedAt(135, 15, 1, 1, frig.sail.polar) > 8,
   "Fregatte laeuft auf Backstagsbrise ueber 8 kn",
   polarSpeedAt(135, 15, 1, 1, frig.sail.polar).toFixed(1));
// Schnellster Kurs: Yacht am Beam, Rahsegler achterlicher
function bestTwa(polar) {
   let best = 0, bt = 0;
   for (let t = 0; t <= 180; t += 1) {
      const v = polarSpeedAt(t, 15, 1, 1, polar);
      if (v > best) { best = v; bt = t; }
   }
   return bt;
}
ok(bestTwa(yacht.sail.polar) < 115, "Yacht ist am schnellsten bis ~110 Grad TWA", String(bestTwa(yacht.sail.polar)));
ok(bestTwa(frig.sail.polar) >= 125, "Fregatte ist am schnellsten achterlicher als 125 Grad", String(bestTwa(frig.sail.polar)));
ok(isLuffing(60, 15, frig.sail.noGo) && !isLuffing(60, 15, yacht.sail.noGo),
   "60 Grad: Fregatte liegt back, Yacht segelt");
ok(pointOfSail(120, false, "square") === "Backstagsbrise (Broad Reach)",
   "Rahsegler-Bezeichnungen", pointOfSail(120, false, "square"));
ok(pointOfSail(120, false) === "Groesserer Raumschot", "Yacht-Bezeichnungen unveraendert");

// Fahrt aufnehmen: das Linienschiff braucht laenger als die Yacht
function runUp(vessel, twa, secs, windKts = 15) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   const wind = { dir: twa, speedKts: windKts };
   for (let i = 0; i < secs * 20; i++) b.step(0.05, wind);
   return b.speed;
}
const y30 = runUp(yacht, 100, 30), f30 = runUp(frig, 135, 30), s30 = runUp(getVessel("sutherland"), 135, 30);
const f300 = runUp(frig, 135, 300);
ok(y30 > 9, "Yacht ist nach 30 s auf Fahrt", y30.toFixed(1) + " kn");
ok(f30 < f300 * 0.85, "Fregatte ist nach 30 s noch nicht ausgelaufen",
   f30.toFixed(1) + " -> " + f300.toFixed(1) + " kn (" + Math.round(100 * f30 / f300) + "%)");
ok(runUp(frig, 135, 150) > f300 * 0.95, "nach 2,5 Minuten liegt sie auf Marschfahrt",
   runUp(frig, 135, 150).toFixed(1) + " kn");
ok(s30 < f30, "Linienschiff beschleunigt langsamer als die Fregatte",
   s30.toFixed(1) + " < " + f30.toFixed(1));

// Reffen kostet Fahrt und Krengung
function reefed(vessel, set) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   b.sailSet = set;
   const wind = { dir: 135, speedKts: 24 };
   for (let i = 0; i < 6000; i++) b.step(0.05, wind);
   return { speed: b.speed, heel: b.heel };
}
const full = reefed(frig, 1), reef = reefed(frig, 0.3);
ok(reef.speed < full.speed * 0.85, "gerefft ist langsamer",
   full.speed.toFixed(1) + " -> " + reef.speed.toFixed(1) + " kn");
ok(reef.heel < full.heel, "gerefft kraengt weniger",
   full.heel.toFixed(1) + " -> " + reef.heel.toFixed(1) + " Grad");
ok(reefed(yacht, 0.3).speed === reefed(yacht, 1).speed, "Reffen wirkt nicht auf die Yacht");

// Kriegsschiffe kentern nicht im Sturm
const storm = new BoatDynamics({ vessel: frig, heading: 0 });
for (let i = 0; i < 4000; i++) storm.step(0.05, { dir: 75, speedKts: 34 });
ok(!storm.isCapsized && storm.heel < frig.dyn.capsizeHeel,
   "Fregatte uebersteht 34 kn ohne zu kentern", storm.heel.toFixed(1) + " Grad Krengung");

// Wende: ein Rahsegler muss durch den Wind kommen
function tack(vessel) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   const noGo = vessel.sail.noGo;
   const wind = { dir: noGo + 8, speedKts: 15 }; // TWA anfangs knapp ueber No-Go
   for (let i = 0; i < 4000; i++) b.step(0.05, wind); // Fahrt aufnehmen
   const startTack = b.tack;
   b.snapRudder(-1);
   let t = 0;
   for (let i = 0; i < 4000; i++) { b.step(0.05, wind); t += 0.05; if (b.tack !== startTack) break; }
   return { switched: b.tack !== startTack, t, speed: b.speed };
}
const tf = tack(frig);
ok(tf.switched, "Fregatte kommt durch den Wind", tf.t.toFixed(0) + " s");
ok(tf.speed > 0.5, "Fregatte behaelt dabei Fahrt im Schiff", tf.speed.toFixed(1) + " kn");

// Profil aus dem Katalog
const P = profileFromVessel(frig);
ok(P.rig === "square" && P.noGo === 65 && P.turnRate === 9.5, "Profil kommt aus dem Katalog");

// ---------------------------------------------------------------- 3D-Modell
console.log("\n== Rahsegler-Modell ==");
for (const id of ["hotspur", "lydia", "sutherland"]) {
   const v = getVessel(id);
   const ship = buildWarship(v);
   const ud = ship.userData;
   const box = new THREE.Box3().setFromObject(ship);
   ok(Number.isFinite(box.min.x + box.max.y), id + ": Geometrie endlich");
   ok(box.max.y > v.hull.loa * 0.75, id + ": Masttop ueber 3/4 der Rumpflaenge",
      box.max.y.toFixed(1) + " m");
   ok(Math.abs(box.min.y + v.hull.draft) < v.hull.draft * 0.6, id + ": Tiefgang plausibel",
      box.min.y.toFixed(1) + " m");
   ok(Object.keys(ud.masts).length === 3, id + ": drei Masten");
   const perSide = v.guns.decks.reduce((n, d) => n + d.count, 0);
   ok(ud.muzzles.PORT.length === perSide && ud.muzzles.STBD.length === perSide,
      id + ": " + perSide + " Muendungen je Seite");
   ok(ud.muzzles.STBD.every((m) => m.x > 0) && ud.muzzles.PORT.every((m) => m.x < 0),
      id + ": Muendungen auf der richtigen Seite");
   ok(ud.sails.length >= 6, id + ": " + ud.sails.length + " Segel");
}

// Brassen: Rahwinkel = 90 - |AwA|/2, begrenzt auf 45 Grad, Luvnock nach achtern
console.log("\n== Brassen ==");
const ship = buildWarship(frig);
function braceAt(awaRel) {
   // genug Frames, damit das traege Rigg den Zielwinkel erreicht
   for (let i = 0; i < 600; i++) ship.animate(0.05, { awaRel, windKts: 14, time: i * 0.05 });
   return (ship.userData.yards[0].yardGroup.rotation.y * 180) / Math.PI;
}
const b180 = braceAt(180), b140 = braceAt(140), b90 = braceAt(90), b70 = braceAt(70), bm90 = braceAt(-90);
ok(Math.abs(b180) < 1.5, "vor dem Wind stehen die Rahen quer", b180.toFixed(1) + " Grad");
ok(Math.abs(b140 - 20) < 2, "140 Grad AwA -> 20 Grad gebrasst", b140.toFixed(1));
ok(Math.abs(b90 - 45) < 2, "am Beam ist die Brasse am Anschlag (45 Grad)", b90.toFixed(1));
ok(Math.abs(b70 - 45) < 2, "hart am Wind: nicht spitzer als 45 Grad", b70.toFixed(1));
ok(bm90 < -40, "Wind von Backbord dreht die Rahen andersherum", bm90.toFixed(1));
ok(ship.userData.yards.every((y) => Math.abs(y.yardGroup.rotation.y - ship.userData.yards[0].yardGroup.rotation.y) < 1e-6),
   "alle Rahen werden gemeinsam gebrasst");

// Segel: Bauch liegt nach Lee
const sailPos = ship.userData.yards.find((y) => y.mesh).mesh.geometry.attributes.position;
let anyZ = 0;
for (let i = 0; i < sailPos.count; i++) anyZ += Math.abs(sailPos.getZ(i));
ok(anyZ > 0, "das Tuch woelbt sich (Bauch != 0)", anyZ.toFixed(1));

// ---------------------------------------------------------------- Batterie
console.log("\n== Batterie ==");
const scene = new THREE.Scene();
scene.add(ship);
const bat = new Battery(scene, { sound: false });
bat.setShip(ship, frig);
ok(bat.enabled && bat.gunsPerSide() === 13, "Batterie angemeldet: 13 Rohre je Seite");
ok(bat.fire("PORT", {}), "Backbord feuert");
ok(!bat.fire("PORT", {}), "zweite Salve erst nach dem Nachladen");
ok(bat.fire("STBD", {}), "Steuerbord ist unabhaengig davon klar");
ok(bat.rollKick > 0, "Rueckstoss erzeugt einen Krengungsstoss", bat.rollKick.toFixed(1) + " Grad");
let maxShots = 0;
for (let i = 0; i < 40; i++) { bat.update(0.05, { seaHeight: () => 0 }); maxShots = Math.max(maxShots, bat._shots.length); }
ok(bat.status().shots === 26, "26 Schuesse abgegeben", String(bat.status().shots));
ok(maxShots > 0, "Kugeln fliegen", String(maxShots));
const rl = bat.status().PORT.progress;
ok(rl > 0 && rl < 1, "Nachladebalken laeuft", (rl * 100).toFixed(0) + "%");
for (let i = 0; i < 400; i++) bat.update(0.05, { seaHeight: () => 0 });
ok(bat.ready("PORT") && bat.ready("STBD"), "nach " + frig.guns.reload + " s wieder klar");
ok(bat._shots.length === 0 && bat._smoke.length === 0, "Partikel werden aufgeraeumt");
// Die Yacht bekommt keine Batterie
bat.setShip(buildSailboat(), yacht);
ok(!bat.enabled && !bat.fire("PORT", {}), "die Yacht kann nicht feuern");

// ---------------------------------------------------------------- Trainer
console.log("\n== Trainer ==");
const tY = makeTrainer(yacht), tF = makeTrainer(frig);
ok(tY.list[0].ok({ twa: 45 }) && !tY.list[0].ok({ twa: 70 }), "Yacht-Uebung 1: 32-55 Grad");
ok(tF.list[0].ok({ twa: 75 }) && !tF.list[0].ok({ twa: 45 }), "Fregatten-Uebung 1: 65-88 Grad");
ok(makeTrainer().list[0].hint === tY.list[0].hint, "ohne Argument bleibt alles wie bisher");
ok(tF.list[3].ok({ twa: 100 }), "Rahsegler-Beam liegt bei 100 Grad");

console.log("\n=== Schiffe: " + pass + " bestanden, " + fail + " gescheitert ===");
if (fail > 0) process.exit(1);
