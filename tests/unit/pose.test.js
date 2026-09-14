// tests/unit/pose.test.js - how a hull sits on the wave.
//
// This math helps decide whether a shot goes below the waterline, into the
// hull, or into the rig. If the server computed a different pose than the
// client, the same shot would get two different results.
import { shipPose, railClearance, lerpPose, lerpVec, shortestAngle, getVessel, DEG, seaHeight } from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("pose");
const { ok, near, eq } = suite;

const HULL = getVessel("lydia").hull;
const flat = () => 0;
const base = (over = {}) => ({
   pos: { x: 0, z: 0 }, heading: 0, heel: 0, twaSigned: 1,
   flooding: 0, recoilRoll: 0, hull: HULL, ...over,
});

suite.section("Glassy calm sea");
{
   const p = shipPose(base(), flat);
   near(p.y, 0, 1e-12, "without waves she floats at zero");
   near(p.rollZ, 0, 1e-12, "no roll");
   near(p.pitchX, 0, 1e-12, "no pitch");
   near(p.seaY, 0, 1e-12, "water surface at zero");
   eq(p.sinkIn, 0, "no water ingress");
   near(shipPose(base({ heading: 137 }), flat).yawY, 137 * DEG, 1e-12, "yaw follows the heading");
}

suite.section("Heel");
{
   const stbd = shipPose(base({ heel: 10, twaSigned: 1 }), flat);
   const port = shipPose(base({ heel: 10, twaSigned: -1 }), flat);
   near(stbd.rollZ, 10 * DEG, 1e-12, "wind from starboard: heels to leeward");
   near(port.rollZ, -10 * DEG, 1e-12, "wind from port: the other side");
   ok(Math.sign(stbd.rollZ) !== Math.sign(port.rollZ), "the sides are mirrored");

   const kick = shipPose(base({ heel: 10, recoilRoll: 3 }), flat);
   near(kick.rollZ - stbd.rollZ, 3 * DEG, 1e-12, "recoil adds on top");
}

suite.section("Flooding");
{
   const dry = shipPose(base(), flat);
   const wet = shipPose(base({ flooding: 0.5 }), flat);
   ok(wet.y < dry.y, "water in the ship pushes her deeper",
      (dry.y - wet.y).toFixed(3) + " m");
   near(wet.sinkIn, 0.5 * HULL.draft * 0.55, 1e-12, "draft increase follows the flooding level");
   const full = shipPose(base({ flooding: 1 }), flat);
   ok(full.y < wet.y, "more water, deeper");
}

suite.section("Buoyancy averages over the hull");
{
   // A wave running exactly across the ship: a crest sits under the mainmast,
   // but averaged over the hull length it sits noticeably lower. Without this
   // averaging the sea would stand on the gun deck.
   const L = HULL.loa;
   const crest = (x, z) => Math.cos((z / L) * Math.PI * 2) * 2;
   const p = shipPose(base(), crest);
   ok(p.seaY < crest(0, 0), "the hull sits lower than the crest under the middle",
      p.seaY.toFixed(2) + " instead of " + crest(0, 0).toFixed(2));
   ok(Number.isFinite(p.pitchX), "pitch is finite");
}

suite.section("Pitch and roll follow the wave");
{
   const L = HULL.loa;
   // Longitudinal slope: bow up, stern down.
   const slopeZ = (x, z) => z * 0.05;
   const pitch = shipPose(base({ heading: 0 }), slopeZ);
   ok(Math.abs(pitch.pitchX) > 1e-6, "a longitudinal slope produces pitch",
      (pitch.pitchX / DEG).toFixed(2) + "°");
   ok(Math.abs(pitch.pitchX) <= 0.18 + 1e-12, "pitch is capped");

   // Transverse slope: one side up.
   const slopeX = (x, z) => x * 0.05;
   const roll = shipPose(base({ heading: 0 }), slopeX);
   ok(Math.abs(roll.rollZ) > 1e-6, "a transverse slope produces roll");

   // Mass damps. In absolute terms the wider frigate even rolls a bit more
   // on a constant slope - she samples a larger span. She is damped RELATIVE
   // TO HER BEAM, and that's exactly what massDamp = clamp(11/loa, 0.32, 1) does.
   const yachtHull = getVessel("yacht").hull;
   const small = shipPose(base({ hull: yachtHull }), slopeX);
   const big = shipPose(base({ hull: HULL }), slopeX);
   const perBeam = (p, h) => Math.abs(p.rollZ) / h.beam;
   ok(perBeam(small, yachtHull) > perBeam(big, HULL) * 2,
      "per metre of beam the yacht rolls noticeably more than the frigate",
      (perBeam(small, yachtHull) / perBeam(big, HULL)).toFixed(1) + "x");
   // And a very long ship hits the damping limit.
   const liner = shipPose(base({ hull: { ...HULL, loa: 200 } }), slopeX);
   const frig = shipPose(base({ hull: { ...HULL, loa: 40 } }), slopeX);
   ok(Math.abs(liner.rollZ) <= Math.abs(frig.rollZ) + 1e-12,
      "from loa 34 m the damping is already at its floor (0.32)");
}

suite.section("railClearance(): water over the rail");
{
   const FB = 5.16;
   const halfBeam = HULL.beam / 2;
   ok(railClearance(FB, 0, halfBeam, 0, 0, 0) > 0, "upright there is plenty of freeboard");
   near(railClearance(FB, 0, halfBeam, 0, 0, 0), FB, 1e-12, "upright it's exactly the freeboard");
   const heeled = railClearance(FB, 45 * DEG, halfBeam, 0, 0, 0);
   ok(heeled < FB, "heeling lowers the lee rail", heeled.toFixed(2) + " m");
   ok(railClearance(FB, 80 * DEG, halfBeam, 0, 0, 0) < 0,
      "at extreme heel the sea runs over the deck");
   ok(railClearance(FB, 0, halfBeam, 3, 0, 0) < FB, "flooding lowers it as well");
   ok(railClearance(FB, 0, halfBeam, 0, 0, 2) < FB, "a high lee-side wave as well");
   // The sign is mirrored: rolling to either side costs the same.
   near(railClearance(FB, 0.4, halfBeam, 0, 0, 0), railClearance(FB, -0.4, halfBeam, 0, 0, 0),
      1e-12, "the side does not matter");
}

suite.section("Interpolation for rendering");
{
   const a = shipPose(base({ heading: 10, heel: 4 }), flat);
   const b = shipPose(base({ heading: 20, heel: 8 }), flat);
   const m = lerpPose(a, b, 0.5);
   near(m.rollZ, (a.rollZ + b.rollZ) / 2, 1e-12, "roll averages");
   near(m.yawY, (a.yawY + b.yawY) / 2, 1e-12, "yaw averages");
   eq(lerpPose(a, b, 0).yawY, a.yawY, "alpha 0 is the previous step");
   eq(lerpPose(a, b, 1).yawY, b.yawY, "alpha 1 is the current one");

   // Wraparound: from 359 to 1 degree the short way is 2 degrees, not 358.
   const p359 = shipPose(base({ heading: 359 }), flat);
   const p1 = shipPose(base({ heading: 1 }), flat);
   const mid = lerpPose(p359, p1, 0.5);
   const midDeg = ((mid.yawY / DEG) % 360 + 360) % 360;
   ok(midDeg > 359.5 || midDeg < 0.5, "the heading swings across zero the short way",
      midDeg.toFixed(2) + "°");

   near(shortestAngle(0.1, 6.2), 6.2 - 0.1 - 2 * Math.PI, 1e-12, "shortestAngle takes the short way");
   const v = lerpVec({ x: 0, z: 10 }, { x: 10, z: 0 }, 0.25);
   near(v.x, 2.5, 1e-12, "lerpVec x");
   near(v.z, 7.5, 1e-12, "lerpVec z");
}

suite.section("Purity");
{
   // shipPose must read nothing but the water surface and write nothing.
   const input = base({ heading: 33, heel: 7, flooding: 0.2 });
   const before = JSON.stringify(input);
   const p1 = shipPose(input, flat);
   const p2 = shipPose(input, flat);
   eq(JSON.stringify(input), before, "the input stays unchanged");
   eq(JSON.stringify(p1), JSON.stringify(p2), "called twice, same result twice");

   // With a real sea: identical inputs, identical pose.
   const sea = (x, z) => seaHeight(x, z, 12.5, 1.7, 0.3, 1.1);
   eq(JSON.stringify(shipPose(input, sea)), JSON.stringify(shipPose(input, sea)),
      "reproducible on a moving sea too");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
