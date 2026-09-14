// tests/integration/render-interpolation.test.js
//
// The presentation side of Phase 0B': the simulation runs at 30 Hz, the
// picture at screen refresh rate. In between, it is interpolated.
//
// Two things must hold, or this rework is worse than what came before:
//   1. Interpolation must NOT touch the game state. It is a picture, not a
//      simulation.
//   2. After a simulation step, the model must stand at the EXACT pose - hit
//      testing works from this matrix.
import * as THREE from "three";
import { Ship } from "../../packages/client/src/ship.js";
import { getVessel } from "../../packages/client/src/vessels.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import { SIM_DT, SeaState, Accumulator, shipPose } from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Render interpolation");
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

suite.section("After a simulation step the model stands exactly right");
{
   const ship = makeShip();
   tick(ship, 30);
   const pose = shipPose({
      pos: ship.pos, heading: ship.dyn.heading, heel: ship.dyn.heel,
      twaSigned: ship.dyn.twaSigned, flooding: ship.dmg.flooding,
      recoilRoll: ship.recoilRoll, hull: ship.vessel.hull,
      // The hull pose is computed on the full water surface; the 0.9 factor
      // only applies to wreckage and projectiles.
   }, sea.sampler(1));
   near(ship.model.position.y, pose.y, 1e-9, "the draft matches shipPose");
   near(ship.model.position.x, ship.pos.x, 1e-12, "the position comes from the simulation");
   near(ship.model.userData.heeler.rotation.z, pose.rollZ, 1e-9, "so does the roll");
   near(ship.model.userData.heeler.rotation.x, pose.pitchX, 1e-9, "so does the pitch");

   // The world matrix must have been updated - hit testing relies on it and
   // must not wait for the renderer.
   const world = new THREE.Vector3().setFromMatrixPosition(ship.model.userData.heeler.matrixWorld);
   near(world.x, ship.pos.x, 1e-6, "the world matrix is current (hit testing)");
   near(world.z, ship.pos.z, 1e-6, "in Z as well");
}

suite.section("applyPose() moves the picture between two steps");
{
   const ship = makeShip();
   tick(ship, 40);
   const prevY = ship._posePrev.y;
   const currY = ship._poseCurr.y;
   const prevX = ship._posPrev.x;
   const currX = ship._posCurr.x;
   ok(prevY !== currY || prevX !== currX, "two consecutive poses differ");

   ship.applyPose(0);
   near(ship.model.position.y, prevY, 1e-12, "alpha 0 shows the previous step");
   near(ship.model.position.x, prevX, 1e-12, "in position too");

   ship.applyPose(1);
   near(ship.model.position.y, currY, 1e-12, "alpha 1 shows the current step");
   near(ship.model.position.x, currX, 1e-12, "in position too");

   ship.applyPose(0.5);
   near(ship.model.position.y, (prevY + currY) / 2, 1e-12, "alpha 0.5 lies exactly in the middle");
   near(ship.model.position.x, (prevX + currX) / 2, 1e-12, "in position too");

   // Monotonic: more alpha, closer to the current step.
   const dists = [0, 0.25, 0.5, 0.75, 1].map((a) => {
      ship.applyPose(a);
      return Math.abs(ship.model.position.x - currX);
   });
   ok(dists.every((d, i) => i === 0 || d <= dists[i - 1] + 1e-12),
      "the approach to the current step is monotonic");
}

suite.section("Interpolation does not touch the game state");
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
   eq(after, snapshot, "six render passes change nothing about the simulation");
}

suite.section("Different frame rates, identical simulation");
{
   // The same state after 300 steps - regardless of how often it was
   // rendered in between. That is the promise: rendering has no consequences.
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
   suite.deepEq(run(0), run(1), "no rendering == rendering once per step");
   suite.deepEq(run(0), run(5), "== rendering five times per step (144 Hz screen)");
}

suite.section("The accumulator drives the loop correctly");
{
   // The loop from main.js, rebuilt: fixed simulation, free-running display.
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
   eq(renders, 200, "every frame renders");
   const expected = Math.floor(wall / 1000 / SIM_DT);
   ok(Math.abs(steps - expected) <= 1, "the step count matches the elapsed time",
      steps + " instead of " + expected);
   ok(Number.isFinite(ship.model.position.y) && Number.isFinite(ship.pos.x),
      "ship and model stay finite");
   ok(ship.dyn.speed >= 0, "and speed is plausible", ship.dyn.speed.toFixed(2) + " kn");
}

suite.section("A sinking ship is interpolated too");
{
   const ship = makeShip();
   ship.dmg.holes.push({ side: "STBD", sec: "MID", below: true, size: 1.2 });
   ship.dmg.holes.push({ side: "STBD", sec: "BOW", below: true, size: 1.2 });
   let guard = 0;
   while (!ship.dmg.sunk && guard++ < 30000) tick(ship, 1);
   ok(ship.dmg.sunk, "she sinks", guard + " ticks");
   tick(ship, 30);
   ok(ship._poseCurr && ship._posePrev, "two poses are available even while sinking");
   ship.applyPose(0.5);
   ok(Number.isFinite(ship.model.position.y), "and the interpolation stays finite",
      ship.model.position.y.toFixed(2) + " m");
   const deep = ship.model.position.y;
   tick(ship, 60);
   ship.applyPose(1);
   ok(ship.model.position.y < deep, "she keeps settling deeper",
      deep.toFixed(1) + " -> " + ship.model.position.y.toFixed(1) + " m");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
