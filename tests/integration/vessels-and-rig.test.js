// tests/vessels.test.js - vessel catalogue, square-rigger model, bracing, battery.
// Runs headless in plain Node:  node tests/vessels.test.js
import * as THREE from "three";
import { VESSELS, getVessel, vesselLabel, gunCount, broadsideWeight } from "../../packages/client/src/vessels.js";
import { buildWarship } from "../../packages/client/src/warship.js";
import { buildSailboat } from "../../packages/client/src/boat.js";
import { Battery } from "../../packages/client/src/guns.js";
import { BoatDynamics, polarSpeedAt, isLuffing, pointOfSail, profileFromVessel } from "../../packages/client/src/physics.js";
import { makeTrainer } from "../../packages/client/src/trainer.js";
import { clamp } from "../../packages/client/src/utils.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Vessels and rig");
const ok = suite.ok;
const section = (t) => suite.section(t);


// ---------------------------------------------------------------- Catalogue
section("Vessel catalogue");
ok(VESSELS.length === 5, "five vessels in the catalogue", String(VESSELS.length));
ok(VESSELS.filter((v) => v.rig === "square").length === 4, "four square-riggers");
ok(getVessel("lydia").name === "Lydia" && vesselLabel(getVessel("lydia")) === "HMS Lydia",
   "HMS Lydia found");
ok(getVessel("gibtsnicht").id === "yacht", "an unknown id falls back to the yacht");
// getVessel() silently falls back to the yacht. If an entry is missing its
// id, half the fleet sails unnoticed as a dinghy - hence checking every id.
ok(VESSELS.every((v) => v.id && getVessel(v.id).name === v.name),
   "every vessel in the catalogue has its own id",
   VESSELS.map((v) => v.id).join(", "));
const indy = polarSpeedAt(140, 15, 1, 1, getVessel("indefatigable").sail.polar);
const lyd = polarSpeedAt(140, 15, 1, 1, getVessel("lydia").sail.polar);
ok(getVessel("indefatigable").name === "Indefatigable" && indy > lyd,
   "the Indefatigable outruns the Lydia",
   indy.toFixed(2) + " kn vs " + lyd.toFixed(2) + " kn");
ok(gunCount(getVessel("yacht")) === 0 && getVessel("yacht").guns === null,
   "the yacht carries no guns");
ok(gunCount(getVessel("hotspur")) === 20, "Hotspur: 20 guns", String(gunCount(getVessel("hotspur"))));
ok(gunCount(getVessel("sutherland")) === 56 && broadsideWeight(getVessel("sutherland")) === 700,
   "Sutherland: 56 guns / 700 lb broadside");
// Size and inertia increase monotonically from sloop to ship of the line
const order = ["hotspur", "lydia", "sutherland"].map(getVessel);
ok(order[0].hull.loa < order[1].hull.loa && order[1].hull.loa < order[2].hull.loa,
   "length increases sloop < frigate < ship of the line");
ok(order[0].dyn.turnRate > order[1].dyn.turnRate && order[1].dyn.turnRate > order[2].dyn.turnRate,
   "turn rate falls with size");
ok(order[0].sail.noGo < order[2].sail.noGo, "the ship of the line points worst to windward");

// ---------------------------------------------------------------- Physics
section("Square-rigger physics");
const yacht = getVessel("yacht"), frig = getVessel("lydia");
ok(polarSpeedAt(45, 15, 1, 1, frig.sail.polar) === 0,
   "the frigate makes no way at 45 degrees TWA (no-go)");
ok(polarSpeedAt(45, 15, 1, 1, yacht.sail.polar) > 6,
   "the yacht points at 45 degrees at over 6 kn");
ok(polarSpeedAt(135, 15, 1, 1, frig.sail.polar) > 8,
   "the frigate runs at over 8 kn on a broad reach",
   polarSpeedAt(135, 15, 1, 1, frig.sail.polar).toFixed(1));
// Fastest course: the yacht abeam, the square-rigger further aft
function bestTwa(polar) {
   let best = 0, bt = 0;
   for (let t = 0; t <= 180; t += 1) {
      const v = polarSpeedAt(t, 15, 1, 1, polar);
      if (v > best) { best = v; bt = t; }
   }
   return bt;
}
ok(bestTwa(yacht.sail.polar) < 115, "the yacht is fastest up to ~110 degrees TWA", String(bestTwa(yacht.sail.polar)));
ok(bestTwa(frig.sail.polar) >= 125, "the frigate is fastest further aft than 125 degrees", String(bestTwa(frig.sail.polar)));
ok(isLuffing(60, 15, frig.sail.noGo) && !isLuffing(60, 15, yacht.sail.noGo),
   "60 degrees: the frigate is aback, the yacht sails");
ok(pointOfSail(120, false, "square") === "Broad Reach",
   "square-rigger point-of-sail labels", pointOfSail(120, false, "square"));
ok(pointOfSail(120, false) === "Broad Reach", "yacht point-of-sail labels unchanged");

// Gathering way: the ship of the line takes longer than the yacht
function runUp(vessel, twa, secs, windKts = 15) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   const wind = { dir: twa, speedKts: windKts };
   for (let i = 0; i < secs * 20; i++) b.step(0.05, wind);
   return b.speed;
}
const y30 = runUp(yacht, 100, 30), f30 = runUp(frig, 135, 30), s30 = runUp(getVessel("sutherland"), 135, 30);
const f300 = runUp(frig, 135, 300);
ok(y30 > 9, "the yacht is up to speed after 30 s", y30.toFixed(1) + " kn");
ok(f30 < f300 * 0.85, "the frigate has not finished accelerating after 30 s",
   f30.toFixed(1) + " -> " + f300.toFixed(1) + " kn (" + Math.round(100 * f30 / f300) + "%)");
ok(runUp(frig, 135, 150) > f300 * 0.95, "after 2.5 minutes she is at cruising speed",
   runUp(frig, 135, 150).toFixed(1) + " kn");
ok(s30 < f30, "the ship of the line accelerates slower than the frigate",
   s30.toFixed(1) + " < " + f30.toFixed(1));

// Reefing costs speed and heel
function reefed(vessel, set) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   b.sailSet = set;
   const wind = { dir: 135, speedKts: 24 };
   for (let i = 0; i < 6000; i++) b.step(0.05, wind);
   return { speed: b.speed, heel: b.heel };
}
const full = reefed(frig, 1), reef = reefed(frig, 0.3);
ok(reef.speed < full.speed * 0.85, "reefed is slower",
   full.speed.toFixed(1) + " -> " + reef.speed.toFixed(1) + " kn");
ok(reef.heel < full.heel, "reefed heels less",
   full.heel.toFixed(1) + " -> " + reef.heel.toFixed(1) + " degrees");
ok(reefed(yacht, 0.3).speed === reefed(yacht, 1).speed, "reefing has no effect on the yacht");

// Warships do not capsize in a storm
const storm = new BoatDynamics({ vessel: frig, heading: 0 });
for (let i = 0; i < 4000; i++) storm.step(0.05, { dir: 75, speedKts: 34 });
ok(!storm.isCapsized && storm.heel < frig.dyn.capsizeHeel,
   "the frigate survives 34 kn without capsizing", storm.heel.toFixed(1) + " degrees of heel");

// Tacking: a square-rigger must come through the wind
function tack(vessel) {
   const b = new BoatDynamics({ vessel, heading: 0 });
   const noGo = vessel.sail.noGo;
   const wind = { dir: noGo + 8, speedKts: 15 }; // TWA starts just above no-go
   for (let i = 0; i < 4000; i++) b.step(0.05, wind); // gather way
   const startTack = b.tack;
   b.snapRudder(-1);
   let t = 0;
   for (let i = 0; i < 4000; i++) { b.step(0.05, wind); t += 0.05; if (b.tack !== startTack) break; }
   return { switched: b.tack !== startTack, t, speed: b.speed };
}
const tf = tack(frig);
ok(tf.switched, "the frigate comes through the wind", tf.t.toFixed(0) + " s");
ok(tf.speed > 0.5, "and keeps way on while doing it", tf.speed.toFixed(1) + " kn");

// Profile from the catalogue
const P = profileFromVessel(frig);
ok(P.rig === "square" && P.noGo === 65 && P.turnRate === 9.5, "the profile comes from the catalogue");

// ---------------------------------------------------------------- 3D model
section("Square-rigger model");
for (const id of ["hotspur", "lydia", "sutherland"]) {
   const v = getVessel(id);
   const ship = buildWarship(v);
   const ud = ship.userData;
   const box = new THREE.Box3().setFromObject(ship);
   ok(Number.isFinite(box.min.x + box.max.y), id + ": geometry is finite");
   ok(box.max.y > v.hull.loa * 0.75, id + ": masthead above 3/4 of hull length",
      box.max.y.toFixed(1) + " m");
   ok(Math.abs(box.min.y + v.hull.draft) < v.hull.draft * 0.6, id + ": draft is plausible",
      box.min.y.toFixed(1) + " m");
   ok(Object.keys(ud.masts).length === 3, id + ": three masts");
   const perSide = v.guns.decks.reduce((n, d) => n + d.count, 0);
   ok(ud.muzzles.PORT.length === perSide && ud.muzzles.STBD.length === perSide,
      id + ": " + perSide + " muzzles per side");
   // Bow at +z, up at +y: starboard is the side a right-handed frame puts at
   // -x. Pinned here because the whole code base once had it mirrored.
   const fwd = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0);
   const right = new THREE.Vector3().crossVectors(fwd, up);
   ok(ud.muzzles.STBD.every((m) => m.x * right.x > 0) && ud.muzzles.PORT.every((m) => m.x * right.x < 0),
      id + ": starboard muzzles lie to the right of the bow, port ones to the left");
   ok(ud.sails.length >= 6, id + ": " + ud.sails.length + " sails");
}

// Bracing: yard angle = 90 - |AwA|/2, capped at 45 degrees, weather yardarm aft
section("Bracing");
const ship = buildWarship(frig);
function braceAt(awaRel) {
   // enough frames for the sluggish rig to reach the target angle
   for (let i = 0; i < 600; i++) ship.animate(0.05, { awaRel, windKts: 14, time: i * 0.05 });
   return (ship.userData.yards[0].yardGroup.rotation.y * 180) / Math.PI;
}
const b180 = braceAt(180), b140 = braceAt(140), b90 = braceAt(90), b70 = braceAt(70), bm90 = braceAt(-90);
ok(Math.abs(b180) < 1.5, "running before the wind the yards square away", b180.toFixed(1) + " degrees");
ok(Math.abs(b140 - 20) < 2, "140 degrees AwA -> braced 20 degrees", b140.toFixed(1));
ok(Math.abs(b90 - 45) < 2, "abeam the braces are hard over (45 degrees)", b90.toFixed(1));
ok(Math.abs(b70 - 45) < 2, "close-hauled: no sharper than 45 degrees", b70.toFixed(1));
ok(bm90 < -40, "wind from port swings the yards the other way", bm90.toFixed(1));
ok(ship.userData.yards.every((y) => Math.abs(y.yardGroup.rotation.y - ship.userData.yards[0].yardGroup.rotation.y) < 1e-6),
   "all yards are braced together");

// Sail: the belly lies to leeward
const sailPos = ship.userData.yards.find((y) => y.mesh).mesh.geometry.attributes.position;
let anyZ = 0;
for (let i = 0; i < sailPos.count; i++) anyZ += Math.abs(sailPos.getZ(i));
ok(anyZ > 0, "the canvas is curved (belly != 0)", anyZ.toFixed(1));

// ---------------------------------------------------------------- Battery
section("Battery");
const scene = new THREE.Scene();
scene.add(ship);
const bat = new Battery(scene, { sound: false });
bat.setShip(ship, frig);
ok(bat.enabled && bat.gunsPerSide() === 13, "battery registered: 13 guns per side");
ok(bat.fire("PORT", {}), "port fires");
ok(!bat.fire("PORT", {}), "a second broadside only after reloading");
ok(bat.fire("STBD", {}), "starboard is ready independently of it");
ok(bat.rollKick > 0, "recoil produces a heel kick", bat.rollKick.toFixed(1) + " degrees");
let maxShots = 0;
for (let i = 0; i < 40; i++) { bat.update(0.05, { seaHeight: () => 0 }); maxShots = Math.max(maxShots, bat._shots.length); }
ok(bat.status().shots === 26, "26 shots fired", String(bat.status().shots));
ok(maxShots > 0, "balls are in flight", String(maxShots));
const rl = bat.status().PORT.progress;
ok(rl > 0 && rl < 1, "the reload bar advances", (rl * 100).toFixed(0) + "%");
for (let i = 0; i < 1300; i++) bat.update(0.05, { seaHeight: () => 0 });
ok(bat.ready("PORT") && bat.ready("STBD"), "ready again after " + frig.guns.reload + " s");
ok(bat._shots.length === 0 && bat._smoke.length === 0, "particles are cleaned up");
// The yacht gets no battery
bat.setShip(buildSailboat(), yacht);
ok(!bat.enabled && !bat.fire("PORT", {}), "the yacht cannot fire");

// ---------------------------------------------------------------- Trainer
section("Trainer");
const tY = makeTrainer(yacht), tF = makeTrainer(frig);
ok(tY.list[0].ok({ twa: 45 }) && !tY.list[0].ok({ twa: 70 }), "yacht exercise 1: 32-55 degrees");
ok(tF.list[0].ok({ twa: 75 }) && !tF.list[0].ok({ twa: 45 }), "frigate exercise 1: 65-88 degrees");
ok(makeTrainer().list[0].hint === tY.list[0].hint, "without an argument everything stays as before");
ok(tF.list[3].ok({ twa: 100 }), "a square-rigger's beam reach lies at 100 degrees");


export default () => suite.done();

// When run directly (`node tests/<file>`), the suite prints its own summary;
// under the runner, the runner takes care of that.
if (!process.env.SEGEL_TEST_RUNNER) suite.done();
