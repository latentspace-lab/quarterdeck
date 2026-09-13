// terrain.js - Insel und Untiefe.
//
// Der Meeresgrund ist eine analytische Funktion (Summe von Glockenkurven).
// Dieselbe Funktion liefert das sichtbare Gelaende UND die Wassertiefe fuer die
// Grundberuehrung - es kann also nie passieren, dass das Schiff auf etwas
// auflaeuft, das man nicht sieht, oder durch sichtbaren Fels hindurchfaehrt.

import * as THREE from "three";

// Lage der Landmassen (Weltkoordinaten, Meter)
const FEATURES = [
   // Hauptinsel mit Berg
   { x: 1500, z: 700, r: 430, h: 74 },
   { x: 1680, z: 940, r: 300, h: 41 },
   { x: 1290, z: 480, r: 260, h: 26 },
   // vorgelagerte Sandbank - trockener Ruecken, weithin an der Brandung erkennbar
   { x: 980, z: 250, r: 190, h: -9.5 },
   // die eigentliche Falle: ein Riff ohne Land darueber, nur Brecher
   { x: 420, z: 780, r: 170, h: -3.2 },
   { x: 300, z: 640, r: 115, h: -7.0 },
];

const SEA_FLOOR = -26; // Tiefe des offenen Wassers

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
   const N = opts.res || 110;
   const SIZE = opts.size || 3400;
   const X0 = opts.x0 ?? 700, Z0 = opts.z0 ?? 350;

   const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
   geo.rotateX(-Math.PI / 2);
   const pos = geo.attributes.position;
   const colors = new Float32Array(pos.count * 3);
   for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + X0;
      const z = pos.getZ(i) + Z0;
      const h = groundHeight(x, z);
      pos.setY(i, h);
      const c = colorAt(h);
      colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
   }
   geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
   geo.computeVertexNormals();
   const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.96, metalness: 0.0,
   }));
   mesh.position.set(X0, 0, Z0);
   mesh.receiveShadow = true;
   group.add(mesh);

   // Brandung: heller Saum, wo das Wasser flacher als fuenf Meter ist.
   // Nur die Dreiecke behalten, die auch Schaum tragen - sonst liegt eine
   // 3,4 km grosse transparente Flaeche ueber der ganzen Szene.
   const fGeo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
   fGeo.rotateX(-Math.PI / 2);
   const fPos = fGeo.attributes.position;
   const fAlpha = new Float32Array(fPos.count);
   for (let i = 0; i < fPos.count; i++) {
      const x = fPos.getX(i) + X0, z = fPos.getZ(i) + Z0;
      const d = waterDepth(x, z);
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
   const foamMat = new THREE.ShaderMaterial({
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
   const foam = new THREE.Mesh(fGeo, foamMat);
   foam.position.set(X0, 0, Z0);
   group.add(foam);

   if (scene && scene.add) scene.add(group);

   return {
      group, mesh, foam,
      visible: true,
      setVisible(v) { group.visible = !!v; this.visible = !!v; },
      update(t) { foamMat.uniforms.uTime.value = t; },
      depthAt: waterDepth,
      groundAt: groundHeight,
      nearestShoal,
   };
}

export default { createTerrain, waterDepth, groundHeight, nearestShoal };
