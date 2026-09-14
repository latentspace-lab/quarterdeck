// tests/visual.test.js - headless check of the 3D waves (Gerstner) and
// the wind-dependent sail/boom logic (boat.js). Runs without a browser.
import * as THREE from "three";
import { seaHeight, createOcean, ampForWind, lambdaForWind, waveHeightForWind, WAVES, SeaState } from "../../packages/client/src/ocean.js";
import { buildSailboat } from "../../packages/client/src/boat.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Geometry and waves");
const ok = suite.ok;
const section = (t) => suite.section(t);


section("Waves (Gerstner)");

// 0) Sea state depends on the wind: height scales quadratically, wavelength
//    grows with it
{
   const h = (k) => waveHeightForWind(k);
   ok(h(24) > h(12) * 3.4 && h(24) < h(12) * 4.6,
      "double the wind -> roughly quadruple wave height (Hs ~ U^2)",
      h(12).toFixed(2) + " m -> " + h(24).toFixed(2) + " m");
   ok(h(30) > 4.5 && h(30) < 6,
      "30 kn produces a rough sea around 5 m", h(30).toFixed(1) + " m");
   ok(h(5) < 0.25, "at 5 kn the sea is nearly flat", h(5).toFixed(2) + " m");
   ok(h(80) <= 11.6, "the height is capped at the top end", h(80).toFixed(1) + " m");
   ok(lambdaForWind(30) > lambdaForWind(12) * 1.4,
      "a storm sea has longer waves",
      lambdaForWind(12).toFixed(2) + " -> " + lambdaForWind(30).toFixed(2));
   ok(lambdaForWind(4) < 0.7, "light wind makes short chop",
      lambdaForWind(4).toFixed(2));
   // Steepness must increase WITH the wind, otherwise the sea looks flat
   const steep = (k) => ampForWind(k) / lambdaForWind(k);
   ok(steep(25) > steep(12) * 2.2, "the sea also gets steeper with the wind",
      steep(12).toFixed(2) + " -> " + steep(25).toFixed(2));
   // Steepness must not run away, or the Gerstner surface folds over
   let worst = 0;
   for (let k = 1; k <= 60; k++) {
      let sum = 0;
      for (const w of WAVES) sum += (2 * Math.PI / (w.L * lambdaForWind(k))) * w.q * w.a * ampForWind(k);
      worst = Math.max(worst, sum);
   }
   ok(worst < 0.95, "the waves stay below the breaking limit everywhere",
      "max steepness " + worst.toFixed(2));
   // At 12 kn everything stays tuned as it was before
   ok(Math.abs(ampForWind(12) - 0.176) < 0.01,
      "unchanged from the previous tuning at 12 kn", ampForWind(12).toFixed(3));
}

// 1) Height finite everywhere
let bad = false;
for (let i = 0; i < 500; i++) {
   const h = seaHeight((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800,
      Math.random() * 200, Math.random() * Math.PI * 2, 0.2);
   if (!Number.isFinite(h)) bad = true;
}
ok(!bad, "seaHeight is finite everywhere");

// 2) Amplitude scales the height
const h1 = Math.abs(seaHeight(37.3, -11.8, 4.5, 1.2, 0.16));
const h2 = Math.abs(seaHeight(37.3, -11.8, 4.5, 1.2, 0.32));
ok(h2 > h1 * 1.5, "double amplitude -> taller wave", h1.toFixed(3) + " / " + h2.toFixed(3));

// 3) Waves travel with time
ok(Math.abs(seaHeight(10, 20, 3.7, Math.PI, 0.2) - seaHeight(10, 20, 0, Math.PI, 0.2)) > 0.001,
   "the wave moves over time");

// 4) Inversion: seaHeight(X,Z) == height of the displaced surface point
//    (brute-force search for the parameter, then compare heights)
function surfaceAt(px, pz, t, wr, amp) {
   // A local copy of the ocean Gerstner sum via seaHeight's interior is not
   // exported -> recompute it here (same formulas as ocean.js)
   const G = 9.81;
   let h = 0, dx = 0, dz = 0;
   for (const w of WAVES) {
      const k = (2 * Math.PI) / w.L;
      const om = Math.sqrt(G * k);
      const ang = wr + w.off * (Math.PI / 180);
      const th = k * (Math.sin(ang) * px + Math.cos(ang) * pz) - om * t + w.ph;
      h += w.a * Math.sin(th);
      dx += w.q * w.a * Math.sin(ang) * Math.cos(th);
      dz += w.q * w.a * Math.cos(ang) * Math.cos(th);
   }
   return { wx: px + dx * amp, wz: pz + dz * amp, h: h * amp };
}
const X = 23.4, Z = -17.2, TT = 9.1, WR = 1.9, AMP = 0.25;
let best = null;
for (let a = -6; a <= 6; a += 0.06) {
   for (let b = -6; b <= 6; b += 0.06) {
      const s = surfaceAt(X + a, Z + b, TT, WR, AMP);
      const d = Math.hypot(s.wx - X, s.wz - Z);
      if (!best || d < best.d) best = { d, h: s.h };
   }
}
const invErr = Math.abs(seaHeight(X, Z, TT, WR, AMP) - best.h);
ok(invErr < 0.05, "the inversion hits the surface", "error " + invErr.toFixed(3) + " m");

// 5) createOcean: uniforms, grid snap, geometry in XZ
const oc = createOcean({});
// Since Phase 0B', createOcean no longer owns its own wave state: it reads a
// SeaState that is integrated with a fixed step.
const seaForOcean = new SeaState(14);
seaForOcean.snapTo(14);
for (let i = 0; i < 375; i++) seaForOcean.step(1 / 30, 14, 20); // 12.5 s of game time
seaForOcean.windRad = 2.2;
oc.sync(seaForOcean, new THREE.Vector3(0, 8, -18), 33.3, -47.9);
// uTime is now the accumulated phase time: long waves travel slower, so it
// falls behind the wall clock.
ok(oc.uniforms.uTime.value > 0 && oc.uniforms.uTime.value < 12.5,
   "uTime is the phase time (runs slower than the clock)",
   oc.uniforms.uTime.value.toFixed(2) + " s at 12.5 s of game time");
ok(Math.abs(oc.uniforms.uLambda.value - lambdaForWind(14)) < 1e-9, "uLambda = lambdaForWind");
ok(Math.abs(oc.uniforms.uAmp.value - ampForWind(14)) < 1e-9, "uAmp = ampForWind");
ok(oc.uniforms.uWindDir.value === 2.2, "uWindDir is set");
const seg = 3000 / 150;
ok(Math.abs(oc.mesh.position.x % seg) < 1e-6 && Math.abs(oc.mesh.position.z % seg) < 1e-6,
   "recentring snaps to the segment grid", oc.mesh.position.x.toFixed(1) + ", " + oc.mesh.position.z.toFixed(1));
const pa = oc.mesh.geometry.attributes.position;
ok(pa.count === 151 * 151, "151x151 grid");
let flatYZ = true;
for (let i = 0; i < pa.count; i++) if (Math.abs(pa.getY(i)) > 1e-9) flatYZ = false;
ok(flatYZ, "the ocean plane lies in XZ (position.xz is valid)");
const vsrc = oc.mesh.material.vertexShader;
ok((vsrc.match(/uWindDir \+/g) || []).length === WAVES.length * 2, "the GLSL contains every wave");
ok(vsrc.includes("gerstner") && vsrc.includes("cross(dPdz, dPdx)"), "GLSL: normal derived from tangents");

section("Sailboat (hull/sails)");

const yacht = buildSailboat();
const ud = yacht.userData;
ok(!!ud.heeler && !!ud.mainsail && !!ud.jib && !!ud.boomPivot && !!ud.rudderPivot, "userData is complete");
ok(ud.LOA === 11, "LOA = 11 m");

// Hull: pointed bow, wider hull, a stern edge exists
const hullMesh = yacht.children[0].children.find((c) => c.geometry && c.geometry.attributes.color);
ok(!!hullMesh, "hull has vertex colours (boot-topping/antifouling)");
if (hullMesh) {
   const hp = hullMesh.geometry.attributes.position;
   const hc = hullMesh.geometry.attributes.color;
   let bowX = 0, midX = 0, hasBottom = false, hasTop = false;
   for (let i = 0; i < hp.count; i++) {
      const y = hp.getY(i);
      if (hp.getZ(i) > 5.2) bowX = Math.max(bowX, Math.abs(hp.getX(i)));
      if (Math.abs(hp.getZ(i)) < 0.5) midX = Math.max(midX, Math.abs(hp.getX(i)));
      if (y < -0.5) hasBottom = true;
      if (y > 0.3) hasTop = true;
   }
   ok(bowX < 0.15, "the bow tapers to a point", bowX.toFixed(2) + " m half-beam");
   ok(midX > 1.4, "the hull reaches full beam", midX.toFixed(2) + " m half-beam");
   ok(hasBottom && hasTop, "the hull extends below the waterline and above the deck line");
   let stripeOk = false;
   for (let i = 0; i < hc.count; i++) {
      if (hc.getX(i) > 0.4 && hc.getX(i) < 0.6 && hc.getY(i) < 0.2) stripeOk = true; // antifouling red
   }
   ok(stripeOk, "antifouling colour below the waterline");
}

// Rudder follows
for (let i = 0; i < 200; i++) yacht.animate(0.05, { rudderAngle: 12, boomAngleDeg: 0, luffing: 0, windKts: 12, awaRel: 0, time: i * 0.05 });
ok(Math.abs(THREE.MathUtils.radToDeg(-ud.rudderPivot.rotation.y) - 12) < 1.5,
   "rudder follows (12°)", THREE.MathUtils.radToDeg(-ud.rudderPivot.rotation.y).toFixed(1));

// Boom to starboard (+X): clew follows exactly, the sail bellies to starboard
for (let i = 0; i < 300; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: 45, luffing: 0, windKts: 12, awaRel: -60, time: i * 0.05 });
const boomDegNow = THREE.MathUtils.radToDeg(-ud.boomPivot.rotation.y);
ok(Math.abs(boomDegNow - 45) < 2, "boom at 45° to starboard", boomDegNow.toFixed(1));

const mp = ud.mainsail.geometry.attributes.position;
const jp = ud.jib.geometry.attributes.position;
let nan = false, maxX = -1e9, minX = 1e9;
for (let i = 0; i < mp.count; i++) {
   if (!Number.isFinite(mp.getX(i) + mp.getY(i) + mp.getZ(i))) nan = true;
   maxX = Math.max(maxX, mp.getX(i));
   minX = Math.min(minX, mp.getX(i));
}
for (let i = 0; i < jp.count; i++) {
   if (!Number.isFinite(jp.getX(i) + jp.getY(i) + jp.getZ(i))) nan = true;
}
ok(!nan, "sail vertices are finite");
ok(Math.abs(maxX - Math.sin(Math.PI / 4) * 4.6) < 0.9, "clew at the end of the boom (starboard)",
   maxX.toFixed(2) + " ~ " + (Math.sin(Math.PI / 4) * 4.6).toFixed(2));
ok(minX > -0.2, "no canvas on the wrong (windward) side", minX.toFixed(2));

// Flat reference: the sail's middle must belly to leeward (here +X)
const tackMain = new THREE.Vector3(0, 1.35, 0.9);
const headMain = new THREE.Vector3(0, 13.9, 0.9);
const thetaNow = ud.boomPivot.rotation.y; // = -boomCur
const clewMain = new THREE.Vector3(
   -4.6 * Math.sin(thetaNow) * -1 * -1, // see below: computed directly
   1.35, 0.9 - 4.6 * Math.cos(thetaNow));
// correct: clew.x = -BOOM_LEN*sin(theta), clew.z = MAST_Z - BOOM_LEN*cos(theta)
clewMain.x = -4.6 * Math.sin(thetaNow);
function flatPoint(tack, head, clew, u, v) {
   const vv = v * (1 - u);
   const ax = tack.x + (head.x - tack.x) * u;
   const ay = tack.y + (head.y - tack.y) * u;
   const az = tack.z + (head.z - tack.z) * u;
   const bx = clew.x + (head.x - clew.x) * u;
   const by = clew.y + (head.y - clew.y) * u;
   const bz = clew.z + (head.z - clew.z) * u;
   return new THREE.Vector3(ax + (bx - ax) * vv, ay + (by - ay) * vv, az + (bz - az) * vv);
}
const idxMid = 5 * 13 + 6; // u=0.5 (iu=5), v=0.5 (iv=6) at U=20,V=12
const flatMid = flatPoint(tackMain, headMain, clewMain, 0.5, 0.5);
ok(mp.getX(idxMid) > flatMid.x + 0.05, "belly points to leeward (starboard)",
   "actual " + mp.getX(idxMid).toFixed(3) + " vs flat " + flatMid.x.toFixed(3));

// Jib on the same side as the boom
let jMaxX = -1e9;
for (let i = 0; i < jp.count; i++) jMaxX = Math.max(jMaxX, jp.getX(i));
ok(jMaxX > 1.5 && jMaxX < 3.6, "jib eased out on the leeward side", jMaxX.toFixed(2));

// Tack: boom swings to port, the belly tips with it
for (let i = 0; i < 400; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -45, luffing: 0, windKts: 12, awaRel: 60, time: 10 + i * 0.05 });
const boomDeg2 = THREE.MathUtils.radToDeg(-ud.boomPivot.rotation.y);
ok(Math.abs(boomDeg2 + 45) < 2, "boom swings to port", boomDeg2.toFixed(1));
const theta2 = ud.boomPivot.rotation.y;
const clew2 = new THREE.Vector3(-4.6 * Math.sin(theta2), 1.35, 0.9 - 4.6 * Math.cos(theta2));
const flatMid2 = flatPoint(tackMain, headMain, clew2, 0.5, 0.5);
ok(mp.getX(idxMid) < flatMid2.x - 0.05, "belly points to leeward (port)",
   "actual " + mp.getX(idxMid).toFixed(3) + " vs flat " + flatMid2.x.toFixed(3));
let mnX2 = 1e9;
for (let i = 0; i < mp.count; i++) mnX2 = Math.min(mnX2, mp.getX(i));
ok(mnX2 < -2.4, "clew now to port", mnX2.toFixed(2));

// Luffing (no-go zone): the sail visibly flogs
for (let i = 0; i < 100; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -10, luffing: 1, windKts: 12, awaRel: 5, time: 30 + i * 0.05 });
const xa = mp.getX(idxMid);
for (let i = 0; i < 10; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -10, luffing: 1, windKts: 12, awaRel: 5, time: 35 + i * 0.05 });
const xb = mp.getX(idxMid);
ok(Math.abs(xb - xa) > 0.02, "the sail luffs in the no-go zone",
   "delta " + Math.abs(xb - xa).toFixed(3) + " m");

// Pennant: points to leeward with the apparent wind
// awaRel=60 (wind from starboard) -> pennant to port: rotation.y = (60+180)° normalised = -120°
yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -20, luffing: 0, windKts: 12, awaRel: 60, time: 50 });
const flagDeg = THREE.MathUtils.radToDeg(ud.flagPivot.rotation.y);
ok(Math.abs(flagDeg + 120) < 1.0, "the pennant points to leeward", flagDeg.toFixed(1) + "°");


export default () => suite.done();

// When run directly (`node tests/<file>`), the suite prints its own summary;
// under the runner, the runner takes care of that.
if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
