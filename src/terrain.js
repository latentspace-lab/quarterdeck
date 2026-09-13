// terrain.js - Insel und Untiefe.
//
// Der Meeresgrund ist eine analytische Funktion (Summe von Glockenkurven).
// Dieselbe Funktion liefert das sichtbare Gelaende UND die Wassertiefe fuer die
// Grundberuehrung - es kann also nie passieren, dass das Schiff auf etwas
// auflaeuft, das man nicht sieht, oder durch sichtbaren Fels hindurchfaehrt.

import * as THREE from "three";

// ---------------------------------------------------------------------------
// Weltgenerator
//
// Die Seekarte wird aus einem Startwert (seed) erzeugt: gleicher Wert, gleiche
// Inseln. Ein Archipel entsteht aus Gruppen von Glockenkurven - ein Hauptgipfel,
// ein paar Nebenkuppen, dazu vorgelagerte Riffe und Sandbaenke. Die Riffe sind
// das eigentlich Gefaehrliche: sie liegen knapp unter Wasser und verraten sich
// nur durch die Brandung.
//
// Rund um den Nullpunkt bleibt ein Revier frei, damit kein Schiff auf einem
// Riff startet.
// ---------------------------------------------------------------------------

const SEA_FLOOR = -26;        // Tiefe des offenen Wassers
export const PLAY_RADIUS = 1700;   // Umkreis, in dem Land erzeugt wird
const HOME_CLEAR = 520;       // um den Nullpunkt bleibt es tief

// Deterministischer Zufall (mulberry32) - gleicher Seed, gleiche Welt
export function makeRng(seed) {
   let a = (seed >>> 0) || 1;
   return function rng() {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
   };
}

// Die aktuell gueltige Seekarte. groundHeight() liest daraus, damit alle
// Systeme - Gelaendemesh, Brandung, Grundberuehrung, KI - dieselbe Welt sehen.
let FEATURES = [];
let WORLD = { seed: 0, islands: [], reefs: [] };

export function worldInfo() { return WORLD; }

// Eine Welt erzeugen und aktiv setzen
export function generateWorld(seed = (Math.random() * 1e9) | 0, opts = {}) {
   const rng = makeRng(seed);
   const feats = [];
   const islands = [];
   const reefs = [];

   const nIslands = opts.islands ?? (2 + Math.floor(rng() * 3));   // 2..4 Gruppen
   const placed = [];

   const farEnough = (x, z, r) => {
      if (Math.hypot(x, z) < HOME_CLEAR + r) return false;
      for (const p of placed) {
         if (Math.hypot(x - p.x, z - p.z) < (r + p.r) * 1.15) return false;
      }
      return true;
   };

   for (let i = 0; i < nIslands; i++) {
      let x = 0, z = 0, r = 0, ok = false;
      for (let tries = 0; tries < 60 && !ok; tries++) {
         const ang = rng() * Math.PI * 2;
         const dist = HOME_CLEAR + 180 + rng() * (PLAY_RADIUS - HOME_CLEAR - 300);
         x = Math.cos(ang) * dist;
         z = Math.sin(ang) * dist;
         r = 200 + rng() * 230;
         ok = farEnough(x, z, r);
      }
      if (!ok) continue;
      placed.push({ x, z, r });

      // Hauptgipfel
      const h = 38 + rng() * 74;
      feats.push({ x, z, r, h });
      const isle = { x, z, r, h, parts: 1 };

      // Nebenkuppen
      const sub = 1 + Math.floor(rng() * 3);
      for (let k = 0; k < sub; k++) {
         const a = rng() * Math.PI * 2;
         const d = r * (0.45 + rng() * 0.75);
         feats.push({
            x: x + Math.cos(a) * d,
            z: z + Math.sin(a) * d,
            r: r * (0.40 + rng() * 0.45),
            h: h * (0.25 + rng() * 0.55),
         });
         isle.parts++;
      }

      // Vorgelagerte Riffe und Sandbaenke
      const nr = Math.floor(rng() * 3);
      for (let k = 0; k < nr; k++) {
         const a = rng() * Math.PI * 2;
         const d = r * (1.05 + rng() * 0.85);
         const rx = x + Math.cos(a) * d, rz = z + Math.sin(a) * d;
         if (Math.hypot(rx, rz) < HOME_CLEAR) continue;
         const rr = 95 + rng() * 110;
         // h leicht negativ bis knapp ueber Null: mal Untiefe, mal Sandbank
         const rh = -9 + rng() * 11;
         feats.push({ x: rx, z: rz, r: rr, h: rh });
         reefs.push({ x: rx, z: rz, r: rr });
      }
      islands.push(isle);
   }

   // Freistehende Riffe im offenen Wasser - die echten Fallen
   const nFree = 1 + Math.floor(rng() * 3);
   for (let i = 0; i < nFree; i++) {
      let x = 0, z = 0, ok = false, rr = 0;
      for (let tries = 0; tries < 50 && !ok; tries++) {
         const ang = rng() * Math.PI * 2;
         const dist = HOME_CLEAR + 120 + rng() * (PLAY_RADIUS - HOME_CLEAR - 200);
         x = Math.cos(ang) * dist;
         z = Math.sin(ang) * dist;
         rr = 110 + rng() * 110;
         ok = true;
         for (const p of placed) {
            if (Math.hypot(x - p.x, z - p.z) < p.r * 1.2) { ok = false; break; }
         }
      }
      if (!ok) continue;
      feats.push({ x, z, r: rr, h: -8.5 + rng() * 7 });
      reefs.push({ x, z, r: rr });
   }

   FEATURES = feats;
   WORLD = { seed: seed >>> 0, islands, reefs, rng: makeRng(seed ^ 0x9e3779b9) };
   return WORLD;
}

// Hoehe des Meeresgrunds ueber der Wasserlinie (negativ = unter Wasser)
export function groundHeight(x, z) {
   let h = SEA_FLOOR;
   for (let i = 0; i < FEATURES.length; i++) {
      const f = FEATURES[i];
      const dx = x - f.x, dz = z - f.z;
      const d2 = (dx * dx + dz * dz) / (f.r * f.r);
      if (d2 > 9) continue;
      h += (f.h - SEA_FLOOR) * Math.exp(-d2 * 1.15);
   }
   return h;
}

// Wassertiefe in Metern (0 oder negativ = Land)
export function waterDepth(x, z) {
   return -groundHeight(x, z);
}

// Ist hier genug Wasser, auch ringsum? clearance = Radius, der frei sein muss.
export function isOpenWater(x, z, minDepth = 15, clearance = 200) {
   if (waterDepth(x, z) < minDepth) return false;
   for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (waterDepth(x + Math.cos(a) * clearance, z + Math.sin(a) * clearance) < minDepth * 0.6) {
         return false;
      }
   }
   return true;
}

// Einen freien Platz suchen. opts: { rng, near {x,z}, minDist, maxDist,
// minDepth, clearance, avoid [{x,z,r}] }
export function findOpenWater(opts = {}) {
   const rng = opts.rng || Math.random;
   const near = opts.near || { x: 0, z: 0 };
   const minDist = opts.minDist ?? 0;
   const maxDist = opts.maxDist ?? 600;
   const minDepth = opts.minDepth ?? 15;
   const clearance = opts.clearance ?? 220;
   const avoid = opts.avoid || [];
   for (let tries = 0; tries < 400; tries++) {
      const a = rng() * Math.PI * 2;
      const d = minDist + rng() * Math.max(maxDist - minDist, 1);
      const x = near.x + Math.cos(a) * d;
      const z = near.z + Math.sin(a) * d;
      let bad = false;
      for (const av of avoid) {
         if (Math.hypot(x - av.x, z - av.z) < (av.r || 200)) { bad = true; break; }
      }
      if (bad) continue;
      if (isOpenWater(x, z, minDepth, clearance)) return { x, z };
   }
   // Notfall: der Nullpunkt bleibt immer frei
   return { x: near.x, z: near.z };
}

// Naechstgelegene Untiefe (fuer Warnungen im HUD)
export function nearestShoal(x, z) {
   let best = null;
   for (const f of FEATURES) {
      const d = Math.hypot(x - f.x, z - f.z) - f.r;
      if (!best || d < best.dist) best = { dist: d, x: f.x, z: f.z, r: f.r };
   }
   return best;
}

// ---------------------------------------------------------------- Darstellung
const COL_ROCK = [0.42, 0.40, 0.38];
const COL_GRASS = [0.33, 0.42, 0.24];
const COL_SAND = [0.80, 0.73, 0.55];
const COL_SHALLOW = [0.45, 0.62, 0.60];
const COL_DEEP = [0.16, 0.30, 0.40];

function colorAt(h) {
   if (h > 46) return COL_ROCK;
   if (h > 8) {
      const t = Math.min(1, (h - 8) / 38);
      return [
         COL_GRASS[0] + (COL_ROCK[0] - COL_GRASS[0]) * t,
         COL_GRASS[1] + (COL_ROCK[1] - COL_GRASS[1]) * t,
         COL_GRASS[2] + (COL_ROCK[2] - COL_GRASS[2]) * t,
      ];
   }
   if (h > -1.5) {
      const t = Math.min(1, (h + 1.5) / 9.5);
      return [
         COL_SAND[0] + (COL_GRASS[0] - COL_SAND[0]) * t,
         COL_SAND[1] + (COL_GRASS[1] - COL_SAND[1]) * t,
         COL_SAND[2] + (COL_GRASS[2] - COL_SAND[2]) * t,
      ];
   }
   // unter Wasser: von hellem Sand in die Tiefe
   const t = Math.min(1, (-h - 1.5) / 14);
   return [
      COL_SHALLOW[0] + (COL_DEEP[0] - COL_SHALLOW[0]) * t,
      COL_SHALLOW[1] + (COL_DEEP[1] - COL_SHALLOW[1]) * t,
      COL_SHALLOW[2] + (COL_DEEP[2] - COL_SHALLOW[2]) * t,
   ];
}

export function createTerrain(scene, opts = {}) {
   const group = new THREE.Group();
   const N = opts.res || 150;
   const SIZE = opts.size || 4000;   // deckt PLAY_RADIUS (1700 m) ringsum ab

   let mesh = null, foam = null, foamMat = null;

   // Baut Gelaende- und Brandungsmesh aus der aktuell gueltigen Seekarte.
   function build() {
      const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
         const x = pos.getX(i), z = pos.getZ(i);
         const h = groundHeight(x, z);
         pos.setY(i, h);
         const c = colorAt(h);
         colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
         vertexColors: true, roughness: 0.96, metalness: 0.0,
      }));
      mesh.receiveShadow = true;
      group.add(mesh);

      // Brandung: heller Saum, wo das Wasser flacher als fuenf Meter ist.
      // Nur die Dreiecke behalten, die auch Schaum tragen - sonst liegt eine
      // kilometergrosse transparente Flaeche ueber der ganzen Szene.
      const fGeo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
      fGeo.rotateX(-Math.PI / 2);
      const fPos = fGeo.attributes.position;
      const fAlpha = new Float32Array(fPos.count);
      for (let i = 0; i < fPos.count; i++) {
         const d = waterDepth(fPos.getX(i), fPos.getZ(i));
         fAlpha[i] = d > 0 && d < 5 ? Math.pow(1 - d / 5, 1.5) : 0;
         fPos.setY(i, 0.35);
      }
      const oldIdx = fGeo.getIndex().array;
      const keep = [];
      for (let i = 0; i < oldIdx.length; i += 3) {
         const a = oldIdx[i], b = oldIdx[i + 1], c = oldIdx[i + 2];
         if (fAlpha[a] > 0.002 || fAlpha[b] > 0.002 || fAlpha[c] > 0.002) keep.push(a, b, c);
      }
      fGeo.setIndex(keep);
      fGeo.setAttribute("alpha", new THREE.BufferAttribute(fAlpha, 1));
      foamMat = new THREE.ShaderMaterial({
         transparent: true, depthWrite: false,
         uniforms: { uTime: { value: 0 } },
         vertexShader: `
            attribute float alpha; varying float vA; varying vec3 vP;
            void main(){ vA = alpha; vP = position;
               gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
         fragmentShader: `
            uniform float uTime; varying float vA; varying vec3 vP;
            void main(){
               if (vA <= 0.001) discard;
               // Brecher laufen ueber das Riff
               float w = 0.55 + 0.45 * sin(vP.x * 0.055 + vP.z * 0.04 - uTime * 1.7);
               gl_FragColor = vec4(1.0, 1.0, 1.0, vA * w * 0.85);
            }`,
      });
      foam = new THREE.Mesh(fGeo, foamMat);
      group.add(foam);
   }

   function clear() {
      for (const m of [mesh, foam]) {
         if (!m) continue;
         group.remove(m);
         m.geometry.dispose();
         m.material.dispose();
      }
      mesh = foam = foamMat = null;
   }

   if (opts.generate !== false) generateWorld(opts.seed ?? ((Math.random() * 1e9) | 0));
   build();

   if (scene && scene.add) scene.add(group);

   return {
      group,
      get mesh() { return mesh; },
      get foam() { return foam; },
      visible: true,
      setVisible(v) { group.visible = !!v; this.visible = !!v; },
      update(t) { if (foamMat) foamMat.uniforms.uTime.value = t; },
      // Neue Seekarte auswuerfeln und Geometrie neu aufbauen.
      regenerate(seed) {
         const w = generateWorld(seed ?? ((Math.random() * 1e9) | 0));
         clear();
         build();
         return w;
      },
      get seed() { return worldInfo().seed; },
      world: worldInfo,
      depthAt: waterDepth,
      groundAt: groundHeight,
      nearestShoal,
      openWater: findOpenWater,
   };
}

export default {
   createTerrain, waterDepth, groundHeight, nearestShoal,
   generateWorld, worldInfo, findOpenWater, isOpenWater, makeRng, PLAY_RADIUS,
};
