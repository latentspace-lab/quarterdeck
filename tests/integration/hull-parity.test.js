// tests/integration/hull-parity.test.js
//
// The server never sees a mesh. It places gun ports and hit boxes from
// @quarterdeck/shared/hull and builds the heeler matrix from shipPose(). This suite
// pins both to the real Three.js scene graph the client renders: same
// muzzles, same freeboard, same rig box, same world matrix. If these drift,
// the server hits what the player does not see.
import * as THREE from "three";
import { buildWarship } from "../../packages/client/src/warship.js";
import { Ship } from "../../packages/client/src/ship.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import {
   VESSELS, getVessel, muzzlePositions, gunLayout, freeboardOf, rigTopOf, rigHalfWidthOf,
   muzzleHeightOf, poseMatrix, shipPose, SeaState, SIM_DT,
} from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Hull parity");
const { ok, near, eq } = suite;

const squareRiggers = VESSELS.filter((v) => v.rig === "square" && v.guns);

suite.section("Muzzles: shared maths == client mesh");
for (const v of squareRiggers) {
   const model = buildWarship(v);
   const u = model.userData;
   const mine = muzzlePositions(v);
   let maxErr = 0;
   let n = 0;
   for (const side of ["PORT", "STBD"]) {
      eq(mine[side].length, u.muzzles[side].length, `${v.id}: ${side} has ${u.muzzles[side].length} muzzles`);
      for (let i = 0; i < Math.min(mine[side].length, u.muzzles[side].length); i++) {
         const a = mine[side][i];
         const b = u.muzzles[side][i];
         maxErr = Math.max(maxErr, Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z));
         n++;
      }
   }
   eq(maxErr, 0, `${v.id}: all ${n} muzzle positions are bit-identical`, maxErr.toExponential(1));
   near(freeboardOf(v.hull), u.FB, 0, `${v.id}: freeboard`);
   near(rigTopOf(v), u.rigTop, 0, `${v.id}: rig top`, u.rigTop.toFixed(2) + " m");
   near(rigHalfWidthOf(v), u.rigHalfWidth, 0, `${v.id}: rig half width`);
   const ports = gunLayout(v);
   ok(ports.every((p) => p.y > 0 && p.y < u.FB * 1.05), `${v.id}: ports sit between waterline and bulwark`);
   ok(ports.every((p) => p.hb > 0 && p.hb <= v.hull.beam / 2), `${v.id}: ports sit on the hull skin`);
   ok(muzzleHeightOf(v) > 1 && muzzleHeightOf(v) < u.FB, `${v.id}: mean muzzle height is plausible`, muzzleHeightOf(v).toFixed(2) + " m");
}

suite.section("Unarmed hulls");
{
   const yacht = getVessel("yacht");
   eq(gunLayout(yacht).length, 0, "the yacht has no ports");
   eq(muzzlePositions(yacht).PORT.length, 0, "and no muzzles");
   near(muzzleHeightOf(yacht), 2.5, 0, "muzzle height falls back to the ballistics default");
}

suite.section("poseMatrix() == the heeler's world matrix");
{
   // A client ship, stepped on a real sea, then the same pose fed to
   // poseMatrix(). The elements must agree to floating-point noise.
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 10 });
   const ship = new Ship({ vessel: getVessel("lydia"), scene, debris, targets: () => [], sound: false });
   ship.place(120, -40, 137, 6);
   const sea = new SeaState(18);
   for (let i = 0; i < 45; i++) {
      sea.step(SIM_DT, 18, 20);
      ship.update(SIM_DT, {
         wind: { dir: 20, speedKts: 18 }, t: sea.phaseT,
         waveT: sea.phaseT, waveRad: sea.windRad, amp: sea.amp, lambda: sea.lambda,
         gunCtx: { windDir: 20, windSpeed: 18, seaHeight: sea.sampler(0.9) },
      });
   }
   const pose = shipPose({
      pos: ship.pos, heading: ship.dyn.heading, heel: ship.dyn.heel,
      twaSigned: ship.dyn.twaSigned, flooding: ship.dmg.flooding,
      recoilRoll: ship.recoilRoll, hull: ship.vessel.hull,
   }, sea.sampler(1));
   ok(Math.abs(pose.rollZ) > 1e-3 && Math.abs(pose.pitchX) > 1e-4, "the ship is heeled and pitching (a real test)",
      (pose.rollZ * 180 / Math.PI).toFixed(2) + "° / " + (pose.pitchX * 180 / Math.PI).toFixed(2) + "°");

   const m = poseMatrix(ship.pos, pose);
   const ref = ship.model.userData.heeler.matrixWorld;
   let maxErr = 0;
   for (let i = 0; i < 16; i++) maxErr = Math.max(maxErr, Math.abs(m.elements[i] - ref.elements[i]));
   ok(maxErr < 1e-9, "all 16 elements agree with the Three.js hierarchy", maxErr.toExponential(2));

   // And a point on the hull lands in the same place either way.
   const local = new THREE.Vector3(3.5, 2.0, -10);
   const viaShared = local.clone().applyMatrix4(m);
   const viaThree = ship.model.userData.heeler.localToWorld(local.clone());
   near(viaShared.distanceTo(viaThree), 0, 1e-8, "a hull point maps to the same world position");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
