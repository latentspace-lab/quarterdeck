// warship.js - Rahsegler der Royal Navy (Hornblower-Aera), prozedural gebaut.
//
// Aufbau wie bei der Yacht:  Schiff (yaw) > heeler (Krengung/Stampfen) > Teile.
// Bug = +Z, Steuerbord = +X.
//
// Rumpf:  aus Stationsquerschnitten geloift, mit Einziehung (Tumblehome) ueber
//         der Wasserlinie, Kupferbeschlag darunter und Nelson-Schachbrett
//         (ockerfarbene Baender auf Hoehe der Batteriedecks, schwarz dazwischen).
// Rigg:   Fock-, Gross- und Besanmast mit je drei Segmenten (Untermast, Mars-,
//         Bramstenge), Marsplattformen, Rahen.
// Segel:  Rahsegel als parametrische Tuchflaechen, die sich nach Lee woelben.
//         Die Rahen werden gebrasst: Rahwinkel = 90 - AwA/2, begrenzt auf 45
//         Grad - genau der Grund, warum ein Rahsegler nicht hoeher als etwa
//         sechs Strich an den Wind gehen kann.
// Dazu:   Klueverbaum mit Stagsegeln, Besan (Gaffelsegel), Heckgalerie,
//         Kanonenrohre mit Rueckstoss, White Ensign und Kommandowimpel.

import * as THREE from "three";
import { clamp, DEG } from "./utils.js";
import { VESSEL_COLORS } from "./vessels.js";
import { holeTexture, fireTexture } from "./fx.js";
import {
   freeboardOf as sharedFreeboardOf,
   smooth, hbStation, kdStation, sheerStation, beamFactor, makeHullGeom,
   gunLayout, barrelLengthOf, rigTopOf, rigHalfWidthOf,
} from "@segel/shared";

const UP = new THREE.Vector3(0, 1, 0);

// ---------------- Materialien ----------------
const matHull = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.04, side: THREE.DoubleSide });
const matDeck = new THREE.MeshStandardMaterial({ color: VESSEL_COLORS.deck, roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide });
const matSpar = new THREE.MeshStandardMaterial({ color: 0x6b4c28, roughness: 0.78, metalness: 0.02 });
const matSparDark = new THREE.MeshStandardMaterial({ color: 0x2c1f13, roughness: 0.8 });
const matRope = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.9 });
const matTrim = new THREE.MeshStandardMaterial({ color: VESSEL_COLORS.trim, roughness: 0.42, metalness: 0.55 });
const matIron = new THREE.MeshStandardMaterial({ color: 0x1a1a1d, roughness: 0.42, metalness: 0.75 });
const matPortLid = new THREE.MeshStandardMaterial({ color: 0x0b0b0d, roughness: 0.75, side: THREE.DoubleSide });
const matGlass = new THREE.MeshStandardMaterial({ color: 0x9fd8e8, roughness: 0.2, metalness: 0.3, emissive: 0x16323c });

const C = VESSEL_COLORS;

// =========================================================================
// Hull form
// =========================================================================
// The station profiles (hbStation, kdStation, sheerStation, beamFactor) and
// the hull point function (makeHullGeom) live in @segel/shared/hull: the
// server places gun ports and hit boxes on the same hull, so the maths has to
// be one source. They are imported above.

// Die Wasserlinie ist waagerecht, die Baender folgen dem Deckssprung: genau so
// laufen Barkholz und Stueckpfortenstrake an einem echten Rumpf.
// bands sind Bruchteile des mittschiffs gemessenen Freibords.
function hullColorAt(y, s, FB, bands, paint) {
   const P = paint || C;
   if (y < -0.015) return P.copper || C.copper;  // Kupferbeschlag
   if (y < FB * 0.12) return P.boot || C.boot;   // Barkholz an der Wasserlinie
   const u = y / (FB * sheerStation(s));         // Hoehe relativ zur eigenen Station
   for (let i = 0; i < bands.length; i++) {
      if (Math.abs(u - bands[i]) < 0.078) return P.band || C.band;
   }
   return P.dark || C.dark;
}

function buildHull(dim, bands, paint) {
   const { LOA, FB } = dim;
   const { point } = makeHullGeom(dim);
   const S = 34, M = 36;
   const positions = [], colors = [], indices = [];

   function push(p, s) {
      positions.push(p.x, p.y, p.z);
      const c = hullColorAt(p.y, s, FB, bands, paint);
      colors.push(c[0], c[1], c[2]);
      return positions.length / 3 - 1;
   }

   const port = [], stbd = [];
   for (let i = 0; i < S; i++) {
      const s = i / (S - 1);
      port.push([]); stbd.push([]);
      for (let j = 0; j <= M; j++) {
         const t = j / M;
         port[i].push(push(point(s, t, 1), s));
         stbd[i].push(push(point(s, t, -1), s));
      }
   }
   for (let i = 0; i < S - 1; i++) {
      for (let j = 0; j < M; j++) {
         for (const side of [port, stbd]) {
            const a = side[i][j], b = side[i][j + 1];
            const c2 = side[i + 1][j], d = side[i + 1][j + 1];
            indices.push(a, b, d, a, d, c2);
         }
      }
   }
   // Spiegel (Heckflaeche)
   const rim = [];
   for (let j = 0; j <= M; j++) rim.push(port[S - 1][j]);
   for (let j = M; j >= 0; j--) rim.push(stbd[S - 1][j]);
   let cx = 0, cy = 0, cz = 0;
   for (const vi of rim) { cx += positions[vi * 3]; cy += positions[vi * 3 + 1]; cz += positions[vi * 3 + 2]; }
   const rn = rim.length;
   positions.push(cx / rn, cy / rn, cz / rn);
   const cc = hullColorAt(cy / rn, 1, FB, bands, paint);
   colors.push(cc[0], cc[1], cc[2]);
   const centroid = positions.length / 3 - 1;
   for (let k = 0; k < rim.length; k++) indices.push(centroid, rim[k], rim[(k + 1) % rim.length]);

   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
   geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
   geo.setIndex(indices);
   geo.computeVertexNormals();
   const mesh = new THREE.Mesh(geo, matHull);
   mesh.castShadow = true;
   return mesh;
}

// Decksflaeche knapp unterhalb der Schanzkleid-Oberkante
function buildDeck(dim) {
   const { LOA, FB } = dim;
   const { point } = makeHullGeom(dim);
   const S = 34;
   const positions = [], indices = [];
   for (let i = 0; i < S; i++) {
      const s = i / (S - 1);
      const edge = point(s, 0.86, 1);
      const hb = Math.max(edge.hb * 0.99, 0.001);
      const y = edge.y;
      positions.push(hb, y, edge.z, 0, y + FB * 0.035, edge.z, -hb, y, edge.z);
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
   const d = new THREE.Mesh(geo, matDeck);
   d.receiveShadow = true;
   return d;
}

// =========================================================================
// Tauwerk
// =========================================================================
function rope(a, b, r, mat = matRope) {
   const dir = new THREE.Vector3().subVectors(b, a);
   const len = dir.length();
   if (len < 1e-4) return new THREE.Group();
   const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 5), mat);
   m.position.copy(a).addScaledVector(dir, 0.5);
   m.quaternion.setFromUnitVectors(UP, dir.normalize());
   return m;
}

// =========================================================================
// Segeltuch
// =========================================================================
const SAIL_VERT = `
varying vec3 vN; varying vec2 vUv;
void main() {
   vN = normalize(normalMatrix * normal);
   vUv = uv;
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SAIL_FRAG = `
precision highp float;
uniform vec3 uColor; uniform vec3 uSunDir; uniform float uWear;
varying vec3 vN; varying vec2 vUv;
void main() {
   vec3 N = normalize(vN);
   vec3 L = normalize(uSunDir);
   float diff = clamp(dot(N, L), 0.0, 1.0);
   float back = clamp(dot(-N, L), 0.0, 1.0);
   // Senkrecht genaehte Tuchbahnen: nur schmale Naehte, kein Karomuster
   float seamX = fract(vUv.x * 9.0);
   float cloth = 1.0 - 0.045 * (smoothstep(0.0, 0.045, seamX) * (1.0 - smoothstep(0.045, 0.09, seamX)));
   // Reihen von Reffbaendseln als feine Linie
   float seamY = fract(vUv.y * 3.0 + 0.5);
   float reef = 1.0 - 0.035 * (smoothstep(0.0, 0.03, seamY) * (1.0 - smoothstep(0.03, 0.06, seamY)));
   float shade = 0.58 + 0.42 * diff + 0.26 * back;
   vec3 col = uColor * (1.0 - uWear * 0.05);
   gl_FragColor = vec4(col * shade * cloth * reef, 1.0);
}
`;

function sailMaterial(color, wear = 0.35) {
   return new THREE.ShaderMaterial({
      uniforms: {
         uColor: { value: new THREE.Color(color) },
         uSunDir: { value: new THREE.Vector3(0.4, 0.6, 0.7) },
         uWear: { value: wear },
      },
      vertexShader: SAIL_VERT,
      fragmentShader: SAIL_FRAG,
      side: THREE.DoubleSide,
   });
}

// Rahsegel: haengt unter der Rah, Kopf = Rahbreite, Fuss etwas breiter.
// Lokal:  x = quer (Rahrichtung),  y = 0 an der Rah nach unten,  z = Bauch.
function makeSquareSail(U = 14, V = 9, color = 0xf2ecdb) {
   const count = (U + 1) * (V + 1);
   const pos = new Float32Array(count * 3);
   const uvs = new Float32Array(count * 2);
   const idx = [];
   let k = 0;
   for (let iu = 0; iu <= U; iu++) {
      for (let iv = 0; iv <= V; iv++) {
         uvs[k * 2] = iu / U; uvs[k * 2 + 1] = iv / V; k++;
      }
   }
   for (let iu = 0; iu < U; iu++) {
      for (let iv = 0; iv < V; iv++) {
         const a = iu * (V + 1) + iv, b = a + 1;
         const c2 = (iu + 1) * (V + 1) + iv, d = c2 + 1;
         idx.push(a, b, d, a, d, c2);
      }
   }
   const geo = new THREE.BufferGeometry();
   geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
   geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
   geo.setIndex(idx);
   const mesh = new THREE.Mesh(geo, sailMaterial(color));
   mesh.frustumCulled = false;
   mesh.userData = { U, V, kind: "square" };
   return mesh;
}

// Risse im Tuch.
//
// Ein Segeltuch reisst nicht als Ganzes, sondern bekommt Loecher, die sich
// laengs der genaehten Bahnen aufziehen - darum sind die Risse in v-Richtung
// (von oben nach unten) deutlich laenger als in der Breite. Rund um ein Loch
// haengt das Tuch aus und schlaegt; im Kern ist es ganz weg. Sind genug Bahnen
// ausgerissen, fliegt das ganze Segel aus den Lieken.
function tearAt(tears, u, v) {
   let worst = 0;
   for (let k = 0; k < tears.length; k++) {
      const t = tears[k];
      const du = (u - t.u) / t.r;             // quer: schmal
      const dv = (v - t.v) / (t.r * t.len);   // laengs: zieht sich auf
      const d = Math.sqrt(du * du + dv * dv);
      if (d < 1) { const f = 1 - d; if (f > worst) worst = f; }
   }
   return worst;
}

function updateSquareSail(mesh, o) {
   const { U, V } = mesh.userData;
   const pos = mesh.geometry.attributes.position;
   const headHalf = o.headHalf;
   const footHalf = o.headHalf * 1.06;
   const drop = o.drop;
   const belly = o.belly * o.sgn;
   const set = clamp(o.set, 0.06, 1); // 1 = voll gesetzt, klein = gegeit/gerefft
   const tears = o.tears || EMPTY_TEARS;
   let i = 0;
   for (let iu = 0; iu <= U; iu++) {
      const u = iu / U;
      const xs = (u - 0.5) * 2; // -1 .. 1
      for (let iv = 0; iv <= V; iv++) {
         const v = iv / V;
         const half = THREE.MathUtils.lerp(headHalf, footHalf, v);
         // Gillung: das Achterliek haengt in der Mitte etwas durch
         const sag = 0.06 * drop * Math.sin(Math.PI * Math.abs(xs)) * v;
         let bulge = belly * Math.sin(Math.PI * (u * 0.96 + 0.02)) * Math.sin(Math.PI * (0.18 + v * 0.72));
         let flut = o.flutter;

         // --- Risse ------------------------------------------------------
         const tear = tears.length ? tearAt(tears, u, v) : 0;
         if (tear > 0.55) {
            // Loch: die Dreiecke werden auf einen Punkt gezogen und
            // verschwinden damit aus dem Bild.
            const cu = (Math.round(u * U) / U - 0.5) * 2;
            pos.setXYZ(i, cu * half, -v * drop * set, 0);
            i++;
            continue;
         }
         if (tear > 0) {
            // Ausgefranster Rand: das Tuch traegt nicht mehr, sackt weg und
            // schlaegt in hoher Frequenz.
            bulge *= 1 - 0.85 * tear;
            flut = Math.min(1, flut + tear * 0.9);
         }

         if (flut > 0.01) {
            bulge *= 1 - 0.78 * flut;
            bulge += flut * headHalf * (0.10 * Math.sin(v * 7.0 + o.time * 15.0 + u * 8.5)
                                     + 0.05 * Math.sin(u * 11.0 - o.time * 21.0));
         }
         const hang = tear * drop * 0.16 * set;
         pos.setXYZ(i, xs * half, -v * drop * set - sag * set - hang, bulge * set);
         i++;
      }
   }
   pos.needsUpdate = true;
   mesh.geometry.computeVertexNormals();
   mesh.geometry.attributes.normal.needsUpdate = true;
}

const EMPTY_TEARS = [];

// Schratsegel (Stagsegel / Klueber / Besan) als Dreieck:
// lokal: Hals bei (0,0,0), Kopf oben am Stag, Schothorn nach achtern ausgestellt.
function makeTriSail(U = 10, V = 8, color = 0xf4eee0) {
   const m = makeSquareSail(U, V, color);
   m.userData.kind = "tri";
   return m;
}

const _tA = new THREE.Vector3(), _tB = new THREE.Vector3(), _tP = new THREE.Vector3();
const _camDir = new THREE.Vector3(), _luffV = new THREE.Vector3();

function updateTriSail(mesh, o) {
   const { U, V } = mesh.userData;
   const pos = mesh.geometry.attributes.position;
   const { tack, head, clew } = o;
   _luffV.subVectors(head, tack);
   _camDir.subVectors(clew, tack).normalize();
   _camDir.cross(UP).normalize();
   if (_camDir.lengthSq() < 1e-6) _camDir.set(o.leeX, 0, 0);
   if (_camDir.x * o.leeX < 0) _camDir.negate();
   let i = 0;
   for (let iu = 0; iu <= U; iu++) {
      const u = iu / U;
      _tA.copy(tack).addScaledVector(_luffV, u);
      _tB.copy(clew).lerp(head, u);
      for (let iv = 0; iv <= V; iv++) {
         const v = iv / V;
         const vv = v * (1 - u);
         _tP.copy(_tA).lerp(_tB, vv);
         let bulge = o.camber * Math.sin(Math.PI * v) * (1 - 0.35 * u);
         if (o.flutter > 0.01) {
            bulge *= 1 - 0.8 * o.flutter;
            bulge += o.flutter * (0.12 * Math.sin(v * 6.3 + o.time * 17.0 + u * 7.0));
         }
         _tP.addScaledVector(_camDir, bulge);
         pos.setXYZ(i, _tP.x, _tP.y, _tP.z);
         i++;
      }
   }
   pos.needsUpdate = true;
   mesh.geometry.computeVertexNormals();
   mesh.geometry.attributes.normal.needsUpdate = true;
}

// =========================================================================
// Flaggen (White Ensign + Kommandowimpel) als Canvas-Textur
// =========================================================================
// Spanische Marineflagge (ab 1785): rot-gelb-rot, der gelbe Streifen doppelt
// so hoch, mit vereinfachtem Wappen zur Stange hin.
function spainTexture() {
   if (typeof document === "undefined") return null;
   const c = document.createElement("canvas");
   c.width = 128; c.height = 64;
   const g = c.getContext("2d");
   g.fillStyle = "#c60b1e"; g.fillRect(0, 0, 128, 64);
   g.fillStyle = "#ffc400"; g.fillRect(0, 16, 128, 32);
   // Wappenschild
   g.fillStyle = "#c60b1e"; g.fillRect(26, 22, 9, 20);
   g.fillStyle = "#f4f4f2"; g.fillRect(35, 22, 9, 20);
   g.fillStyle = "#c60b1e"; g.fillRect(35, 22, 9, 7);
   g.fillStyle = "#ffc400"; g.fillRect(28, 18, 14, 4);   // Krone
   const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

// Totenkopfflagge. Schwarzes Tuch, weisser Schaedel ueber gekreuzten Knochen -
// das Zeichen, unter dem kein Pardon gegeben und keiner erwartet wurde.
function jollyTexture() {
   if (typeof document === "undefined") return null;
   const c = document.createElement("canvas");
   c.width = 128; c.height = 64;
   const g = c.getContext("2d");
   g.fillStyle = "#0d0d0e"; g.fillRect(0, 0, 128, 64);
   g.fillStyle = "#eeeeea";
   // gekreuzte Knochen
   g.save();
   g.translate(64, 36);
   for (const a of [0.72, -0.72]) {
      g.save(); g.rotate(a);
      g.fillRect(-26, -2.6, 52, 5.2);
      for (const x of [-26, 26]) {
         g.beginPath(); g.arc(x, -3.4, 3.6, 0, Math.PI * 2); g.fill();
         g.beginPath(); g.arc(x, 3.4, 3.6, 0, Math.PI * 2); g.fill();
      }
      g.restore();
   }
   g.restore();
   // Schaedel
   g.beginPath(); g.arc(64, 26, 13, 0, Math.PI * 2); g.fill();
   g.fillRect(57, 34, 14, 8);
   g.fillStyle = "#0d0d0e";
   g.beginPath(); g.ellipse(59, 25, 4, 4.6, 0, 0, Math.PI * 2); g.fill();
   g.beginPath(); g.ellipse(69, 25, 4, 4.6, 0, 0, Math.PI * 2); g.fill();
   g.beginPath(); g.moveTo(64, 30); g.lineTo(61.5, 34); g.lineTo(66.5, 34); g.closePath(); g.fill();
   g.fillRect(60, 37, 1.6, 5); g.fillRect(63.2, 37, 1.6, 5); g.fillRect(66.4, 37, 1.6, 5);
   const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
}

// Tricolore (franzoesische Marineflagge ab 1794)
function tricolorTexture() {
   if (typeof document === "undefined") return null;
   const c = document.createElement("canvas");
   c.width = 128; c.height = 64;
   const g = c.getContext("2d");
   g.fillStyle = "#00209f"; g.fillRect(0, 0, 43, 64);
   g.fillStyle = "#f1f2f1"; g.fillRect(43, 0, 42, 64);
   g.fillStyle = "#c8102e"; g.fillRect(85, 0, 43, 64);
   const t = new THREE.CanvasTexture(c);
   t.needsUpdate = true;
   return t;
}

function ensignTexture() {
   if (typeof document === "undefined") return null;
   const c = document.createElement("canvas");
   c.width = 128; c.height = 64;
   const g = c.getContext("2d");
   g.fillStyle = "#f4f4f2"; g.fillRect(0, 0, 128, 64);
   // St.-Georgs-Kreuz
   g.fillStyle = "#c8102e";
   g.fillRect(0, 26, 128, 12);
   g.fillRect(58, 0, 12, 64);
   // Union-Canton
   const cw = 56, ch = 28;
   g.fillStyle = "#012169"; g.fillRect(0, 0, cw, ch);
   g.strokeStyle = "#ffffff"; g.lineWidth = 6;
   g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, ch); g.moveTo(cw, 0); g.lineTo(0, ch); g.stroke();
   g.strokeStyle = "#c8102e"; g.lineWidth = 2.5;
   g.beginPath(); g.moveTo(0, 0); g.lineTo(cw, ch); g.moveTo(cw, 0); g.lineTo(0, ch); g.stroke();
   g.fillStyle = "#ffffff";
   g.fillRect(0, ch / 2 - 5, cw, 10); g.fillRect(cw / 2 - 5, 0, 10, ch);
   g.fillStyle = "#c8102e";
   g.fillRect(0, ch / 2 - 2.5, cw, 5); g.fillRect(cw / 2 - 2.5, 0, 5, ch);
   const tex = new THREE.CanvasTexture(c);
   tex.needsUpdate = true;
   return tex;
}

function makeFlag(w, h, tex, fallbackColor = 0xf2f2f0) {
   const geo = new THREE.PlaneGeometry(w, h, 8, 3);
   geo.rotateY(-Math.PI / 2);
   geo.translate(0, 0, -w / 2); // haengt nach achtern vom Pivot weg
   const mat = tex
      ? new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.92 })
      : new THREE.MeshStandardMaterial({ color: fallbackColor, side: THREE.DoubleSide, roughness: 0.92 });
   const m = new THREE.Mesh(geo, mat);
   m.userData.base = geo.attributes.position.array.slice();
   return m;
}

function waveFlag(mesh, time, strength) {
   const pos = mesh.geometry.attributes.position;
   const base = mesh.userData.base;
   for (let i = 0; i < pos.count; i++) {
      const z = base[i * 3 + 2];
      const y = base[i * 3 + 1];
      const f = Math.abs(z);
      pos.setX(i, base[i * 3] + Math.sin(time * 7 + f * 3.2) * f * 0.22 * strength);
      pos.setY(i, y + Math.sin(time * 5.5 + f * 2.4) * f * 0.08 * strength);
   }
   pos.needsUpdate = true;
}

// Freeboard to the top of the bulwark. The formula lives in @segel/shared
// (pose.ts) because the server's swamp check needs the same number; this
// wrapper keeps the vessel-taking signature the client code uses.
export function freeboardOf(vessel) {
   return sharedFreeboardOf(vessel.hull);
}

// =========================================================================
// Hauptbaukasten
// =========================================================================
export function buildWarship(vessel) {
   const ship = new THREE.Group();
   const heeler = new THREE.Group();
   ship.add(heeler);

   const LOA = vessel.hull.loa;
   const BEAM = vessel.hull.beam;
   const DRAFT = vessel.hull.draft;
   const FB = freeboardOf(vessel);
   const dim = { LOA, BEAM, DRAFT, FB };
   const { point } = makeHullGeom(dim);

   const gunDecks = (vessel.guns && vessel.guns.decks) || [];
   const bands = gunDecks.map((d) => d.y);

   const paint = vessel.paint || null;
   heeler.add(buildHull(dim, bands, paint), buildDeck(dim));

   // ---- Ruder ----
   const rudderPivot = new THREE.Group();
   rudderPivot.position.set(0, 0, -LOA / 2 + LOA * 0.035);
   const blade = new THREE.Mesh(
      new THREE.BoxGeometry(BEAM * 0.035, DRAFT * 0.95, LOA * 0.035), matSparDark);
   blade.position.set(0, -DRAFT * 0.48, -LOA * 0.012);
   rudderPivot.add(blade);
   heeler.add(rudderPivot);

   // ---- Galionsfigur / Beakhead ----
   const beak = new THREE.Mesh(new THREE.ConeGeometry(BEAM * 0.10, LOA * 0.09, 8), matTrim);
   beak.rotation.x = Math.PI / 2;
   beak.position.set(0, FB * 0.62, LOA / 2 + LOA * 0.015);
   heeler.add(beak);

   // ---- Heckgalerie ----
   const sternY = FB * sheerStation(1) * 0.66;
   // Der Spiegel faellt oben nach achtern aus - die Galerie muss mitwandern
   const sternZ = -LOA / 2 - LOA * 0.030;
   const sternW = hbStation(1) * BEAM * 0.92;
   const gallery = new THREE.Mesh(new THREE.BoxGeometry(sternW, FB * 0.30, LOA * 0.016), matTrim);
   gallery.position.set(0, sternY, sternZ);
   heeler.add(gallery);
   for (let i = -1; i <= 1; i++) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(sternW * 0.22, FB * 0.19, LOA * 0.008), matGlass);
      w.position.set(i * sternW * 0.28, sternY, sternZ - LOA * 0.009);
      heeler.add(w);
   }
   const taffrail = new THREE.Mesh(new THREE.BoxGeometry(sternW * 1.04, FB * 0.06, LOA * 0.022), matTrim);
   taffrail.position.set(0, FB * sheerStation(1) * 0.98, sternZ - LOA * 0.008);
   heeler.add(taffrail);

   // ---- Decksausstattung ----------------------------------------------
   // Ein leeres Deck sieht aus wie ein Floss; ein paar Baugruppen geben dem
   // Schiff Massstab: Gangspill, Steuerrad, Luken, Beiboot, Niedergang.
   const deckAt = (s0) => FB * sheerStation(s0) * 0.86;
   const zAt = (s0) => THREE.MathUtils.lerp(LOA / 2, -LOA / 2, s0);

   // Gangspill (Ankerwinde) zwischen Fock- und Grossmast
   const capstan = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM * 0.075, BEAM * 0.095, FB * 0.30, 10), matSpar);
   capstan.position.set(0, deckAt(0.42) + FB * 0.15, zAt(0.42));
   heeler.add(capstan);

   // Steuerrad + Kompasshaus auf dem Achterdeck
   const wheelZ = zAt(0.80);
   const binnacle = new THREE.Mesh(
      new THREE.BoxGeometry(BEAM * 0.16, FB * 0.20, LOA * 0.018), matSpar);
   binnacle.position.set(0, deckAt(0.80) + FB * 0.10, wheelZ - LOA * 0.020);
   heeler.add(binnacle);
   const wheel = new THREE.Mesh(
      new THREE.TorusGeometry(BEAM * 0.075, BEAM * 0.010, 6, 16), matSpar);
   wheel.position.set(0, deckAt(0.80) + FB * 0.16, wheelZ);
   heeler.add(wheel);

   // Luken mit Gratings
   for (const hs of [0.36, 0.52, 0.68]) {
      const hatch = new THREE.Mesh(
         new THREE.BoxGeometry(BEAM * 0.28, FB * 0.07, LOA * 0.045), matSparDark);
      hatch.position.set(0, deckAt(hs) + FB * 0.035, zAt(hs));
      heeler.add(hatch);
   }

   // Beiboot auf Schlittenbalken mittschiffs
   const boat = new THREE.Mesh(
      new THREE.CapsuleGeometry(BEAM * 0.075, LOA * 0.10, 4, 8), matDeck);
   boat.rotation.x = Math.PI / 2;
   boat.scale.set(1, 1, 0.55);
   boat.position.set(0, deckAt(0.47) + FB * 0.14, zAt(0.47));
   heeler.add(boat);

   // =====================================================================
   // Kanonen
   // =====================================================================
   const batteries = { PORT: new THREE.Group(), STBD: new THREE.Group() };
   const muzzles = { PORT: [], STBD: [] };
   heeler.add(batteries.PORT, batteries.STBD);

   // Port positions come from the shared hull maths (gunLayout): the server's
   // muzzles are this client's muzzles to the last digit.
   const barrelLen = barrelLengthOf(vessel);
   const barrelR = BEAM * 0.018;
   const geoBarrel = new THREE.CylinderGeometry(barrelR * 0.72, barrelR, barrelLen, 8);
   geoBarrel.rotateZ(Math.PI / 2); // barrel points to +X
   geoBarrel.translate(barrelLen / 2, 0, 0);
   for (const port of gunLayout(vessel)) {
      const sx = port.side === "STBD" ? 1 : -1;
      // port lid
      const lid = new THREE.Mesh(new THREE.PlaneGeometry(LOA * 0.022, FB * 0.15), matPortLid);
      lid.rotation.y = sx * Math.PI / 2;
      lid.position.set(sx * (port.hb + 0.02), port.y, port.z);
      heeler.add(lid);
      // barrel (in the recoil group)
      const barrel = new THREE.Mesh(geoBarrel, matIron);
      barrel.scale.x = sx;
      barrel.position.set(sx * (port.hb - barrelLen * 0.15), port.y, port.z);
      batteries[port.side].add(barrel);
      muzzles[port.side].push(new THREE.Vector3(sx * (port.hb + barrelLen * 0.85), port.y, port.z));
   }

   // =====================================================================
   // Rigg
   // =====================================================================
   // rake = Mastfall nach achtern in Grad; er nimmt von vorn nach achtern zu
   const mastDefs = [
      { key: "fore", z: LOA * 0.26, h: LOA * 0.86, yardBase: LOA * 0.56, course: true, rake: 1.8 },
      { key: "main", z: LOA * 0.01, h: LOA * 0.98, yardBase: LOA * 0.62, course: true, rake: 3.2 },
      { key: "mizzen", z: -LOA * 0.27, h: LOA * 0.74, yardBase: LOA * 0.40, course: false, rake: 4.6 },
   ];

   const masts = {};
   const squareSails = []; // { mesh, yardGroup, headHalf, drop, mastKey, level }

   for (const md of mastDefs) {
      const deckY = FB * sheerStation((LOA / 2 - md.z) / LOA) * 0.80;
      const H = md.h;
      const g = new THREE.Group();
      g.position.set(0, deckY, md.z);
      g.rotation.x = -md.rake * DEG; // Masttop wandert nach achtern
      heeler.add(g);

      const rLow = BEAM * 0.036, rMid = BEAM * 0.026, rTop = BEAM * 0.017;
      let sparVol = 0; // m3 Holz in diesem Mast - ergibt spaeter die Wrackmasse
      const seg = (r0, r1, y0, y1, mat) => {
         const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 9), mat);
         m.position.y = (y0 + y1) / 2;
         m.castShadow = true;
         g.add(m);
         sparVol += Math.PI * ((r0 + r1) / 2) ** 2 * (y1 - y0);
         return m;
      };
      seg(rLow, rMid, 0, H * 0.46, matSpar);            // Untermast
      seg(rMid * 0.95, rTop, H * 0.44, H * 0.76, matSpar); // Marsstenge
      seg(rTop * 0.95, rTop * 0.55, H * 0.74, H * 1.0, matSpar); // Bramstenge

      // Mars (Plattform)
      const topR = BEAM * 0.13;
      const marsTop = new THREE.Mesh(new THREE.CylinderGeometry(topR, topR * 0.9, H * 0.012, 12), matSparDark);
      marsTop.position.y = H * 0.455;
      g.add(marsTop);
      const cross = new THREE.Mesh(new THREE.BoxGeometry(topR * 1.3, H * 0.008, topR * 0.5), matSparDark);
      cross.position.y = H * 0.755;
      g.add(cross);

      // Wanten (Ruesteisen an der Bordwand -> Mars) mit Webleinen
      const sTA = (LOA / 2 - md.z) / LOA;
      const chain = point(sTA, 0.78, 1);
      const N = 4; // Wanten je Seite
      for (const sx of [1, -1]) {
         const feet = [], heads = [];
         for (let k = 0; k < N; k++) {
            const u = k / (N - 1) - 0.5;
            feet.push(new THREE.Vector3(
               sx * chain.hb * (0.90 + 0.10 * Math.abs(u)), chain.y - deckY, u * LOA * 0.055));
            heads.push(new THREE.Vector3(sx * topR * (0.55 + 0.5 * Math.abs(u)), H * 0.45, u * topR * 0.9));
            g.add(rope(feet[k], heads[k], BEAM * 0.0035));
         }
         // Webleinen: waagerechte Sprossen, auf denen die Leute entern
         const steps = 11;
         for (let r = 1; r <= steps; r++) {
            const t = r / (steps + 1.4);
            const a = feet[0].clone().lerp(heads[0], t);
            const b = feet[N - 1].clone().lerp(heads[N - 1], t);
            g.add(rope(a, b, BEAM * 0.0022));
         }
      }

      masts[md.key] = { group: g, H, deckY, z: md.z, rake: md.rake, def: md, sparVol: 0, levels: [] };

      // ---- Rahen ----
      const levels = [];
      if (md.course) levels.push({ name: "course", y: H * 0.235, len: md.yardBase, drop: H * 0.215 });
      else levels.push({ name: "crossjack", y: H * 0.30, len: md.yardBase, drop: 0 });
      levels.push({ name: "topsail", y: H * 0.545, len: md.yardBase * 0.78, drop: H * 0.225 });
      if (md.key !== "mizzen") {
         levels.push({ name: "topgallant", y: H * 0.80, len: md.yardBase * 0.55, drop: H * 0.155 });
      }

      for (const lv of levels) {
         const yardGroup = new THREE.Group();
         yardGroup.position.y = lv.y;
         g.add(yardGroup);
         sparVol += Math.PI * (BEAM * 0.010) ** 2 * lv.len * 1.25;
         const yardGeo = new THREE.CylinderGeometry(BEAM * 0.010, BEAM * 0.010, lv.len, 7);
         yardGeo.rotateZ(Math.PI / 2);
         const yard = new THREE.Mesh(yardGeo, matSpar);
         yard.castShadow = true;
         yardGroup.add(yard);
         // Nocken (verjuengt)
         for (const sx of [1, -1]) {
            const tipGeo = new THREE.CylinderGeometry(BEAM * 0.004, BEAM * 0.010, lv.len * 0.12, 6);
            tipGeo.rotateZ(-sx * Math.PI / 2);
            const tip = new THREE.Mesh(tipGeo, matSpar);
            tip.position.x = sx * (lv.len / 2 + lv.len * 0.055);
            yardGroup.add(tip);
         }
         if (lv.drop > 0) {
            const sail = makeSquareSail(14, 9, lv.name === "course" ? 0xeee7d3 : 0xf4eedd);
            sail.castShadow = true;
            yardGroup.add(sail);
            squareSails.push({
               mesh: sail, yardGroup, headHalf: lv.len * 0.46, drop: lv.drop,
               mastKey: md.key, level: lv.name,
               health: 1, tears: [], blown: false, rnd: Math.random(),
            });
         } else {
            squareSails.push({ mesh: null, yardGroup, headHalf: lv.len * 0.46, drop: 0, mastKey: md.key, level: lv.name });
         }
         masts[md.key].levels.push(lv);
      }
      masts[md.key].sparVol = sparVol;
   }

   // Stage von Mast zu Mast / zum Bug. Jedes Stag merkt sich, an welchen
   // Masten es haengt - faellt einer, verschwindet es mit ihm.
   const mastTop = (k, f) => {
      const m = masts[k];
      const r = m.rake * DEG;
      return new THREE.Vector3(
         0,
         m.deckY + Math.cos(r) * m.H * f,
         m.z - Math.sin(r) * m.H * f);
   };
   const stays = [];
   const addStay = (a, b, r, onMasts) => {
      const m = rope(a, b, r);
      heeler.add(m);
      stays.push({ mesh: m, masts: onMasts });
      return m;
   };
   const bowTip = new THREE.Vector3(0, FB * 0.86, LOA / 2 - LOA * 0.01);
   addStay(mastTop("fore", 0.46), bowTip, BEAM * 0.005, ["fore"]);
   addStay(mastTop("main", 0.46), mastTop("fore", 0.30), BEAM * 0.005, ["main", "fore"]);
   addStay(mastTop("mizzen", 0.46), mastTop("main", 0.30), BEAM * 0.005, ["mizzen", "main"]);
   // Achterstage
   const sternTop = new THREE.Vector3(0, FB * sheerStation(1) * 0.95, -LOA / 2 + LOA * 0.02);
   addStay(mastTop("mizzen", 0.98), sternTop, BEAM * 0.004, ["mizzen"]);

   // ---- Klueverbaum + Stagsegel ----
   const bsLen = LOA * 0.34;
   const bsGeo = new THREE.CylinderGeometry(BEAM * 0.013, BEAM * 0.026, bsLen, 8);
   bsGeo.rotateX(Math.PI / 2);
   bsGeo.translate(0, 0, bsLen / 2);
   const bowsprit = new THREE.Mesh(bsGeo, matSpar);
   bowsprit.position.set(0, FB * 0.80, LOA / 2 - LOA * 0.03);
   bowsprit.rotation.x = -22 * DEG;
   bowsprit.castShadow = true;
   heeler.add(bowsprit);
   const bsTip = new THREE.Vector3(
      0,
      bowsprit.position.y + Math.sin(22 * DEG) * bsLen,
      bowsprit.position.z + Math.cos(22 * DEG) * bsLen
   );
   addStay(mastTop("fore", 0.76), bsTip, BEAM * 0.004, ["fore"]);

   const jib = makeTriSail(10, 8, 0xf5efe1);
   const staysail = makeTriSail(9, 7, 0xf2ecde);
   heeler.add(jib, staysail);
   const jibTack = bsTip.clone().lerp(bowsprit.position, 0.18);
   const jibHead = mastTop("fore", 0.74);
   const stayTack = bowsprit.position.clone().lerp(bsTip, 0.10);
   const stayHead = mastTop("fore", 0.46);

   // ---- Besan (Gaffelsegel auf dem Kreuzmast) ----
   const mz = masts.mizzen;
   const spankerBoomLen = LOA * 0.30;
   const spankerPivot = new THREE.Group();
   spankerPivot.position.set(0, mz.deckY + mz.H * 0.10, mz.z);
   const sbGeo = new THREE.CylinderGeometry(BEAM * 0.010, BEAM * 0.013, spankerBoomLen, 7);
   sbGeo.rotateX(Math.PI / 2);
   sbGeo.translate(0, 0, -spankerBoomLen / 2);
   spankerPivot.add(new THREE.Mesh(sbGeo, matSpar));
   const gaffLen = spankerBoomLen * 0.72;
   const gaffGeo = new THREE.CylinderGeometry(BEAM * 0.008, BEAM * 0.010, gaffLen, 6);
   gaffGeo.rotateX(Math.PI / 2);
   gaffGeo.translate(0, 0, -gaffLen / 2);
   const gaff = new THREE.Mesh(gaffGeo, matSpar);
   gaff.position.y = mz.H * 0.38;
   gaff.rotation.x = -16 * DEG;
   spankerPivot.add(gaff);
   heeler.add(spankerPivot);
   const spanker = makeTriSail(10, 9, 0xefe8d8);
   heeler.add(spanker);

   // ---- Flaggen ----
   // Flagge nach Partei
   const flagKind = vessel.flag
      || (vessel.faction === "fr" ? "tricolor"
        : vessel.faction === "es" ? "spain"
        : vessel.faction === "pirate" ? "jolly" : "white");
   const ensTex = flagKind === "tricolor" ? tricolorTexture()
      : flagKind === "spain" ? spainTexture()
      : flagKind === "jolly" ? jollyTexture()
      : ensignTexture();
   const ensignPivot = new THREE.Group();
   ensignPivot.position.set(0, mz.deckY + mz.H * 0.40, mz.z - gaffLen * 0.9);
   const ensign = makeFlag(LOA * 0.09, LOA * 0.055, ensTex);
   ensignPivot.add(ensign);
   heeler.add(ensignPivot);

   const pennantPivot = new THREE.Group();
   pennantPivot.position.set(0, masts.main.deckY + masts.main.H * 1.01, masts.main.z);
   const pennant = makeFlag(LOA * 0.14, LOA * 0.014, null, 0xe8e8e6);
   pennantPivot.add(pennant);
   heeler.add(pennantPivot);

   // Die Flaggen gehoeren an ihre Masten: der Ensign an die Besangaffel, der
   // Kommandowimpel an den Grosstopp. Faellt der Mast, gehen sie mit ihm ueber
   // Bord - sie duerfen nicht in der Luft haengen bleiben.
   heeler.updateMatrixWorld(true);
   masts.mizzen.group.attach(ensignPivot);
   masts.main.group.attach(pennantPivot);

   // Notgaffel am Heck: geht der Kreuzmast verloren, wird die Flagge dort
   // wieder gesetzt - ein Schiff ohne Flagge gilt sonst als gestrichen.
   const sternEnsignPivot = new THREE.Group();
   sternEnsignPivot.position.set(0, FB * sheerStation(1) * 1.10, sternZ - LOA * 0.01);
   const sternEnsign = makeFlag(LOA * 0.075, LOA * 0.046, ensTex);
   sternEnsignPivot.add(sternEnsign);
   sternEnsignPivot.visible = false;
   heeler.add(sternEnsignPivot);
   const sternStaff = new THREE.Mesh(
      new THREE.CylinderGeometry(BEAM * 0.008, BEAM * 0.010, FB * 0.55, 6), matSpar);
   sternStaff.position.set(0, FB * sheerStation(1) * 0.95, sternZ - LOA * 0.01);
   sternStaff.visible = false;
   heeler.add(sternStaff);

   // =====================================================================
   // Zustand + Animation
   // =====================================================================
   let braceCur = 0;      // Rahwinkel (rad)
   let spankerCur = 0;
   let flutterCur = 0;
   let rudderCur = 0;
   let leeX = 1;
   let recoil = { PORT: 0, STBD: 0 };
   const _clew = new THREE.Vector3();
   const _clewS = new THREE.Vector3();
   const _clewSp = new THREE.Vector3();

   const lostMasts = new Set();
   const holeDecals = [];
   const fires = [];
   const MAX_HOLES = 46;

   ship.userData = {
      heeler, masts, batteries, muzzles, LOA, BEAM, FB, DRAFT,
      yards: squareSails,
      spankerPivot, bowsprit, stays,
      rudder: rudderPivot, rudderPivot,
      sails: squareSails.filter((s) => s.mesh).map((s) => s.mesh).concat([jib, staysail, spanker]),
      vesselId: vessel.id,
      faction: vessel.faction || "gb",
      kind: "warship",
      lostMasts,
      // Decksgeometrie - damit die Mannschaft auf dem Deck steht und nicht darin
      deckAt: (s0) => FB * sheerStation(clamp(s0, 0, 1)) * 0.86,
      halfBeamAt: (s0, y) => skinAt(s0, y, 1).hb,
      zAt: (s0) => THREE.MathUtils.lerp(LOA / 2, -LOA / 2, clamp(s0, 0, 1)),
      gunDecks: gunDecks.map((d) => ({ ...d })),
      // Hoechster Punkt des Riggs und groesste Rahbreite - fuer die Trefferpruefung
      rigTop: rigTopOf(vessel),
      rigHalfWidth: rigHalfWidthOf(vessel),
   };

   // Rueckstoss von aussen ausloesen
   ship.kickRecoil = function (side, amount) {
      recoil[side] = Math.max(recoil[side], amount);
   };

   // =====================================================================
   // Schadensbild
   // =====================================================================

   // Punkt auf der Bordwand fuer (Laengsposition s, Hoehe y, Seite)
   function skinAt(sIn, yIn, sx) {
      const s0 = clamp(sIn, 0.02, 0.98);
      let hb = BEAM * 0.4, z = THREE.MathUtils.lerp(LOA / 2, -LOA / 2, s0);
      for (let t = 0; t <= 1.0001; t += 0.02) {
         const q = point(s0, t, sx);
         if (q.y >= yIn) { hb = Math.abs(q.hb); z = q.z; break; }
         hb = Math.abs(q.hb); z = q.z;
      }
      return { hb, z };
   }
   ship.skinAt = skinAt;

   const texHole = holeTexture();
   const matHole = texHole
      ? new THREE.MeshBasicMaterial({ map: texHole, transparent: true, depthWrite: false, side: THREE.DoubleSide })
      : null;

   // Einschlagloch setzen. size 0..1 (Anteil des angerichteten Schadens)
   ship.addHole = function (side, sPos, y, size = 0.3) {
      if (!matHole) return null;
      const sx = side === "STBD" ? 1 : -1;
      const yy = clamp(y, -DRAFT * 0.5, FB * 1.15);
      const { hb, z } = skinAt(sPos, yy, sx);
      const d = clamp(0.55 + size * 5.5, 0.5, Math.min(LOA * 0.075, 3.2));
      const m = new THREE.Mesh(new THREE.PlaneGeometry(d, d), matHole);
      m.rotation.y = sx * Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI;
      m.position.set(sx * (hb + 0.05), yy, z);
      m.renderOrder = 2;
      heeler.add(m);
      holeDecals.push(m);
      if (holeDecals.length > MAX_HOLES) {
         const old = holeDecals.shift();
         heeler.remove(old);
         old.geometry.dispose();
      }
      return m;
   };

   // Mast geht ueber Bord: Baugruppe loesen und dem Aufrufer uebergeben.
   // Segel, Stage und Schratsegel dieses Masts fallen mit.
   ship.detachMast = function (key) {
      const m = masts[key];
      if (!m || lostMasts.has(key)) return null;
      lostMasts.add(key);

      // Schratsegel mitnehmen
      if (key === "mizzen") {
         m.group.attach(spankerPivot);
         m.group.attach(spanker);
      }
      if (key === "fore") {
         m.group.attach(jib);
         m.group.attach(staysail);
      }
      // Stage dieses Masts verschwinden
      for (const st of stays) {
         if (st.masts.includes(key) && st.mesh.parent) {
            st.mesh.parent.remove(st.mesh);
            st.mesh.geometry.dispose();
         }
      }

      // Ensign geht mit dem Kreuzmast ueber Bord -> am Heck neu setzen
      if (key === "mizzen" && !struck) {
         sternEnsignPivot.visible = true;
         sternStaff.visible = true;
      }

      // Masse: Rundholz + stehendes Gut + nasses Tuch, grob Faktor 1.6
      const volume = m.sparVol * 1.6;
      const mass = volume * 520;            // Kiefer
      const topWorld = new THREE.Vector3(0, m.H * 0.62, 0);
      m.group.localToWorld(topWorld);

      return {
         key, group: m.group, mass, volume,
         radius: m.H * 0.22,
         height: m.H,
         topWorld,
         // Ansatzpunkt am Schiff, an dem das Wrack im Tauwerk haengt
         anchorLocal: new THREE.Vector3(0, m.deckY + m.H * 0.08, m.z),
      };
   };

   ship.mastLost = (key) => lostMasts.has(key);

   // Flagge streichen
   let struck = false;
   ship.setStruck = function (v) {
      struck = !!v;
      ensign.visible = !struck;
      pennant.visible = !struck;
      sternEnsignPivot.visible = !struck && lostMasts.has("mizzen");
      sternStaff.visible = sternEnsignPivot.visible;
   };
   ship.isStruck = () => struck;

   // Ausgeschlagene Rohre verschwinden aus der Pforte
   ship.setGunFraction = function (side, f) {
      const arr = batteries[side] && batteries[side].children;
      if (!arr) return;
      const keep = Math.round(clamp(f, 0, 1) * arr.length);
      for (let i = 0; i < arr.length; i++) arr[i].visible = i < keep;
   };

   // Brandherde
   const texFire = fireTexture();
   ship.setFire = function (level) {
      const want = Math.min(6, Math.floor(clamp(level, 0, 1) * 7));
      while (fires.length > want) {
         const f = fires.pop();
         heeler.remove(f);
         f.material.dispose();
      }
      if (!texFire) return;
      while (fires.length < want) {
         const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: texFire, transparent: true, depthWrite: false,
            blending: THREE.AdditiveBlending, fog: true, opacity: 0.9,
         }));
         const fs = 0.25 + Math.random() * 0.55;
         sp.position.set(
            (Math.random() - 0.5) * BEAM * 0.7,
            FB * (0.9 + Math.random() * 0.3),
            (Math.random() - 0.5) * LOA * 0.7);
         sp.userData.base = fs;
         heeler.add(sp);
         fires.push(sp);
      }
   };

   // ---------------------------------------------------------------------
   // Zerschossenes Tuch
   //
   // Jedes Segel hat seinen eigenen Zustand. Der Schaden trifft zuerst die
   // oberen Segel - dort steht der meiste Wind und dorthin geht die
   // Kettenkugel. Mit sinkendem Zustand reissen einzelne Bahnen auf; ist
   // genug weg, fliegt das Segel aus den Lieken und treibt nach Lee davon.
   // ---------------------------------------------------------------------
   let sailHealth = 1;
   const blownQueue = [];
   // Wie stark ein Segel dem Schaden ausgesetzt ist
   const EXPOSURE = { topgallant: 1.55, topsail: 1.15, course: 0.75, crossjack: 1.0 };

   function wearSail(s, h) {
      h = clamp(h, 0, 1);
      if (h >= s.health) return;        // Tuch flickt sich nicht von selbst
      s.health = h;
      // Zahl der aufgerissenen Bahnen waechst mit dem Schaden
      const want = Math.min(9, Math.floor((1 - h) * 10));
      while (s.tears.length < want) {
         s.tears.push({
            u: 0.06 + Math.random() * 0.88,
            v: 0.10 + Math.random() * 0.85,
            r0: 0.07 + Math.random() * 0.09,
            len: 1.8 + Math.random() * 2.2,   // Risse laufen laengs
            r: 0,
         });
      }
      const grow = 1 + (1 - h) * 1.9;
      for (const t of s.tears) t.r = t.r0 * grow;
      if (h <= 0.08 && !s.blown) {
         s.blown = true;
         s.mesh.visible = false;
         blownQueue.push(s);
      }
   }

   ship.setSailDamage = function (health) {
      sailHealth = clamp(health, 0, 1);
      const loss = 1 - sailHealth;
      for (const s of squareSails) {
         if (!s.mesh || s.blown) continue;
         const e = (EXPOSURE[s.level] ?? 1) * (0.82 + s.rnd * 0.36);
         wearSail(s, clamp(1 - loss * e * 1.15, 0, 1));
      }
   };

   // Ein einzelnes Segel gezielt beschaedigen (Treffer in genau dieses Tuch)
   ship.damageSail = function (mastKey, level, amount) {
      const s = squareSails.find((x) => x.mesh && !x.blown
         && x.mastKey === mastKey && (!level || x.level === level));
      if (s) wearSail(s, s.health - amount);
      return !!s;
   };

   // Segel, die seit dem letzten Aufruf aus den Lieken geflogen sind.
   // Der Aufrufer macht daraus treibende Tuchfetzen.
   const _sailPos = new THREE.Vector3();
   ship.drainBlownSails = function () {
      if (!blownQueue.length) return [];
      const out = blownQueue.splice(0, blownQueue.length).map((s) => {
         // Mitte des Segels in Weltkoordinaten
         _sailPos.set(0, -s.drop * 0.5, 0);
         s.yardGroup.updateMatrixWorld();
         s.yardGroup.localToWorld(_sailPos);
         return {
            pos: _sailPos.clone(),
            w: s.headHalf * 2,
            h: s.drop,
            level: s.level,
            mastKey: s.mastKey,
         };
      });
      return out;
   };

   ship.sailStates = () => squareSails.filter((s) => s.mesh)
      .map((s) => ({ mast: s.mastKey, level: s.level, health: s.health,
                     tears: s.tears.length, blown: s.blown }));

   ship.animate = function (dt, o = {}) {
      const time = o.time || 0;

      // Ruder
      rudderCur += ((o.rudderAngle || 0) - rudderCur) * Math.min(1, dt * 5);
      rudderPivot.rotation.y = -rudderCur * DEG;

      // --- Brassen ---------------------------------------------------------
      // AwA relativ: + = Wind von Steuerbord.  Rahwinkel-Betrag = 90 - |AwA|/2,
      // begrenzt auf 45 Grad (maximale Brasse). Luvseitige Nock geht nach achtern.
      const A = o.awaRel === undefined ? 180 : normHalf(o.awaRel);
      const braceMag = clamp(90 - Math.abs(A) / 2, 0, 45);
      const braceTarget = (A >= 0 ? 1 : -1) * braceMag * DEG;
      braceCur += (braceTarget - braceCur) * Math.min(1, dt * 1.1); // schweres Rigg
      if (Math.abs(A) > 3) leeX = A > 0 ? -1 : 1; // Leeseite

      // Bauchrichtung: die Normale, die mit dem Wind zeigt
      const downwind = (A + 180) * DEG;
      const sgn = Math.cos(braceCur - downwind) >= 0 ? 1 : -1;

      // Flattern (No-Go / Backen)
      flutterCur += ((o.luffing ? 1 : 0) - flutterCur) * Math.min(1, dt * 2.2);

      const windF = clamp(0.40 + (o.windKts || 10) * 0.045, 0.40, 1.20);
      const setAll = clamp(o.sailSet === undefined ? 1 : o.sailSet, 0.05, 1);

      // Zerschossenes Tuch schlaegt und steht nicht mehr voll. Es wird aber
      // NICHT kleiner: ein durchloechertes Segel bleibt ein Segel, bis es aus
      // den Lieken fliegt. Und genau das passiert der Reihe nach - zuerst
      // oben, wo der Druck am groessten ist.
      for (const s of squareSails) {
         if (lostMasts.has(s.mastKey)) continue; // Mast ist ueber Bord
         s.yardGroup.rotation.y = braceCur;
         if (!s.mesh || s.blown) continue;
         // Zerschossenes Tuch steht nicht mehr voll und schlaegt staendig
         const bellyBase = s.headHalf * 0.33 * windF * lerpN(0.45, 1, s.health);
         updateSquareSail(s.mesh, {
            headHalf: s.headHalf,
            drop: s.drop,
            belly: bellyBase,
            sgn,
            set: setAll,
            flutter: clamp(flutterCur + (1 - s.health) * 0.34, 0, 1),
            tears: s.tears,
            time: time + (s.level === "topsail" ? 1.3 : s.level === "topgallant" ? 2.6 : 0),
         });
      }
      const tornFlutter = clamp(flutterCur + (1 - sailHealth) * 0.30, 0, 1);

      // --- Schratsegel ------------------------------------------------------
      const fsMag = clamp((Math.abs(A) - 20) * 0.45, 5, 70);
      const fsTarget = (A > 0 ? -1 : 1) * fsMag * DEG;
      spankerCur += (fsTarget - spankerCur) * Math.min(1, dt * 1.6);
      const camJ = (0.14 + 0.26 * Math.min(Math.abs(braceCur) / (Math.PI / 4), 1)) * windF * BEAM * 0.16;

      const foreUp = !lostMasts.has("fore");
      const mizzenUp = !lostMasts.has("mizzen");
      // Klueber stehen weit vorn im Wind und fliegen als erste
      jib.visible = foreUp && sailHealth > 0.42;
      staysail.visible = foreUp && sailHealth > 0.30;
      spanker.visible = mizzenUp && sailHealth > 0.20;

      if (foreUp && (jib.visible || staysail.visible)) {
      _clew.set(
         jibTack.x - LOA * 0.16 * Math.sin(-spankerCur),
         jibTack.y - LOA * 0.055,
         jibTack.z - LOA * 0.16 * Math.cos(-spankerCur)
      );
      updateTriSail(jib, {
         tack: jibTack, head: jibHead, clew: _clew,
         camber: camJ, flutter: tornFlutter, time, leeX,
      });
      _clewS.set(
         stayTack.x - LOA * 0.14 * Math.sin(-spankerCur),
         stayTack.y + LOA * 0.02,
         stayTack.z - LOA * 0.14 * Math.cos(-spankerCur)
      );
      updateTriSail(staysail, {
         tack: stayTack, head: stayHead, clew: _clewS,
         camber: camJ * 0.85, flutter: tornFlutter, time: time + 0.8, leeX,
      });
      }

      if (!mizzenUp) {
         // Besan mit dem Kreuzmast ueber Bord - nichts mehr zu animieren
      } else {
      spankerPivot.rotation.y = -spankerCur;
      const spTack = spankerPivot.position;
      const spHead = new THREE.Vector3(0, spTack.y + mz.H * 0.38, spTack.z);
      _clewSp.set(
         spTack.x - spankerBoomLen * Math.sin(-spankerCur),
         spTack.y,
         spTack.z - spankerBoomLen * Math.cos(-spankerCur)
      );
      updateTriSail(spanker, {
         tack: spTack, head: spHead, clew: _clewSp,
         camber: camJ * 1.1, flutter: tornFlutter * 0.85, time: time + 2.1, leeX,
      });
      }

      // --- Rueckstoss -------------------------------------------------------
      for (const side of ["PORT", "STBD"]) {
         if (recoil[side] > 0.0005) {
            recoil[side] = Math.max(0, recoil[side] - dt * 1.6);
            const sx = side === "STBD" ? -1 : 1; // Rohre fahren nach innen
            batteries[side].position.x = sx * recoil[side];
         } else if (batteries[side].position.x !== 0) {
            batteries[side].position.x = 0;
         }
      }

      // --- Flaggen ----------------------------------------------------------
      if (!struck) {
         const flagYaw = normHalf(A + 180) * DEG;
         const fs = clamp((o.windKts || 10) / 18, 0.3, 1.4);
         if (!lostMasts.has("mizzen")) {
            ensignPivot.rotation.y = flagYaw;
            waveFlag(ensign, time, fs);
         } else if (sternEnsignPivot.visible) {
            sternEnsignPivot.rotation.y = flagYaw;
            waveFlag(sternEnsign, time, fs);
         }
         if (!lostMasts.has("main")) {
            pennantPivot.rotation.y = flagYaw;
            waveFlag(pennant, time * 1.3, fs);
         }
      }

      // --- Brandherde --------------------------------------------------------
      for (let i = 0; i < fires.length; i++) {
         const f = fires[i];
         const b = f.userData.base;
         const puls = 1 + 0.34 * Math.sin(time * (7 + i * 1.7) + i);
         const sc = BEAM * b * puls;
         f.scale.set(sc, sc * 1.7, 1);
         f.material.opacity = 0.55 + 0.35 * Math.abs(Math.sin(time * (5 + i) + i * 2));
      }
   };

   // Startpose
   ship.animate(0.016, { awaRel: 180, windKts: 12, time: 0 });
   return ship;
}

function normHalf(d) {
   return ((d % 360) + 540) % 360 - 180;
}

function lerpN(a, b, t) { return a + (b - a) * clamp(t, 0, 1); }

export default { buildWarship };
