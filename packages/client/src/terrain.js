// terrain.js - Insel und Untiefe, sichtbarer Teil (Three.js).
//
// Die Seekarte selbst ist nach @segel/shared/terrain-math umgezogen: dieselbe
// analytische Grundfunktion liefert das Gelaendemesh, die Brandung, die
// Grundberuehrung und - in Phase 1 - die Karte auf dem Server. Hier bleibt der
// Mesh-Aufbau.

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
