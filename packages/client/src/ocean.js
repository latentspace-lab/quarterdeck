// ocean.js - the visible wave ocean (Three.js).
//
// The wave math moved to @quarterdeck/shared/ocean-math: the same WAVES table now
// feeds the JS height function (buoyancy, hit detection, server) AND the
// vertex shader. What's left here is only what needs a renderer.
//
// The wave state (phase, lagging sea state) NO LONGER belongs to this
// module but to a SeaState instance, integrated with a fixed step - in
// Phase 1 by the server. createOcean() only reads it now.
import * as THREE from "three";
import {
   WAVES,
   ampForWind,
   lambdaForWind,
   waveHeightForWind,
   whitecapsForWind,
   seaHeight,
} from "@quarterdeck/shared";

export {
   WAVES,
   seaHeight,
   ampForWind,
   lambdaForWind,
   waveHeightForWind,
   whitecapsForWind,
} from "@quarterdeck/shared";
export { seaStateName, SeaState } from "@quarterdeck/shared";
import { palette, rgb } from "./style.js";
import { NOISE_GLSL } from "./puffs.js";

const G = 9.81; // gravitational acceleration (deep-water dispersion relation)
/** Stern positions per ship that the wake is drawn along. */
export const TRAIL_N = 8;

// GLSL body of the Gerstner sum - generated from the same WAVES array,
// identical formulas to waveSum().
function glslGerstnerBody() {
   const parts = [];
   for (const w of WAVES) {
      const k = ((2 * Math.PI) / w.L).toFixed(6);
      const om = Math.sqrt(G * ((2 * Math.PI) / w.L)).toFixed(6);
      const off = ((w.off * Math.PI) / 180).toFixed(6);
      const qa = (w.q * w.a).toFixed(6);
      // k is stretched by uLambda; t is already the accumulated phase time,
      // which carries the slower propagation speed.
      parts.push(
`  {
    vec2 d = vec2(sin(uWindDir + ${off}), cos(uWindDir + ${off}));
    float th = (${k} / uLambda) * dot(d, p) - ${om} * t + ${w.ph.toFixed(4)};
    float c = cos(th);
    float s = sin(th);
    h += ${w.a.toFixed(4)} * s;
    dx += ${qa} * d.x * c;
    dz += ${qa} * d.y * c;
  }`
      );
   }
   return parts.join("\n");
}

const VERT = `
uniform float uTime;
uniform vec2 uCenter;
uniform float uAmp;
uniform float uLambda;
uniform float uWindDir;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

vec3 gerstner(vec2 p, float t) {
  float h = 0.0;
  float dx = 0.0;
  float dz = 0.0;
${glslGerstnerBody()}
  return vec3(dx, h, dz);
}

// World position (without mesh translation) of the surface point p
vec3 surfP(vec2 p, float t) {
  vec3 g = gerstner(p, t) * uAmp;
  return vec3(p.x + g.x, g.y, p.y + g.z);
}

void main() {
  vec2 par = position.xz + uCenter;      // wave parameters in world coordinates
  vec3 g0 = gerstner(par, uTime) * uAmp;
  vec3 pos = vec3(position.x + g0.x, g0.y, position.z + g0.z);

  // Tangents (normal) and Jacobian determinant (foam at squeezed crests)
  float e = 1.7;
  vec3 P0 = surfP(par, uTime);
  vec3 Px = surfP(par + vec2(e, 0.0), uTime);
  vec3 Pz = surfP(par + vec2(0.0, e), uTime);
  vec3 dPdx = (Px - P0) / e;
  vec3 dPdz = (Pz - P0) / e;
  vNormal = normalize(cross(dPdz, dPdx));
  float J = dPdx.x * dPdz.z - dPdx.z * dPdz.x;
  vFoam = clamp((1.0 - J) * 1.6, 0.0, 1.0);
  vHeight = g0.y;

  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = `
precision highp float;
${NOISE_GLSL}
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uAmp;
uniform float uWaveH;   // significant wave height in meters
uniform float uWhite;   // fraction of whitecaps (0..1)
uniform float uWindDir; // propagation direction, radians
// Colours of the water, set from the style palette (see style.js)
uniform vec3 uDeep;     // water in the troughs
uniform vec3 uCrest;    // water on the crests
uniform vec3 uSkyLo;    // reflected sky near the horizon
uniform vec3 uSkyHi;    // reflected sky overhead
uniform vec3 uSss;      // light scattered through a crest
uniform vec3 uSunCol;   // sun glitter
uniform vec3 uFoam;     // foam and whitecaps
uniform vec3 uHaze;     // distance haze
uniform vec3 uInk;      // the printer's ink in the troughs (painted style)
uniform float uSpec;    // glitter strength (a print has little)
uniform float uPainted; // 1 = the aquatint sea, 0 = the plain one
// Ships for bow waves and wakes: x, z, heading (rad), speed (kn); loa, beam.
// The wake follows the water the ship actually passed over: a trail of
// TRAIL_N stern positions per ship (x, z, distance run from the stern).
uniform vec4 uShips[4];
uniform vec2 uShipDim[4];
uniform vec3 uTrail[32];
uniform int uShipN;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

// Value noise with a variable number of octaves. Beyond a few hundred metres
// the two finest octaves of the ripple, grain and streak noise are smaller
// than a pixel, so the far water gets two octaves and the near water four.
// (Only the high-frequency calls use this; the low-frequency band and hatch
// noise keep four octaves, their detail is still visible on the horizon.)
float fbmN(vec2 p, int n) {
   float a = 0.5, s = 0.0;
   for (int i = 0; i < 4; i++) { if (i >= n) break; s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
   return s;
}
const float LOD_DIST = 300.0;

// Long streaks that run with the wind: squeezed across, stretched along.
float streaks(vec2 p, vec2 wd, float t, int oct) {
   float along = dot(p, wd), across = dot(p, vec2(wd.y, -wd.x));
   return fbmN(vec2(along * 0.045 - t * 0.12, across * 0.55), oct);
}

// The painted sea: ranks of rollers with an inky trough and a lit crest,
// wind-blown foam streaks, whitecaps as broken brush strokes, bow waves
// and wakes - the way the colourist of a naval aquatint drew water.
vec3 painted(vec3 V, float dist, vec3 L) {
  vec2 wd = vec2(sin(uWindDir), cos(uWindDir));
  vec3 N = normalize(vNormal);
  float near = 1.0 / (1.0 + dist * 0.045);
  int oct = dist < LOD_DIST ? 4 : 2;
  float rip = fbmN(vWorld.xz * 0.9 + vec2(uTime * 0.6, -uTime * 0.4), oct) - 0.5;
  float rip2 = fbmN(vWorld.xz * 1.53 + vec2(-uTime * 0.5, uTime * 0.7), oct) - 0.5;
  float rippleAmp = near * (0.04 + min(uAmp, 0.9) * 0.45);
  N = normalize(N + vec3(rip * rippleAmp, 0.0, rip2 * rippleAmp));

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 R = reflect(-V, N);
  vec3 skyRef = mix(uSkyLo, uSkyHi, clamp(R.y, 0.0, 1.0));

  float hSigned = clamp(vHeight / max(uWaveH * 0.55, 0.08), -1.0, 1.0);
  float hMask = hSigned * 0.5 + 0.5;
  vec3 trough = mix(uDeep, uInk, 0.45);
  vec3 base = mix(trough, uCrest, pow(hMask, 1.6));
  // bands of tone running with the wind, so the sea reads as rows of
  // rollers even where the geometry is gentle
  float along = dot(vWorld.xz, wd);
  float band = sin(along * 0.26 - uTime * 1.0 + (fbm(vWorld.xz * 0.04) - 0.5) * 6.0);
  base = mix(base, trough, smoothstep(0.1, 0.9, band) * 0.40 * smoothstep(0.1, 1.0, uWaveH));
  // the engraver's hatching along each roller, fading with distance
  float hatch = 0.5 + 0.5 * sin(along * 3.1 + (fbm(vWorld.xz * 0.3) - 0.5) * 4.0);
  base = mix(base, trough, hatch * 0.16 * (1.0 - smoothstep(60.0, 400.0, dist)));
  float sss = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * hMask;
  base += uSss * sss * 0.8;
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 col = base * (0.55 + 0.45 * diff) + skyRef * fres * 0.9;
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 120.0) * uSpec;
  col += uSunCol * spec * 0.25;

  // --- foam -----------------------------------------------------------
  float st = streaks(vWorld.xz, wd, uTime, oct);
  float grain = fbmN(vWorld.xz * 1.6 + 3.0, oct);
  float capZone = smoothstep(0.35, 0.95, hSigned) * (0.55 + 0.45 * clamp((1.0 - N.y) * 3.0, 0.0, 1.0));
  float capField = capZone * (0.45 + 0.55 * st) + (grain - 0.5) * 0.35;
  float caps = smoothstep(0.47 - uWhite * 0.18, 0.55 - uWhite * 0.18, capField) * step(0.02, uWhite);
  float crestLine = smoothstep(0.80, 0.93, hSigned) * (1.0 - smoothstep(0.95, 1.0, hSigned)) * smoothstep(0.3, 1.2, uWaveH) * (0.4 + 0.6 * st);
  float jacFoam = smoothstep(0.55, 0.9, vFoam * (0.6 + 0.6 * st)) * clamp(uAmp * 4.5, 0.0, 1.0) * smoothstep(0.35, 0.6, grain);
  float lace = smoothstep(0.66, 0.76, st * (0.6 + 0.4 * grain)) * uWhite * 0.35 * smoothstep(-0.6, 0.4, hSigned);

  // bow waves and wakes
  float shipFoam = 0.0;
  for (int i = 0; i < 4; i++) {
     if (i >= uShipN) break;
     vec4 sh = uShips[i]; vec2 dim = uShipDim[i];
     vec2 d = vWorld.xz - sh.xy;
     // The bow wave and the wake (TRAIL_N points, a fifth of a length
     // apart) all lie within three lengths of the ship; the rest of the
     // sea skips the trail loop and its noise.
     if (dot(d, d) > dim.x * dim.x * 9.0) continue;
     vec2 fwd = vec2(sin(sh.z), cos(sh.z));
     float s = dot(d, fwd), r = dot(d, vec2(fwd.y, -fwd.x));
     float loa = dim.x, beam = dim.y, spd = clamp(sh.w / 8.0, 0.0, 1.0);
     float sn = s / (0.5 * loa);
     float halfW = 0.5 * beam * sqrt(clamp(1.0 - sn * sn, 0.0, 1.0));
     float rb = abs(r) - halfW;
     float bow = smoothstep(-0.05, 0.35, sn) * smoothstep(1.02, 0.7, sn) * smoothstep(-0.3, 0.2, rb) * (1.0 - smoothstep(0.3, 1.2 + 3.5 * spd, rb));
     bow *= (0.5 + 0.7 * fbmN(vec2(s * 0.5, r * 0.9) + uTime * 0.7, oct)) * (0.35 + spd);
     // wake: churned water along the trail astern, widening a little and
     // fading with the distance run. The lane is a soft profile across the
     // nearest point of the trail; the texture is world-space noise so it
     // does not draw contours around the line.
     float lane = 0.0;
     for (int j = 0; j < 7; j++) {
        vec3 a = uTrail[i * 8 + j], b = uTrail[i * 8 + j + 1];
        vec2 ab = b.xy - a.xy;
        float l2 = max(dot(ab, ab), 1e-4);
        float t = clamp(dot(vWorld.xz - a.xy, ab) / l2, 0.0, 1.0);
        vec2 q = a.xy + ab * t;
        float dq = length(vWorld.xz - q);
        float len = mix(a.z, b.z, t);
        float hw = 0.5 * beam * 0.8 + len * 0.06;
        float x = dq / hw;
        lane = max(lane, exp(-x * x * 2.2) * exp(-len / (loa * 1.2)));
     }
     float churn = fbmN(vWorld.xz * 0.45 + vec2(uTime * 0.15, -uTime * 0.1), oct);
     float wake = lane * spd * smoothstep(0.30, 0.75, churn + lane * 0.35);
     shipFoam = max(shipFoam, max(bow, wake));
  }

  float foamMask = clamp(max(max(caps, jacFoam), max(lace * 0.7, shipFoam)), 0.0, 1.0);
  vec3 foamCol = mix(uFoam * 0.72, uFoam, 0.4 + 0.6 * diff);
  col = mix(col, foamCol, foamMask * 0.92);
  col = mix(col, uFoam, crestLine * 0.55);
  // a thin ink shadow under every foam patch, as the colourist did
  float under = smoothstep(0.0, 0.25, foamMask) - smoothstep(0.25, 0.9, foamMask);
  col = mix(col, uInk, under * 0.18);
  return col;
}

// The plain sea: unchanged from before the aquatint work.
vec3 plain(vec3 V, float dist, vec3 L) {

  // Base wave normal + high-frequency ripple perturbation (only near the viewer)
  vec3 N = normalize(vNormal);
  float near = 1.0 / (1.0 + dist * 0.045);   // ripples only close to the viewer
  float r1 = sin(vWorld.x * 1.9 + vWorld.z * 1.3 + uTime * 2.2);
  float r2 = sin(-vWorld.x * 1.3 + vWorld.z * 2.1 + uTime * 2.9);
  float r3 = sin(vWorld.x * 3.7 - vWorld.z * 2.9 + uTime * 4.1);
  float rippleAmp = near * (0.02 + min(uAmp, 0.9) * 0.35);
  N = normalize(N + vec3((r1 * 0.6 + r3 * 0.4) * rippleAmp, 0.0,
                         (r2 * 0.6 - r3 * 0.4) * rippleAmp));

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Sky reflection along the reflected view direction
  vec3 R = reflect(-V, N);
  vec3 skyRef = mix(uSkyLo, uSkyHi, clamp(R.y, 0.0, 1.0));

  // Water colour: deep blue, brighter at crests + scattered light (light through the wave)
  vec3 deep = uDeep;
  vec3 crest = uCrest;
  // signed: troughs dark, crests bright - relative to the actual wave
  // height, so the contrast holds at every wind strength.
  float hSigned = clamp(vHeight / max(uWaveH * 0.55, 0.08), -1.0, 1.0);
  float hMask = hSigned * 0.5 + 0.5;
  vec3 base = mix(deep, crest, hMask * hMask);
  float sss = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * hMask;
  base += uSss * sss;

  // Sun glitter (Blinn specular, broken into sparkles by ripples)
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 300.0) * uSpec;
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 sunCol = uSunCol;
  vec3 col = base * (0.35 + 0.65 * diff)
           + skyRef * fres * 1.25
           + sunCol * spec * (fres * 3.5 + 0.35) * (0.35 + near * 1.8);

  // Foam: at squeezed crests (Gerstner Jacobian), whitecaps with wind
  float foamN = 0.65 + 0.35 * sin(vWorld.x * 2.7 + uTime * 1.4)
                       * sin(vWorld.z * 2.3 - uTime * 1.1);
  float jacFoam = smoothstep(0.55, 0.95, vFoam * foamN)
                * clamp(uAmp * 4.5, 0.0, 1.0);

  // Whitecaps: breaking crests. They sit on the upper parts of the waves and
  // become more frequent with wind - the trait that lets you read a wind
  // strength at a glance.
  float n1 = sin(vWorld.x * 0.21 + vWorld.z * 0.17 + uTime * 0.9);
  float n2 = sin(vWorld.x * 0.53 - vWorld.z * 0.37 - uTime * 1.3);
  float n3 = sin(vWorld.x * 1.10 + vWorld.z * 0.90 + uTime * 2.1);
  float capNoise = 0.45 + 0.30 * n1 + 0.18 * n2 + 0.10 * n3;
  float capMask = smoothstep(0.42, 0.92, hSigned) * capNoise;
  float caps = smoothstep(0.30, 0.75, capMask) * uWhite;
  // it breaks first on the windward flank of the crests
  caps *= 0.55 + 0.45 * clamp(1.0 - N.y, 0.0, 1.0) * 3.0;

  float foamMask = clamp(max(jacFoam, caps), 0.0, 1.0);
  col = mix(col, uFoam, foamMask * 0.88);

  return col;
}

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec3 L = normalize(uSunDir);
  vec3 col = uPainted > 0.5 ? painted(V, dist, L) : plain(V, dist, L);

  // Horizon haze
  float fog = smoothstep(450.0, 1400.0, dist);
  col = mix(col, uHaze, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOcean({ sunDir = new THREE.Vector3(0.4, 0.6, 0.7) } = {}) {
   const SIZE = 3000;
   const SEG = 150;
   const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
   geo.rotateX(-Math.PI / 2); // the plane lies in XZ: position.xz = wave parameters

   const uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uAmp: { value: ampForWind(12) },
      uLambda: { value: lambdaForWind(12) },
      uWaveH: { value: waveHeightForWind(12) },
      uWhite: { value: whitecapsForWind(12) },
      uWindDir: { value: Math.PI }, // propagation direction (radians): PI = toward south
      uSunDir: { value: sunDir.clone().normalize() },
      uCamPos: { value: new THREE.Vector3() },
      uDeep: { value: new THREE.Color() },
      uCrest: { value: new THREE.Color() },
      uSkyLo: { value: new THREE.Color() },
      uSkyHi: { value: new THREE.Color() },
      uSss: { value: new THREE.Color() },
      uSunCol: { value: new THREE.Color() },
      uFoam: { value: new THREE.Color() },
      uHaze: { value: new THREE.Color() },
      uSpec: { value: 1.0 },
      uInk: { value: new THREE.Color() },
      uPainted: { value: 0.0 },
      uShips: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) },
      uShipDim: { value: [0, 1, 2, 3].map(() => new THREE.Vector2(40, 10)) },
      uTrail: { value: Array.from({ length: 32 }, () => new THREE.Vector3()) },
      uShipN: { value: 0 },
   };
   // Water colours from the style palette; raw linear triples go in as they
   // are, hex values are linearised (the shader works in linear space).
   const setPalette = (sea) => {
      uniforms.uDeep.value.setRGB(...rgb(sea.deep));
      uniforms.uCrest.value.setRGB(...rgb(sea.crest));
      uniforms.uSkyLo.value.setRGB(...rgb(sea.skyLo));
      uniforms.uSkyHi.value.setRGB(...rgb(sea.skyHi));
      uniforms.uSss.value.setRGB(...rgb(sea.sss));
      uniforms.uSunCol.value.setRGB(...rgb(sea.sun));
      uniforms.uFoam.value.setRGB(...rgb(sea.foam));
      uniforms.uHaze.value.setRGB(...rgb(sea.haze));
      uniforms.uSpec.value = sea.specular;
      uniforms.uInk.value.setRGB(...rgb(sea.ink ?? sea.deep));
      uniforms.uPainted.value = sea.painted ? 1.0 : 0.0;
   };
   setPalette(palette().world.sea);

   const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
   });

   const mesh = new THREE.Mesh(geo, mat);
   mesh.frustumCulled = false;
   // Drawn before everything else: the sea covers most of the screen and
   // its shader is the most expensive, so it should be the one that wins
   // the depth test outright rather than the one that overwrites the land.
   mesh.renderOrder = -1;

   const cell = SIZE / SEG;
   // Last-read sea state - for display only, never for simulation.
   let seen = { seaWind: 12, phaseT: 0, lambda: lambdaForWind(12), amp: ampForWind(12) };

   const api = {
      mesh,
      uniforms,
      setPalette,

      // Recenter the wave field around the boat (snap to the segment grid
      // so the surface looks seamlessly "infinite")
      recenter(boatX, boatZ) {
         const cx = Math.round(boatX / cell) * cell;
         const cz = Math.round(boatZ / cell) * cell;
         mesh.position.set(cx, 0, cz);
         uniforms.uCenter.value.set(cx, cz);
      },

      /**
       * Refresh the shader uniforms from the simulation state. Read-only:
       * the sea state is advanced by SeaState.step(), not here.
       * Can therefore safely run at screen rate.
       */
      sync(sea, camPos, boatX, boatZ) {
         seen = {
            seaWind: sea.seaWind,
            phaseT: sea.phaseT,
            lambda: sea.lambda,
            amp: sea.amp,
         };
         uniforms.uTime.value = sea.phaseT;
         uniforms.uAmp.value = sea.amp;
         uniforms.uLambda.value = sea.lambda;
         uniforms.uWaveH.value = sea.waveHeight;
         uniforms.uWhite.value = sea.whitecaps;
         uniforms.uWindDir.value = sea.windRad;
         if (camPos) uniforms.uCamPos.value.copy(camPos);
         this.recenter(boatX, boatZ);
      },

      /**
       * The ships that plough the painted sea (bow wave, wake): up to four
       * of { x, z, heading (deg), speed (kn), loa, beam, trail }, where
       * trail is up to TRAIL_N stern positions {x, z}, newest first (the
       * first is the stern itself). Missing points repeat the last one.
       */
      setShips(list) {
         const n = Math.min(4, list.length);
         for (let i = 0; i < n; i++) {
            const s = list[i];
            uniforms.uShips.value[i].set(s.x, s.z, s.heading * Math.PI / 180, s.speed);
            uniforms.uShipDim.value[i].set(s.loa, s.beam);
            const tr = s.trail || [];
            let run = 0, px = 0, pz = 0;
            for (let j = 0; j < TRAIL_N; j++) {
               const pt = tr[Math.min(j, tr.length - 1)] || { x: s.x, z: s.z };
               if (j > 0) run += Math.hypot(pt.x - px, pt.z - pz);
               px = pt.x; pz = pt.z;
               uniforms.uTrail.value[i * TRAIL_N + j].set(pt.x, pt.z, run);
            }
         }
         uniforms.uShipN.value = n;
      },

      // Phase time and stretch - so the boat, wreckage and projectiles
      // compute against exactly the same water surface as the shader.
      get waveTime() { return seen.phaseT; },
      get lambda() { return seen.lambda; },
      get amp() { return seen.amp; },
      get waveHeight() { return waveHeightForWind(seen.seaWind); },
      get windKts() { return seen.seaWind; },
   };

   return api;
}