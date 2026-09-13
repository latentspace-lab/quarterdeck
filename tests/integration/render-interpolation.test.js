// tests/integration/render-interpolation.test.js
//
// Die Darstellungsseite von Phase 0B': die Simulation laeuft mit 30 Hz, das
// Bild mit Bildschirmrate. Dazwischen wird interpoliert.
//
// Zwei Dinge muessen stimmen, sonst ist der Umbau schlimmer als vorher:
//   1. Die Interpolation darf den Spielzustand NICHT anfassen. Sie ist Bild,
//      nicht Simulation.
//   2. Nach dem Simulationsschritt muss das Modell auf der EXAKTEN Lage
//      stehen - die Trefferpruefung rechnet mit dieser Matrix.
import * as THREE from "three";
import { Ship } from "../../packages/client/src/ship.js";
import { getVessel } from "../../packages/client/src/vessels.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import { SIM_DT, SeaState, Accumulator, shipPose } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Render-Interpolation");
const { ok, near, eq } = suite;

function makeShip(id = "lydia") {
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 100 });
   const ship = new Ship({ vessel: getVessel(id), scene, debris, targets: () => [], sound: false });
   ship.place(0, 0, 110, 6);
   return ship;
}

const sea = new SeaState(16);
const ctxAt = () => ({
   wind: { dir: 20, speedKts: 16 },
   t: sea.phaseT,
   waveT: sea.phaseT, waveRad: sea.windRad, amp: sea.amp, lambda: sea.lambda,
   gunCtx: { windDir: 20, windSpeed: 16, seaHeight: sea.sampler(0.9) },
});
function tick(ship, n = 1) {
   for (let i = 0; i < n; i++) {
      sea.step(SIM_DT, 16, 20);
      ship.update(SIM_DT, ctxAt());
   }
}

suite.section("Nach dem Simulationsschritt steht das Modell exakt");
{
   const ship = makeShip();
   tick(ship, 30);
   const pose = shipPose({
      pos: ship.pos, heading: ship.dyn.heading, heel: ship.dyn.heel,
      twaSigned: ship.dyn.twaSigned, flooding: ship.dmg.flooding,
      recoilRoll: ship.recoilRoll, hull: ship.vessel.hull,
      // Die Rumpflage rechnet auf der vollen Wasserflaeche; die 0.9 gelten
      // nur fuer Wrack und Geschosse.
   }, sea.sampler(1));
   near(ship.model.position.y, pose.y, 1e-9, "die Tauchtiefe stimmt mit shipPose ueberein");
   near(ship.model.position.x, ship.pos.x, 1e-12, "die Position stammt aus der Simulation");
   near(ship.model.userData.heeler.rotation.z, pose.rollZ, 1e-9, "das Rollen ebenso");
   near(ship.model.userData.heeler.rotation.x, pose.pitchX, 1e-9, "das Stampfen ebenso");

   // Die Weltmatrix muss nachgezogen sein - die Trefferpruefung verlaesst sich
   // darauf und darf nicht auf den Renderer warten.
   const world = new THREE.Vector3().setFromMatrixPosition(ship.model.userData.heeler.matrixWorld);
   near(world.x, ship.pos.x, 1e-6, "die Weltmatrix ist aktuell (Trefferpruefung)");
   near(world.z, ship.pos.z, 1e-6, "auch in Z");
}

suite.section("applyPose() bewegt das Bild zwischen zwei Schritten");
{
   const ship = makeShip();
   tick(ship, 40);
   const prevY = ship._posePrev.y;
   const currY = ship._poseCurr.y;
   const prevX = ship._posPrev.x;
   const currX = ship._posCurr.x;
   ok(prevY !== currY || prevX !== currX, "zwei aufeinanderfolgende Lagen unterscheiden sich");

   ship.applyPose(0);
   near(ship.model.position.y, prevY, 1e-12, "alpha 0 zeigt den vorigen Schritt");
   near(ship.model.position.x, prevX, 1e-12, "auch in der Position");

   ship.applyPose(1);
   near(ship.model.position.y, currY, 1e-12, "alpha 1 zeigt den aktuellen Schritt");
   near(ship.model.position.x, currX, 1e-12, "auch in der Position");

   ship.applyPose(0.5);
   near(ship.model.position.y, (prevY + currY) / 2, 1e-12, "alpha 0.5 liegt in der Mitte");
   near(ship.model.position.x, (prevX + currX) / 2, 1e-12, "auch in der Position");

   // Monoton: mehr alpha, naeher am aktuellen Schritt.
   const dists = [0, 0.25, 0.5, 0.75, 1].map((a) => {
      ship.applyPose(a);
      return Math.abs(ship.model.position.x - currX);
   });
   ok(dists.every((d, i) => i === 0 || d <= dists[i - 1] + 1e-12),
      "die Naeherung an den aktuellen Schritt ist monoton");
}

suite.section("Die Interpolation fasst den Spielzustand nicht an");
{
   const ship = makeShip();
   tick(ship, 50);
   const snapshot = JSON.stringify({
      pos: ship.pos, heading: ship.dyn.heading, speed: ship.dyn.speed,
      heel: ship.dyn.heel, rudder: ship.dyn.rudder,
      hull: ship.dmg.integrity(), flooding: ship.dmg.flooding,
      fit: ship.crew.fit, poseCurr: ship._poseCurr, posCurr: ship._posCurr,
   });
   for (const a of [0, 0.1, 0.37, 0.5, 0.99, 1]) ship.applyPose(a);
   const after = JSON.stringify({
      pos: ship.pos, heading: ship.dyn.heading, speed: ship.dyn.speed,
      heel: ship.dyn.heel, rudder: ship.dyn.rudder,
      hull: ship.dmg.integrity(), flooding: ship.dmg.flooding,
      fit: ship.crew.fit, poseCurr: ship._poseCurr, posCurr: ship._posCurr,
   });
   eq(after, snapshot, "sechs Renderdurchlaeufe aendern nichts an der Simulation");
}

suite.section("Verschiedene Bildraten, identische Simulation");
{
   // Derselbe Zustand nach 300 Schritten - egal, wie oft dazwischen gerendert
   // wurde. Das ist die Zusage: Rendern ist folgenlos.
   const run = (rendersPerStep) => {
      const s = new SeaState(16);
      const ship = makeShip();
      for (let i = 0; i < 300; i++) {
         s.step(SIM_DT, 16, 20);
         ship.update(SIM_DT, {
            wind: { dir: 20, speedKts: 16 }, t: s.phaseT,
            waveT: s.phaseT, waveRad: s.windRad, amp: s.amp, lambda: s.lambda,
            gunCtx: { windDir: 20, windSpeed: 16, seaHeight: s.sampler(0.9) },
         });
         for (let r = 0; r < rendersPerStep; r++) ship.applyPose(r / Math.max(rendersPerStep, 1));
      }
      return {
         x: ship.pos.x, z: ship.pos.z, heading: ship.dyn.heading,
         speed: ship.dyn.speed, heel: ship.dyn.heel,
      };
   };
   suite.deepEq(run(0), run(1), "ohne Rendern == einmal rendern je Schritt");
   suite.deepEq(run(0), run(5), "== fuenfmal rendern je Schritt (144-Hz-Schirm)");
}

suite.section("Der Akkumulator treibt die Schleife richtig an");
{
   // Die Schleife aus main.js, nachgebaut: feste Simulation, freie Darstellung.
   const acc = new Accumulator(SIM_DT);
   const ship = makeShip();
   const s = new SeaState(16);
   let steps = 0;
   let renders = 0;
   let wall = 0;
   acc.reset(0);
   const frameTimes = [16.7, 16.7, 8.3, 33.4, 16.7, 4.1, 50.0, 16.7, 16.7, 16.7];
   for (let f = 0; f < 200; f++) {
      wall += frameTimes[f % frameTimes.length];
      const n = acc.advance(wall);
      for (let i = 0; i < n; i++) {
         s.step(SIM_DT, 16, 20);
         ship.update(SIM_DT, {
            wind: { dir: 20, speedKts: 16 }, t: s.phaseT,
            waveT: s.phaseT, waveRad: s.windRad, amp: s.amp, lambda: s.lambda,
            gunCtx: { windDir: 20, windSpeed: 16, seaHeight: s.sampler(0.9) },
         });
         steps++;
      }
      ship.applyPose(acc.alpha);
      renders++;
      if (!Number.isFinite(ship.model.position.y)) break;
   }
   eq(renders, 200, "jeder Frame rendert");
   const expected = Math.floor(wall / 1000 / SIM_DT);
   ok(Math.abs(steps - expected) <= 1, "die Schrittzahl entspricht der verstrichenen Zeit",
      steps + " statt " + expected);
   ok(Number.isFinite(ship.model.position.y) && Number.isFinite(ship.pos.x),
      "Schiff und Modell bleiben endlich");
   ok(ship.dyn.speed >= 0, "und die Fahrt plausibel", ship.dyn.speed.toFixed(2) + " kn");
}

suite.section("Ein sinkendes Schiff wird ebenfalls interpoliert");
{
   const ship = makeShip();
   ship.dmg.holes.push({ side: "STBD", sec: "MID", below: true, size: 1.2 });
   ship.dmg.holes.push({ side: "STBD", sec: "BOW", below: true, size: 1.2 });
   let guard = 0;
   while (!ship.dmg.sunk && guard++ < 30000) tick(ship, 1);
   ok(ship.dmg.sunk, "sie sinkt", guard + " Ticks");
   tick(ship, 30);
   ok(ship._poseCurr && ship._posePrev, "auch beim Untergang liegen zwei Lagen vor");
   ship.applyPose(0.5);
   ok(Number.isFinite(ship.model.position.y), "und die Interpolation bleibt endlich",
      ship.model.position.y.toFixed(2) + " m");
   const deep = ship.model.position.y;
   tick(ship, 60);
   ship.applyPose(1);
   ok(ship.model.position.y < deep, "sie sackt weiter weg",
      deep.toFixed(1) + " -> " + ship.model.position.y.toFixed(1) + " m");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
