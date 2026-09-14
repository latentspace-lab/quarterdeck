// ocean.js - sichtbares Wellenmeer (Three.js).
//
// Die Wellenmathematik ist nach @segel/shared/ocean-math umgezogen: dieselbe
// WAVES-Tabelle speist jetzt die JS-Hoehenfunktion (Auftrieb, Trefferpruefung,
// Server) UND den Vertex-Shader. Hier bleibt nur, was einen Renderer braucht.
//
// Der Wellenzustand (Phase, nachlaufender Seegang) gehoert NICHT mehr diesem
// Modul, sondern einer SeaState-Instanz, die mit festem Schritt integriert
// wird - in Phase 1 vom Server. createOcean() liest sie nur noch ab.
import * as THREE from "three";
import {
   WAVES,
   ampForWind,
   lambdaForWind,
   waveHeightForWind,
   whitecapsForWind,
   seaHeight,
} from "@segel/shared";

export {
   WAVES,
   seaHeight,
   ampForWind,
   lambdaForWind,
   waveHeightForWind,
   whitecapsForWind,
} from "@segel/shared";
export { seaStateName, SeaState } from "@segel/shared";
import { palette, rgb } from "./style.js";

const G = 9.81; // Erdbeschleunigung (Tiefwasser-Dispersionsrelation)

// GLSL-Rumpf der Gerstner-Summe - aus demselben WAVES-Array generiert,
// identische Formeln wie in waveSum().
function glslGerstnerBody() {
   const parts = [];
   for (const w of WAVES) {
      const k = ((2 * Math.PI) / w.L).toFixed(6);
      const om = Math.sqrt(G * ((2 * Math.PI) / w.L)).toFixed(6);
      const off = ((w.off * Math.PI) / 180).toFixed(6);
      const qa = (w.q * w.a).toFixed(6);
      // k wird durch uLambda gestreckt; t ist bereits die aufsummierte
      // Phasenzeit, in der die langsamere Laufgeschwindigkeit steckt.
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

// Weltposition (ohne Mesh-Translation) des Flaechenpunkts p
vec3 surfP(vec2 p, float t) {
  vec3 g = gerstner(p, t) * uAmp;
  return vec3(p.x + g.x, g.y, p.y + g.z);
}

void main() {
  vec2 par = position.xz + uCenter;      // Wellenparameter in Weltkoordinaten
  vec3 g0 = gerstner(par, uTime) * uAmp;
  vec3 pos = vec3(position.x + g0.x, g0.y, position.z + g0.z);

  // Tangenten (Normale) und Jakobi-Determinante (Schaum an gequetschten Kaemmen)
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
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform float uTime;
uniform float uAmp;
uniform float uWaveH;   // signifikante Wellenhoehe in Metern
uniform float uWhite;   // Anteil Weisskappen (0..1)
// Colours of the water, set from the style palette (see style.js)
uniform vec3 uDeep;     // water in the troughs
uniform vec3 uCrest;    // water on the crests
uniform vec3 uSkyLo;    // reflected sky near the horizon
uniform vec3 uSkyHi;    // reflected sky overhead
uniform vec3 uSss;      // light scattered through a crest
uniform vec3 uSunCol;   // sun glitter
uniform vec3 uFoam;     // foam and whitecaps
uniform vec3 uHaze;     // distance haze
uniform float uSpec;    // glitter strength (a print has little)
varying vec3 vWorld;
varying vec3 vNormal;
varying float vFoam;
varying float vHeight;

void main() {
  vec3 toCam = uCamPos - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / max(dist, 0.001);
  vec3 L = normalize(uSunDir);

  // Basis-Wellennormale + hochfrequente Rippelstoerung (nur nah am Betrachter)
  vec3 N = normalize(vNormal);
  float near = 1.0 / (1.0 + dist * 0.045);   // Rippeln nur dicht am Betrachter
  float r1 = sin(vWorld.x * 1.9 + vWorld.z * 1.3 + uTime * 2.2);
  float r2 = sin(-vWorld.x * 1.3 + vWorld.z * 2.1 + uTime * 2.9);
  float r3 = sin(vWorld.x * 3.7 - vWorld.z * 2.9 + uTime * 4.1);
  float rippleAmp = near * (0.02 + min(uAmp, 0.9) * 0.35);
  N = normalize(N + vec3((r1 * 0.6 + r3 * 0.4) * rippleAmp, 0.0,
                         (r2 * 0.6 - r3 * 0.4) * rippleAmp));

  float ndv = clamp(dot(N, V), 0.0, 1.0);
  float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);

  // Himmel-Reflexion entlang des reflektierten Blicks
  vec3 R = reflect(-V, N);
  vec3 skyRef = mix(uSkyLo, uSkyHi, clamp(R.y, 0.0, 1.0));

  // Wasserfarbe: Tiefblau, an Kaemmen heller + Streulicht (Licht durch die Welle)
  vec3 deep = uDeep;
  vec3 crest = uCrest;
  // vorzeichenbehaftet: Taeler dunkel, Kaemme hell - auf die tatsaechliche
  // Wellenhoehe bezogen, damit der Kontrast bei jeder Windstaerke sitzt.
  float hSigned = clamp(vHeight / max(uWaveH * 0.55, 0.08), -1.0, 1.0);
  float hMask = hSigned * 0.5 + 0.5;
  vec3 base = mix(deep, crest, hMask * hMask);
  float sss = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * hMask;
  base += uSss * sss;

  // Sonnen-Glitzern (Blinn-Spekular, durch Rippeln in Funken gebrochen)
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 300.0) * uSpec;
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 sunCol = uSunCol;
  vec3 col = base * (0.35 + 0.65 * diff)
           + skyRef * fres * 1.25
           + sunCol * spec * (fres * 3.5 + 0.35) * (0.35 + near * 1.8);

  // Schaum: an gequetschten Kaemmen (Gerstner-Jakob), Weisskappen mit Wind
  float foamN = 0.65 + 0.35 * sin(vWorld.x * 2.7 + uTime * 1.4)
                       * sin(vWorld.z * 2.3 - uTime * 1.1);
  float jacFoam = smoothstep(0.55, 0.95, vFoam * foamN)
                * clamp(uAmp * 4.5, 0.0, 1.0);

  // Weisskappen: brechende Kaemme. Sie sitzen auf den oberen Wellenteilen und
  // werden mit dem Wind haeufiger - das ist die Eigenschaft, an der man eine
  // Windstaerke auf den ersten Blick erkennt.
  float n1 = sin(vWorld.x * 0.21 + vWorld.z * 0.17 + uTime * 0.9);
  float n2 = sin(vWorld.x * 0.53 - vWorld.z * 0.37 - uTime * 1.3);
  float n3 = sin(vWorld.x * 1.10 + vWorld.z * 0.90 + uTime * 2.1);
  float capNoise = 0.45 + 0.30 * n1 + 0.18 * n2 + 0.10 * n3;
  float capMask = smoothstep(0.42, 0.92, hSigned) * capNoise;
  float caps = smoothstep(0.30, 0.75, capMask) * uWhite;
  // an der Luvflanke der Kaemme bricht es zuerst
  caps *= 0.55 + 0.45 * clamp(1.0 - N.y, 0.0, 1.0) * 3.0;

  float foamMask = clamp(max(jacFoam, caps), 0.0, 1.0);
  col = mix(col, uFoam, foamMask * 0.88);

  // Horizont-Dunst
  float fog = smoothstep(450.0, 1400.0, dist);
  col = mix(col, uHaze, fog);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createOcean({ sunDir = new THREE.Vector3(0.4, 0.6, 0.7) } = {}) {
   const SIZE = 3000;
   const SEG = 150;
   const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
   geo.rotateX(-Math.PI / 2); // Ebene liegt in XZ: position.xz = Wellenparameter

   const uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector2(0, 0) },
      uAmp: { value: ampForWind(12) },
      uLambda: { value: lambdaForWind(12) },
      uWaveH: { value: waveHeightForWind(12) },
      uWhite: { value: whitecapsForWind(12) },
      uWindDir: { value: Math.PI }, // Ausbreitungsrichtung (Rad): PI = nach Sued
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
   };
   setPalette(palette().world.sea);

   const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
   });

   const mesh = new THREE.Mesh(geo, mat);
   mesh.frustumCulled = false;

   const cell = SIZE / SEG;
   // Zuletzt abgelesener Seegang - nur zur Anzeige, nie zur Simulation.
   let seen = { seaWind: 12, phaseT: 0, lambda: lambdaForWind(12), amp: ampForWind(12) };

   const api = {
      mesh,
      uniforms,
      setPalette,

      // Wellenfeld um das Boot recentrieren (auf Segmentraster snappen,
      // damit die Flaeche nahtlos "unendlich" wirkt)
      recenter(boatX, boatZ) {
         const cx = Math.round(boatX / cell) * cell;
         const cz = Math.round(boatZ / cell) * cell;
         mesh.position.set(cx, 0, cz);
         uniforms.uCenter.value.set(cx, cz);
      },

      /**
       * Shader-Uniforms aus dem Simulationszustand nachziehen. Rein lesend:
       * der Seegang wird von SeaState.step() fortgeschrieben, nicht hier.
       * Darf also gefahrlos mit Bildschirmrate laufen.
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

      // Phasenzeit und Streckung - damit rechnen Boot, Wrack und Geschosse
      // mit exakt derselben Wasseroberflaeche wie der Shader.
      get waveTime() { return seen.phaseT; },
      get lambda() { return seen.lambda; },
      get amp() { return seen.amp; },
      get waveHeight() { return waveHeightForWind(seen.seaWind); },
      get windKts() { return seen.seaWind; },
   };

   return api;
}