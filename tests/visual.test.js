// tests/visual.test.js - Headless-Pruefung der 3D-Wellen (Gerstner) und
// der windabhaengigen Segel-/Baumlogik (boat.js). Laeuft ohne Browser.
import * as THREE from "three";
import { seaHeight, createOcean, ampForWind, WAVES } from "../src/ocean.js";
import { buildSailboat } from "../src/boat.js";

let pass = 0, fail = 0;
function ok(cond, name, extra = "") {
   if (cond) {
      pass++;
      console.log("  ok    " + name + (extra ? "   [" + extra + "]" : ""));
   } else {
      fail++;
      console.log("  FAIL  " + name + (extra ? "   [" + extra + "]" : ""));
   }
}

console.log("== Wellen (Gerstner) ==");

// 1) Hoehe ueberall endlich
let bad = false;
for (let i = 0; i < 500; i++) {
   const h = seaHeight((Math.random() - 0.5) * 800, (Math.random() - 0.5) * 800,
      Math.random() * 200, Math.random() * Math.PI * 2, 0.2);
   if (!Number.isFinite(h)) bad = true;
}
ok(!bad, "seaHeight ueberall endlich");

// 2) Amplitude skaliert die Hoehe
const h1 = Math.abs(seaHeight(37.3, -11.8, 4.5, 1.2, 0.16));
const h2 = Math.abs(seaHeight(37.3, -11.8, 4.5, 1.2, 0.32));
ok(h2 > h1 * 1.5, "doppelte Amplitude -> groessere Welle", h1.toFixed(3) + " / " + h2.toFixed(3));

// 3) Wellen wandern mit der Zeit
ok(Math.abs(seaHeight(10, 20, 3.7, Math.PI, 0.2) - seaHeight(10, 20, 0, Math.PI, 0.2)) > 0.001,
   "Welle bewegt sich zeitlich");

// 4) Invertierung: seaHeight(X,Z) == Hoehe des verschobenen Flaechenpunkts
//    (Brute-Force-Suche des Parameters, dann Hoehenvergleich)
function surfaceAt(px, pz, t, wr, amp) {
   // lokale Kopie der ocean-Gerstner-Summe via seaHeight-Interieur ist nicht
   // exportiert -> hier selbst nachrechnen (gleiche Formeln wie ocean.js)
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
ok(invErr < 0.05, "Invertierung trifft die Flaeche", "Fehler " + invErr.toFixed(3) + " m");

// 5) createOcean: Uniforms, Raster-Snap, Geometrie in XZ
const oc = createOcean({});
oc.update(12.5, new THREE.Vector3(0, 8, -18), 33.3, -47.9, 14, 2.2);
ok(oc.uniforms.uTime.value === 12.5, "uTime gesetzt");
ok(Math.abs(oc.uniforms.uAmp.value - ampForWind(14)) < 1e-9, "uAmp = ampForWind");
ok(oc.uniforms.uWindDir.value === 2.2, "uWindDir gesetzt");
const seg = 3000 / 150;
ok(Math.abs(oc.mesh.position.x % seg) < 1e-6 && Math.abs(oc.mesh.position.z % seg) < 1e-6,
   "Recenter auf Segmentraster", oc.mesh.position.x.toFixed(1) + ", " + oc.mesh.position.z.toFixed(1));
const pa = oc.mesh.geometry.attributes.position;
ok(pa.count === 151 * 151, "Grid 151x151");
let flatYZ = true;
for (let i = 0; i < pa.count; i++) if (Math.abs(pa.getY(i)) > 1e-9) flatYZ = false;
ok(flatYZ, "Ozean-Ebene liegt in XZ (position.xz gueltig)");
const vsrc = oc.mesh.material.vertexShader;
ok((vsrc.match(/uWindDir \+/g) || []).length === WAVES.length * 2, "GLSL enthaelt alle Wellen");
ok(vsrc.includes("gerstner") && vsrc.includes("cross(dPdz, dPdx)"), "GLSL: Normale aus Tangenten");

console.log("== Segelboot (Rumpf/Segel) ==");

const yacht = buildSailboat();
const ud = yacht.userData;
ok(!!ud.heeler && !!ud.mainsail && !!ud.jib && !!ud.boomPivot && !!ud.rudderPivot, "userData komplett");
ok(ud.LOA === 11, "LOA = 11 m");

// Rumpf: spitzer Bug, breiterer Rumpf, Heck-Rand existiert
const hullMesh = yacht.children[0].children.find((c) => c.geometry && c.geometry.attributes.color);
ok(!!hullMesh, "Rumpf mit Vertex-Farben (Wasserpass/Antifouling)");
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
   ok(bowX < 0.15, "Bug spitzt sich zu", bowX.toFixed(2) + " m halbbreit");
   ok(midX > 1.4, "Rumpf hat volle Breite", midX.toFixed(2) + " m halbbreit");
   ok(hasBottom && hasTop, "Rumpf ragt unter Wasser und ueber Decklinie");
   let stripeOk = false;
   for (let i = 0; i < hc.count; i++) {
      if (hc.getX(i) > 0.4 && hc.getX(i) < 0.6 && hc.getY(i) < 0.2) stripeOk = true; // Antifouling rot
   }
   ok(stripeOk, "Antifouling-Farbe unter Wasserlinie");
}

// Ruder folgt
for (let i = 0; i < 200; i++) yacht.animate(0.05, { rudderAngle: 12, boomAngleDeg: 0, luffing: 0, windKts: 12, awaRel: 0, time: i * 0.05 });
ok(Math.abs(THREE.MathUtils.radToDeg(-ud.rudderPivot.rotation.y) - 12) < 1.5,
   "Ruder folgt (12°)", THREE.MathUtils.radToDeg(-ud.rudderPivot.rotation.y).toFixed(1));

// Baum nach Steuerbord (+X): Clew folgt exakt, Segel baucht nach Stb
for (let i = 0; i < 300; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: 45, luffing: 0, windKts: 12, awaRel: -60, time: i * 0.05 });
const boomDegNow = THREE.MathUtils.radToDeg(-ud.boomPivot.rotation.y);
ok(Math.abs(boomDegNow - 45) < 2, "Baum auf 45° Steuerbord", boomDegNow.toFixed(1));

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
ok(!nan, "Segel-Vertices endlich");
ok(Math.abs(maxX - Math.sin(Math.PI / 4) * 4.6) < 0.9, "Clew am Baumende (Stb)",
   maxX.toFixed(2) + " ~ " + (Math.sin(Math.PI / 4) * 4.6).toFixed(2));
ok(minX > -0.2, "kein Tuch auf der falschen (Luv-)Seite", minX.toFixed(2));

// Flache Referenz: Segelmitte muss nach Lee (hier +X) gebaucht sein
const tackMain = new THREE.Vector3(0, 1.35, 0.9);
const headMain = new THREE.Vector3(0, 13.9, 0.9);
const thetaNow = ud.boomPivot.rotation.y; // = -boomCur
const clewMain = new THREE.Vector3(
   -4.6 * Math.sin(thetaNow) * -1 * -1, // siehe unten: direkt berechnet
   1.35, 0.9 - 4.6 * Math.cos(thetaNow));
// korrekt: clew.x = -BOOM_LEN*sin(theta), clew.z = MAST_Z - BOOM_LEN*cos(theta)
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
const idxMid = 5 * 13 + 6; // u=0.5 (iu=5), v=0.5 (iv=6) bei U=20,V=12
const flatMid = flatPoint(tackMain, headMain, clewMain, 0.5, 0.5);
ok(mp.getX(idxMid) > flatMid.x + 0.05, "Bauch zeigt nach Lee (Stb)",
   "Ist " + mp.getX(idxMid).toFixed(3) + " vs flach " + flatMid.x.toFixed(3));

// Fock auf gleicher Seite wie der Baum
let jMaxX = -1e9;
for (let i = 0; i < jp.count; i++) jMaxX = Math.max(jMaxX, jp.getX(i));
ok(jMaxX > 1.5 && jMaxX < 3.6, "Fock ausgeholt auf Lee-Seite", jMaxX.toFixed(2));

// Wende: Baum schwenkt nach Backbord, Bauch kippt mit
for (let i = 0; i < 400; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -45, luffing: 0, windKts: 12, awaRel: 60, time: 10 + i * 0.05 });
const boomDeg2 = THREE.MathUtils.radToDeg(-ud.boomPivot.rotation.y);
ok(Math.abs(boomDeg2 + 45) < 2, "Baum schwenkt nach Backbord", boomDeg2.toFixed(1));
const theta2 = ud.boomPivot.rotation.y;
const clew2 = new THREE.Vector3(-4.6 * Math.sin(theta2), 1.35, 0.9 - 4.6 * Math.cos(theta2));
const flatMid2 = flatPoint(tackMain, headMain, clew2, 0.5, 0.5);
ok(mp.getX(idxMid) < flatMid2.x - 0.05, "Bauch zeigt nach Lee (Bb)",
   "Ist " + mp.getX(idxMid).toFixed(3) + " vs flach " + flatMid2.x.toFixed(3));
let mnX2 = 1e9;
for (let i = 0; i < mp.count; i++) mnX2 = Math.min(mnX2, mp.getX(i));
ok(mnX2 < -2.4, "Clew jetzt backbord", mnX2.toFixed(2));

// Flattern (No-Go): Segel schlaegt sichtbar
for (let i = 0; i < 100; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -10, luffing: 1, windKts: 12, awaRel: 5, time: 30 + i * 0.05 });
const xa = mp.getX(idxMid);
for (let i = 0; i < 10; i++) yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -10, luffing: 1, windKts: 12, awaRel: 5, time: 35 + i * 0.05 });
const xb = mp.getX(idxMid);
ok(Math.abs(xb - xa) > 0.02, "Segel flattert in der No-Go-Zone",
   "Delta " + Math.abs(xb - xa).toFixed(3) + " m");

// Wimpel: zeigt mit dem scheinbaren Wind nach Lee
// awaRel=60 (Wind von Stb) -> Wimpel nach Backbord: rotation.y = (60+180)° normalisiert = -120°
yacht.animate(0.05, { rudderAngle: 0, boomAngleDeg: -20, luffing: 0, windKts: 12, awaRel: 60, time: 50 });
const flagDeg = THREE.MathUtils.radToDeg(ud.flagPivot.rotation.y);
ok(Math.abs(flagDeg + 120) < 1.0, "Wimpel zeigt nach Lee", flagDeg.toFixed(1) + "°");

console.log("\n=== Visual: " + pass + " bestanden, " + fail + " gescheitert ===");
process.exit(fail ? 1 : 0);