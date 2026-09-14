// terrain.js - island and shoal, the visible part (Three.js).
//
// The chart itself moved to @segel/shared/terrain-math: the same analytic
// base function supplies the terrain mesh, the surf, ground contact and -
// in Phase 1 - the chart on the server. What's left here is building the
// mesh.

import * as THREE from "three";
import {
   groundHeight,
   waterDepth,
   generateWorld,
   worldInfo,
   findOpenWater,
   isOpenWater,
   nearestShoal,
   makeRng,
   World,
   PLAY_RADIUS,
} from "@segel/shared";

export {
   groundHeight,
   waterDepth,
   generateWorld,
   worldInfo,
   findOpenWater,
   isOpenWater,
   nearestShoal,
   makeRng,
   World,
   PLAY_RADIUS,
} from "@segel/shared";

// ---------------------------------------------------------------- Rendering
// Land colours (linear triples) from the style palette; setPalette() swaps
// them and recolours the mesh in place.
import { palette, rgb } from "./style.js";
let COL_ROCK, COL_GRASS, COL_SAND, COL_SHALLOW, COL_DEEP, COL_SURF;
function loadPalette(t) {
   COL_ROCK = rgb(t.rock);
   COL_GRASS = rgb(t.grass);
   COL_SAND = rgb(t.sand);
   COL_SHALLOW = rgb(t.shallow);
   COL_DEEP = rgb(t.deep);
   COL_SURF = rgb(t.surf);
}
loadPalette(palette().world.terrain);

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
   // under water: from light sand into the depths
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
   const SIZE = opts.size || 4000;   // covers PLAY_RADIUS (1700 m) all around

   let mesh = null, foam = null, foamMat = null;

   // Builds the terrain and surf mesh from the currently valid chart.
   function build() {
      const geo = new THREE.PlaneGeometry(SIZE, SIZE, N, N);
      geo.rotateX(-Math.PI / 2);
      const pos = geo.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
         pos.setY(i, groundHeight(pos.getX(i), pos.getZ(i)));
      }
      geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      paint(geo);
      geo.computeVertexNormals();
      mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
         vertexColors: true, roughness: 0.96, metalness: 0.0,
      }));
      mesh.receiveShadow = true;
      group.add(mesh);

      // Surf: a bright fringe where the water is shallower than five metres.
      // Keep only the triangles that actually carry foam - otherwise a
      // kilometre-wide transparent surface would sit over the whole scene.
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
         uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color().setRGB(...COL_SURF) } },
         vertexShader: `
            attribute float alpha; varying float vA; varying vec3 vP;
            void main(){ vA = alpha; vP = position;
               gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
         fragmentShader: `
            uniform float uTime; uniform vec3 uColor; varying float vA; varying vec3 vP;
            void main(){
               if (vA <= 0.001) discard;
               // Breakers run over the reef
               float w = 0.55 + 0.45 * sin(vP.x * 0.055 + vP.z * 0.04 - uTime * 1.7);
               gl_FragColor = vec4(uColor, vA * w * 0.85);
            }`,
      });
      foam = new THREE.Mesh(fGeo, foamMat);
      group.add(foam);
   }

   // Write the height-based colour of every vertex into the colour attribute.
   function paint(geo) {
      const pos = geo.attributes.position;
      const col = geo.attributes.color;
      for (let i = 0; i < pos.count; i++) {
         const c = colorAt(pos.getY(i));
         col.setXYZ(i, c[0], c[1], c[2]);
      }
      col.needsUpdate = true;
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
      /** Swap the land and surf colours for another style's palette. */
      setPalette(t) {
         loadPalette(t);
         if (mesh) paint(mesh.geometry);
         if (foamMat) foamMat.uniforms.uColor.value.setRGB(...COL_SURF);
      },
      // Roll a new chart and rebuild the geometry.
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
