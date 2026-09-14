// boat.js - realistic sailing yacht model (forward = +Z, +X = starboard)
// Yacht (yaw=heading) > Heeler (heel = roll around Z, pitch) > hull/rig/sails.
// Hull: lofted from station cross-sections (pointed bow, sheer line, transom).
// Sails: parametric cloth surfaces that follow the boom (main) or the sheet
// (jib) every frame; the belly always points to leeward, and they luff in the no-go zone.
import * as THREE from "three";
import { clamp, DEG } from "./utils.js";
import { palette } from "./style.js";

const UP = new THREE.Vector3(0, 1, 0);

// ---------------- Materials ----------------
const matHull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.05, side: THREE.DoubleSide });
const matDeck = new THREE.MeshStandardMaterial({ color: 0xcfc4a8, roughness: 0.85, metalness: 0.02, side: THREE.DoubleSide });
const matHouse = new THREE.MeshStandardMaterial({ color: 0xf1f0ea, roughness: 0.55 });
const matDark = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.35, metalness: 0.4 });
const matRig = new THREE.MeshStandardMaterial({ color: 0x3a3e44, roughness: 0.4, metalness: 0.7 });
const matStay = new THREE.MeshStandardMaterial({ color: 0x8d9196, roughness: 0.35, metalness: 0.8 });
const matKeel = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.5, metalness: 0.3 });
const matWinch = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.35, metalness: 0.85 });

// Hull colors (vertex colors, waterline at y=0)
const COL_TOP = [0.94, 0.955, 0.965]; // topsides
const COL_STRIPE = [0.08, 0.13, 0.23]; // boot-top stripe
const COL_BOTTOM = [0.50, 0.13, 0.11]; // antifouling

// ---------------- Hull shape (profiles) ----------------
// Half-beam over the length position s (0=bow, 1=transom)
function hbProfile(s) {
   if (s < 0.42) return Math.pow(THREE.MathUtils.smoothstep(s, 0.0, 0.42), 0.85);
   return 1 - 0.22 * Math.pow(THREE.MathUtils.smoothstep(s, 0.42, 1.0), 1.25);
}
// Keel line: bow 0.83 (nearly down to the waterline), midships 1.0, stern 0.62
function kdProfile(s) {
   return 0.83 + 0.17 * THREE.MathUtils.smoothstep(s, 0.0, 0.15)
                - 0.38 * THREE.MathUtils.smoothstep(s, 0.65, 1.0);
}
// Sheer line (deck height): classic rise toward bow and stern
function sheerProfile(s) {
   return 0.52 + 0.42 * Math.pow(THREE.MathUtils.smoothstep(1 - s, 0.0, 1.0), 2.2)
               + 0.16 * THREE.MathUtils.smoothstep(s, 0.55, 1.0);
}

// Section point: s along the length (0=bow..1=stern), t around the cross-section (0=keel..1=deck edge)
function hullPoint(s, t, side, LOA, BEAM, DRAFT) {
   const z = THREE.MathUtils.lerp(LOA / 2, -LOA / 2, s);
   const hb = hbProfile(s) * (BEAM / 2);
   const kd = kdProfile(s) * DRAFT;
   const sh = sheerProfile(s);
   const ang = t * Math.PI / 2;
   const x = side * hb * Math.pow(Math.sin(ang), 0.82);
   const y = sh - kd * Math.pow(Math.cos(ang), 1.45);
   return new THREE.Vector3(x, y, z);
}

function buildHull(LOA, BEAM, DRAFT) {
   const S = 28; // stations
   const M = 12; // points per cross-section (keel -> deck edge)
   const positions = [];
   const colors = [];
   const indices = [];

   function pushPoint(v) {
      positions.push(v.x, v.y, v.z);
      const c = v.y > 0.16 ? COL_TOP : v.y > 0.02 ? COL_STRIPE : COL_BOTTOM;
      colors.push(c[0], c[1], c[2]);
      return positions.length / 3 - 1;
   }

   const port = [], stbd = [];
   for (let i = 0; i < S; i++) {
      const s = i / (S - 1);
      port.push([]);
      stbd.push([]);
      for (let j = 0; j <= M; j++) {
         const t = j / M;
         port[i].push(pushPoint(hullPoint(s, t, 1, LOA, BEAM, DRAFT)));
         stbd[i].push(pushPoint(hullPoint(s, t, -1, LOA, BEAM, DRAFT)));
      }
   }
   // Hull skin
   for (let i = 0; i < S - 1; i++) {
      for (let j = 0; j < M; j++) {
         for (const side of [port, stbd]) {
            const a = side[i][j], b = side[i][j + 1];
            const c = side[i + 1][j], d = side[i + 1][j + 1];
            indices.push(a, b, d, a, d, c);
         }
      }
   }
   // Transom (stern face) as a fan over the rim of the last station
   const rim = [];
   for (let j = 0; j <= M; j++) rim.push(port[S - 1][j]);
   for (let j = M; j >= 0; j--) rim.push(stbd[S - 1][j]);
   let cx = 0, cy = 0, cz = 0;
   for (const vi of rim) {
      cx += positions[vi * 3];
      cy += positions[vi * 3 + 1];
      cz += positions[vi * 3 + 2];
   }
   const rn = rim.length;
   positions.push(cx / rn, cy / rn, cz / rn);
   const cc = cy / rn > 0.16 ? COL_TOP : cy / rn > 0.02 ? COL_STRIPE : COL_BOTTOM;
   colors.push(cc[0], cc[1], cc[2]);
   const centroid = positions.length / 3 - 1;
   for (let k = 0; k < rim.length; k++) {
      indices.push(centroid, rim[k], rim[(k + 1) % rim.length]);
   }

   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
   geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
   geo.setIndex(indices);
   geo.computeVertexNormals();
   const hull = new THREE.Mesh(geo, matHull);
   hull.castShadow = true;
   return hull;
}

function buildDeck(LOA, BEAM) {
   const S = 28;
   const positions = [];
   const indices = [];
   for (let i = 0; i < S; i++) {
      const s = i / (S - 1);
      const z = THREE.MathUtils.lerp(LOA / 2, -LOA / 2, s);
      const hb = Math.max(hbProfile(s) * (BEAM / 2) * 0.985, 0.001);
      const sh = sheerProfile(s);
      positions.push(hb, sh, z, 0, sh + 0.055, z, -hb, sh, z); // edge, centre (crowned), edge
   }
   for (let i = 0; i < S - 1; i++) {
      const a = i * 3, b = (i + 1) * 3;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
      indices.push(a + 1, a + 2, b + 2, a + 1, b + 2, b + 1);
   }
   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
   geo.setIndex(indices);
   geo.computeVertexNormals();
   const deck = new THREE.Mesh(geo, matDeck);
   deck.castShadow = true;
   return deck;
}

// ---------------- Wire/stay between two points ----------------
function stay(a, b, r, mat) {
   const dir = new THREE.Vector3().subVectors(b, a);
   const len = dir.length();
   const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
   m.position.copy(a).addScaledVector(dir, 0.5);
   m.quaternion.setFromUnitVectors(UP, dir.normalize());
   return m;
}

// ---------------- Sails (parametric cloth) ----------------
const SAIL_VERT = `
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
   vN = normalize(normalMatrix * normal);
   vec4 wp = modelMatrix * vec4(position, 1.0);
   vW = wp.xyz;
   vUv = uv;
   gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const SAIL_FRAG = `
precision highp float;
uniform vec3 uColor;
uniform vec3 uSunDir;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
   vec3 N = normalize(vN);
   vec3 L = normalize(uSunDir);
   float diff = clamp(dot(N, L), 0.0, 1.0);
   float back = clamp(dot(-N, L), 0.0, 1.0); // light that passes through the cloth
   float panel = 0.952 + 0.048 * smoothstep(0.46, 0.54, fract(vUv.y * 5.0));
   float seam = 0.965 + 0.035 * smoothstep(0.46, 0.54, fract(vUv.x * 7.0));
   float shade = 0.52 + 0.48 * diff + 0.16 * back;
   gl_FragColor = vec4(uColor * shade * panel * seam, 1.0);
}
`;

function makeSail({ gridU = 18, gridV = 10, color = 0xf7f4ec } = {}) {
   const U = gridU, V = gridV;
   const count = (U + 1) * (V + 1);
   const positions = new Float32Array(count * 3);
   const uvs = new Float32Array(count * 2);
   const idx = [];
   let vi = 0;
   for (let iu = 0; iu <= U; iu++) {
      for (let iv = 0; iv <= V; iv++) {
         uvs[vi * 2] = iu / U; // u: along the luff (tack -> head)
         uvs[vi * 2 + 1] = iv / V; // v: cross-section from luff to leech
         vi++;
      }
   }
   for (let iu = 0; iu < U; iu++) {
      for (let iv = 0; iv < V; iv++) {
         const a = iu * (V + 1) + iv;
         const b = a + 1;
         const c = (iu + 1) * (V + 1) + iv;
         const d = c + 1;
         idx.push(a, b, d, a, d, c);
      }
   }
   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
   geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
   geo.setIndex(idx);
   // Colour from the style palette when it prescribes one (aquatint), the
   // designed colour otherwise; the latter is kept for a later style switch.
   const tint = palette().world.sail;
   const mat = new THREE.ShaderMaterial({
      uniforms: {
         uColor: { value: new THREE.Color(tint ?? color) },
         uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
      },
      vertexShader: SAIL_VERT,
      fragmentShader: SAIL_FRAG,
      side: THREE.DoubleSide,
   });
   mat.userData.baseColor = color;
   const mesh = new THREE.Mesh(geo, mat);
   mesh.frustumCulled = false;
   mesh.userData.U = U;
   mesh.userData.V = V;
   return mesh;
}

// Working vectors (no garbage per frame)
const _foot = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _luff = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _p = new THREE.Vector3();

// Recompute sail geometry: tack/head fixed (mast or forestay), clew at the
// boom end. Belly perpendicular to the cloth, always to leeward (leeX: +1=stbd, -1=port).
function updateSail(mesh, { tack, head, clew, camber, flutter, time, leeX }) {
   const geo = mesh.geometry;
   const pos = geo.attributes.position;
   const U = mesh.userData.U;
   const V = mesh.userData.V;

   _foot.subVectors(clew, tack).normalize();
   _camDir.crossVectors(UP, _foot);
   if (_camDir.lengthSq() < 1e-8) _camDir.set(leeX, 0, 0);
   _camDir.normalize();
   if (_camDir.x * leeX < 0) _camDir.negate();

   _luff.subVectors(head, tack);
   let vi = 0;
   for (let iu = 0; iu <= U; iu++) {
      const u = iu / U; // height: 0=tack, 1=head
      _a.copy(tack).addScaledVector(_luff, u); // point on the luff
      _b.copy(clew).lerp(head, u); // point on the leech
      for (let iv = 0; iv <= V; iv++) {
         const v = iv / V;
         const vv = v * (1 - u); // fold the square parameter into the triangle
         _p.copy(_a).lerp(_b, vv);
         // Belly: maximum at mid cross-section, flatter near the top
         let bulge = camber * Math.sin(Math.PI * v) * (1 - 0.38 * u);
         if (flutter > 0.01) {
            // Luffing: cloth flutters, the belly collapses, waves ripple across the sail
            bulge *= 1 - 0.8 * flutter;
            bulge += flutter * (0.14 * Math.sin(v * 6.283 + time * 16.0 + u * 7.0)
                              + 0.06 * Math.sin(u * 9.4 - time * 22.0));
         }
         _p.addScaledVector(_camDir, bulge);
         pos.setXYZ(vi, _p.x, _p.y, _p.z);
         vi++;
      }
   }
   pos.needsUpdate = true;
   geo.computeVertexNormals();
   geo.attributes.normal.needsUpdate = true;
}

function normHalfDeg(d) {
   return ((d % 360) + 540) % 360 - 180;
}

// ---------------- Complete Yacht ----------------
export function buildSailboat(opts = {}) {
   const yacht = new THREE.Group();
   const heeler = new THREE.Group();
   yacht.add(heeler);

   const LOA = 11.0, BEAM = 3.3, DRAFT = 1.55;
   const MAST_Z = 0.9, MAST_BASE = 0.70, MAST_H = 13.5;
   const MAST_TOP = MAST_BASE + MAST_H;
   const BOOM_Y = 1.35, BOOM_LEN = 4.6;
   const JIB_FOOT = 3.3;

   // Hull + deck
   heeler.add(buildHull(LOA, BEAM, DRAFT), buildDeck(LOA, BEAM));

   // Keel (fin) + bulb
   const keel = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.55, 1.5), matKeel);
   keel.position.set(0, -1.35, 0.35);
   const bulb = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 1.05, 6, 12), matKeel);
   bulb.rotation.x = Math.PI / 2;
   bulb.position.set(0, -2.05, 0.30);
   heeler.add(keel, bulb);

   // Rudder (pivots around its axis)
   const rudderPivot = new THREE.Group();
   rudderPivot.position.set(0, -0.02, -LOA / 2 + 0.55);
   const rudderBlade = new THREE.Mesh(new THREE.BoxGeometry(0.055, 1.1, 0.42), matKeel);
   rudderBlade.position.set(0, -0.62, -0.06);
   rudderPivot.add(rudderBlade);
   heeler.add(rudderPivot);

   // Mast (tapered)
   const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.105, MAST_H, 10), matRig);
   mast.position.set(0, MAST_BASE + MAST_H / 2, MAST_Z);
   mast.castShadow = true;
   heeler.add(mast);

   // Boom at the mast (pivot at the gooseneck)
   const boomPivot = new THREE.Group();
   boomPivot.position.set(0, BOOM_Y, MAST_Z);
   const boomGeo = new THREE.CylinderGeometry(0.05, 0.065, BOOM_LEN, 8);
   boomGeo.rotateX(Math.PI / 2);
   boomGeo.translate(0, 0, -BOOM_LEN / 2);
   const boom = new THREE.Mesh(boomGeo, matRig);
   boom.castShadow = true;
   boomPivot.add(boom);
   heeler.add(boomPivot);

   // Stays and shrouds
   const masthead = new THREE.Vector3(0, MAST_TOP, MAST_Z);
   const bowDeck = new THREE.Vector3(0, 0.98, LOA / 2 - 0.10);
   const sternDeck = new THREE.Vector3(0, 0.74, -LOA / 2 + 0.15);
   const upper = new THREE.Vector3(0, MAST_TOP - 2.2, MAST_Z);
   const shroudP = new THREE.Vector3(1.55, 0.70, 0.6);
   const shroudS = new THREE.Vector3(-1.55, 0.70, 0.6);
   heeler.add(stay(masthead, bowDeck, 0.016, matStay)); // forestay
   heeler.add(stay(masthead, sternDeck, 0.013, matStay)); // backstay
   heeler.add(stay(upper, shroudP, 0.012, matStay));
   heeler.add(stay(upper, shroudS, 0.012, matStay));

   // Cabin house + cockpit
   const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.62, 2.3), matHouse);
   cabin.position.set(0, 0.64 + 0.31, -0.35);
   cabin.castShadow = true;
   heeler.add(cabin);
   for (const sx of [1, -1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.55), matDark);
      win.position.set(sx * 0.885, 0.98, -0.35);
      heeler.add(win);
      const winch = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.11, 10), matWinch);
      winch.position.set(sx * 0.72, 0.70, -1.55);
      heeler.add(winch);
      const coaming = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.30, 1.5), matHouse);
      coaming.position.set(sx * 0.72, 0.66 + 0.15, -2.55);
      heeler.add(coaming);
   }
   const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.38, 0.32), matHouse);
   pedestal.position.set(0, 0.64 + 0.19, -2.35);
   heeler.add(pedestal);
   const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 8, 20), matWinch);
   wheel.position.set(0, 0.64 + 0.44, -2.35);
   heeler.add(wheel);

   // Stanchions + lifelines
   const railZ = [3.3, 1.7, -0.5, -2.4, -4.1];
   const topsP = [], topsS = [];
   for (const z of railZ) {
      const s = (LOA / 2 - z) / LOA;
      const hb = Math.max(hbProfile(s) * (BEAM / 2) - 0.10, 0.03);
      const dy = sheerProfile(s) + 0.06;
      const stP = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.55, 6), matRig);
      stP.position.set(hb, dy + 0.275, z);
      const stS = stP.clone();
      stS.position.x = -hb;
      heeler.add(stP, stS);
      topsP.push(new THREE.Vector3(hb, dy + 0.55, z));
      topsS.push(new THREE.Vector3(-hb, dy + 0.55, z));
   }
   for (let i = 0; i < topsP.length - 1; i++) {
      heeler.add(stay(topsP[i], topsP[i + 1], 0.011, matStay));
      heeler.add(stay(topsS[i], topsS[i + 1], 0.011, matStay));
   }

   // Pennant at the masthead (points to leeward with the apparent wind)
   const flagPivot = new THREE.Group();
   flagPivot.position.set(0, MAST_TOP + 0.12, MAST_Z);
   const flagGeo = new THREE.PlaneGeometry(0.85, 0.28);
   flagGeo.rotateY(-Math.PI / 2);
   flagGeo.translate(0, 0, 0.425);
   const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({
      color: 0xff7b2d, side: THREE.DoubleSide, roughness: 0.9,
   }));
   flagPivot.add(flag);
   heeler.add(flagPivot);

   // Sails
   const mainsail = makeSail({ gridU: 20, gridV: 12, color: 0xf7f4ec });
   const jib = makeSail({ gridU: 16, gridV: 10, color: 0xfaf8f0 });
   mainsail.castShadow = true;
   heeler.add(mainsail, jib);

   const tackMain = new THREE.Vector3(0, BOOM_Y, MAST_Z);
   const headMain = new THREE.Vector3(0, MAST_TOP - 0.30, MAST_Z);
   const jibTack = new THREE.Vector3(0, 1.05, LOA / 2 - 0.40);
   const jibHead = bowDeck.clone().lerp(masthead, 0.86);

   // Starting geometry (close to the mast, before the game calls animate())
   updateSail(mainsail, {
      tack: tackMain, head: headMain,
      clew: new THREE.Vector3(0, BOOM_Y, MAST_Z - BOOM_LEN),
      camber: 0.35, flutter: 0, time: 0, leeX: 1,
   });
   updateSail(jib, {
      tack: jibTack, head: jibHead,
      clew: new THREE.Vector3(0, 1.4, jibTack.z - JIB_FOOT),
      camber: 0.30, flutter: 0, time: 0, leeX: 1,
   });

   yacht.userData = {
      heeler, mast, boom: boomPivot, boomPivot,
      mainsail, jib, rudder: rudderPivot, rudderPivot,
      flagPivot, LOA, BEAM,
      sails: [mainsail, jib],
      muzzles: null,
      kind: "yacht",
      vesselId: "yacht",
   };

   // Animation: rudder, boom, sails, pennant
   let boomCur = 0, jibCur = 0, flutterCur = 0, rudderCur = 0, leeX = 1;
   const clewMain = new THREE.Vector3();
   const clewJib = new THREE.Vector3();

   yacht.animate = function (dt, o = {}) {
      const time = o.time || 0;

      // Follow the rudder
      rudderCur += ((o.rudderAngle || 0) - rudderCur) * Math.min(1, dt * 8);
      rudderPivot.rotation.y = -THREE.MathUtils.degToRad(rudderCur);

      // Boom angle (degrees, + = to starboard, - = to port = leeward)
      const boomDeg = clamp(o.boomAngleDeg || 0, -95, 95);
      if (Math.abs(boomDeg) > 0.5) leeX = boomDeg > 0 ? 1 : -1;
      const boomTarget = THREE.MathUtils.degToRad(boomDeg);
      const jibTarget = THREE.MathUtils.degToRad(clamp(boomDeg * 1.12, -80, 80));
      boomCur += (boomTarget - boomCur) * Math.min(1, dt * 2.6);
      jibCur += (jibTarget - jibCur) * Math.min(1, dt * 3.0);
      boomPivot.rotation.y = -boomCur;

      // Fade in luffing (no-go zone) smoothly
      flutterCur += ((o.luffing ? 1 : 0) - flutterCur) * Math.min(1, dt * 2.5);

      // Sail belly: fuller on a reach, flatter up high; scaled by wind strength
      const windF = clamp(0.45 + (o.windKts || 10) * 0.055, 0.45, 1.25);
      const ease = Math.min(Math.abs(boomCur) / (Math.PI / 2), 1);
      const camberMain = (0.34 + 0.5 * ease) * windF;
      const camberJib = (0.27 + 0.38 * ease) * windF;

      // Mainsail: clew exactly at the transformed boom end
      const theta = -boomCur; // same rotation as the boom mesh
      clewMain.set(
         boomPivot.position.x - BOOM_LEN * Math.sin(theta),
         boomPivot.position.y,
         boomPivot.position.z - BOOM_LEN * Math.cos(theta)
      );
      updateSail(mainsail, {
         tack: tackMain, head: headMain, clew: clewMain,
         camber: camberMain, flutter: flutterCur, time, leeX,
      });

      // Jib: clew at its sheet (a little further outboard than the boom)
      const thetaJ = -jibCur;
      clewJib.set(
         jibTack.x - JIB_FOOT * Math.sin(thetaJ),
         jibTack.y + 0.35,
         jibTack.z - JIB_FOOT * Math.cos(thetaJ)
      );
      updateSail(jib, {
         tack: jibTack, head: jibHead, clew: clewJib,
         camber: camberJib, flutter: flutterCur * 0.9, time: time + 1.7, leeX,
      });

      // Pennant: points to leeward with the apparent wind
      let awaRel = o.awaRel;
      if (awaRel === undefined) awaRel = leeX > 0 ? -90 : 90;
      flagPivot.rotation.y = normHalfDeg(awaRel + 180) * DEG;
      flagPivot.rotation.x = Math.sin(time * 9.0) * 0.1;
   };

   return yacht;
}