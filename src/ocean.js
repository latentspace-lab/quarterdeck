// ocean.js - Gerstner-Wellenmeer: identische Wellenphysik in JS und GLSL.
// Die Wellen werden aus demselben WAVES-Array erzeugt - in JS (seaHeight, fuer
// Bootsauftrieb/Pitch/Roll) und im Vertex-Shader (Verschiebung). Gerstner-Wellen
// verschieben die Oberflaeche auch horizontal -> schaerere Kaemme, realistische
// Wellenberge. Die Windrichtung dreht das gesamte Wellenfeld mit.
import * as THREE from "three";

const G = 9.81; // Erdbeschleunigung (Tiefwasser-Dispersionsrelation)

// Wellen: a = Amplitude (m), L = Wellenlaenge (m), off = Richtung relativ zur
// Wind-Laufrichtung (Grad), q = Gerstner-Steilheit, ph = Phase
export const WAVES = [
   { a: 1.30, L: 165, off:   0, q: 0.62, ph: 0.0 },
   { a: 0.80, L:  92, off:  21, q: 0.66, ph: 2.1 },
   { a: 0.46, L:  48, off: -28, q: 0.60, ph: 4.0 },
   { a: 0.26, L:  25, off:  39, q: 0.58, ph: 1.3 },
   { a: 0.14, L:  12, off: -55, q: 0.62, ph: 5.2 },
   { a: 0.08, L: 6.4, off:  74, q: 0.66, ph: 0.7 },
];

// ---------------------------------------------------------------------------
// Seegang aus Windstaerke
//
// Voll entwickelte See nach Pierson-Moskowitz: die signifikante Wellenhoehe
// waechst mit dem QUADRAT der Windgeschwindigkeit,
//
//     Hs = 0.21 * U^2 / g        (U in m/s)
//
// Das ist der Grund, warum aus 12 kn (knapp 1 m) bei 30 kn ueber 5 m werden.
// Gleichzeitig werden die Wellen LAENGER - eine Sturmsee ist keine vergroesserte
// Kabbelwelle, sondern langer, schwerer Seegang. Deshalb skaliert neben der
// Amplitude auch die Wellenlaenge mit dem Wind.
// ---------------------------------------------------------------------------

// Signifikante Hoehe, die sich aus der Wellentabelle bei Amplitudenfaktor 1
// ergibt: Hs = 4 * sigma, sigma^2 = Summe(a_i^2)/2
const H_PER_AMP = (() => {
   let v = 0;
   for (const w of WAVES) v += w.a * w.a;
   return 4 * Math.sqrt(v / 2);
})();

const KN_TO_MS = 0.514444;
const HS_MAX = 11.5;          // Deckel, damit aus einem Orkan kein Tsunami wird

// Signifikante Wellenhoehe in Metern
export function waveHeightForWind(kts) {
   const U = Math.max(kts, 0) * KN_TO_MS;
   return Math.min(0.21 * U * U / G, HS_MAX);
}

// Amplitudenfaktor fuer die Wellentabelle
export function ampForWind(kts) {
   return waveHeightForWind(kts) / H_PER_AMP;
}

// Streckung der Wellenlaengen. Bezugspunkt sind die Tabellenwerte bei 12 kn.
export function lambdaForWind(kts) {
   // Die Wellenlaenge waechst langsamer als die Hoehe - sonst wird die See zwar
   // hoch, aber so flach geneigt, dass sie wie eine glatte Duenung wirkt.
   // Mit der Wurzel bleibt die Steilheit erhalten: eine Sturmsee ist steil.
   const r = Math.max(kts, 1) / 12;
   return Math.min(Math.max(Math.sqrt(r), 0.55), 1.75);
}

// Weisskappen: fangen bei Bft 4 an und bedecken die See mit zunehmendem Wind.
// Genau das ist das Merkmal, an dem man eine Windstaerke erkennt.
export function whitecapsForWind(kts) {
   return Math.min(Math.max((kts - 7) / 26, 0), 1);
}

// Seezustand nach Douglas-Skala (fuer die Anzeige)
const SEA_NAMES = [
   [0.0, "spiegelglatt"], [0.1, "ruhig"], [0.5, "schwach bewegt"],
   [1.25, "leicht bewegt"], [2.5, "mäßig bewegt"], [4.0, "grob"],
   [6.0, "sehr grob"], [9.0, "hoch"], [14.0, "sehr hoch"],
];
export function seaStateName(kts) {
   const h = waveHeightForWind(kts);
   let name = SEA_NAMES[0][1];
   for (const [lim, n] of SEA_NAMES) { if (h >= lim) name = n; }
   return name;
}

// Gerstner-Summe an Flaechenparameter (px, pz), unskaliert:
// h = Hoehe, dx/dz = horizontale Verschiebung
function waveSum(px, pz, t, windRad, lambda = 1) {
   let h = 0, dx = 0, dz = 0;
   const invSqrtL = 1 / Math.sqrt(lambda);
   for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const k = (2 * Math.PI) / (w.L * lambda);
      // Tiefwasser: omega = sqrt(g*k). Gestreckte Wellen laufen langsamer.
      const om = Math.sqrt(G * ((2 * Math.PI) / w.L)) * invSqrtL;
      const ang = windRad + w.off * (Math.PI / 180);
      const dX = Math.sin(ang);
      const dZ = Math.cos(ang);
      const th = k * (dX * px + dZ * pz) - om * t + w.ph;
      const c = Math.cos(th);
      const s = Math.sin(th);
      h += w.a * s;
      dx += w.q * w.a * dX * c;
      dz += w.q * w.a * dZ * c;
   }
   return { h, dx, dz };
}

// Wasserhoehe an Weltposition (x, z). Gerstner verschiebt die Flaeche auch
// horizontal, daher wird der Flaechenparameter per Fixpunkt-Iteration
// invertiert -> das Boot sitzt exakt auf der sichtbaren Welle.
export function seaHeight(x, z, t, windRad = Math.PI, amp = 0.16, lambda = 1) {
   let px = x, pz = z;
   for (let i = 0; i < 3; i++) {
      const s = waveSum(px, pz, t, windRad, lambda);
      px = x - s.dx * amp;
      pz = z - s.dz * amp;
   }
   return waveSum(px, pz, t, windRad, lambda).h * amp;
}

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
  vec3 skyRef = mix(vec3(0.66, 0.79, 0.87), vec3(0.20, 0.44, 0.72),
                    clamp(R.y, 0.0, 1.0));

  // Wasserfarbe: Tiefblau, an Kaemmen heller + Streulicht (Licht durch die Welle)
  vec3 deep = vec3(0.004, 0.032, 0.068);
  vec3 crest = vec3(0.020, 0.170, 0.200);
  // vorzeichenbehaftet: Taeler dunkel, Kaemme hell - auf die tatsaechliche
  // Wellenhoehe bezogen, damit der Kontrast bei jeder Windstaerke sitzt.
  float hSigned = clamp(vHeight / max(uWaveH * 0.55, 0.08), -1.0, 1.0);
  float hMask = hSigned * 0.5 + 0.5;
  vec3 base = mix(deep, crest, hMask * hMask);
  float sss = pow(clamp(dot(V, -L), 0.0, 1.0), 4.0) * hMask;
  base += vec3(0.03, 0.30, 0.26) * sss;

  // Sonnen-Glitzern (Blinn-Spekular, durch Rippeln in Funken gebrochen)
  vec3 H = normalize(L + V);
  float spec = pow(clamp(dot(N, H), 0.0, 1.0), 300.0);
  float diff = clamp(dot(N, L), 0.0, 1.0);
  vec3 sunCol = vec3(1.0, 0.93, 0.78);
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
  col = mix(col, vec3(0.93, 0.96, 0.97), foamMask * 0.88);

  // Horizont-Dunst
  float fog = smoothstep(450.0, 1400.0, dist);
  col = mix(col, vec3(0.67, 0.79, 0.88), fog);

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
   };

   const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
   });

   const mesh = new THREE.Mesh(geo, mat);
   mesh.frustumCulled = false;

   let kts = 12;
   let lambda = lambdaForWind(12);
   // Phasenzeit: laengere Wellen laufen langsamer (omega ~ 1/sqrt(lambda)).
   // Damit sich das Wellenfeld beim Aendern der Wellenlaenge nicht sprunghaft
   // verschiebt, wird die Phase aufsummiert statt aus der absoluten Zeit
   // berechnet.
   let phaseT = 0;
   let lastTime = 0;
   const cell = SIZE / SEG;

   const api = {
      mesh,
      uniforms,

      // Wellenfeld um das Boot recentrieren (auf Segmentraster snapppen,
      // damit die Flaeche nahtlos "unendlich" wirkt)
      recenter(boatX, boatZ) {
         const cx = Math.round(boatX / cell) * cell;
         const cz = Math.round(boatZ / cell) * cell;
         mesh.position.set(cx, 0, cz);
         uniforms.uCenter.value.set(cx, cz);
      },

      update(time, camPos, boatX, boatZ, windKts, windRad) {
         const dt = Math.max(0, Math.min(time - lastTime, 0.25));
         lastTime = time;
         if (windKts !== undefined) kts = windKts;
         lambda = lambdaForWind(kts);
         phaseT += dt / Math.sqrt(lambda);
         uniforms.uTime.value = phaseT;
         uniforms.uAmp.value = ampForWind(kts);
         uniforms.uLambda.value = lambda;
         uniforms.uWaveH.value = waveHeightForWind(kts);
         uniforms.uWhite.value = whitecapsForWind(kts);
         if (windRad !== undefined) uniforms.uWindDir.value = windRad;
         if (camPos) uniforms.uCamPos.value.copy(camPos);
         this.recenter(boatX, boatZ);
      },

      // Phasenzeit und Streckung - damit rechnen Boot, Wrack und Geschosse
      // mit exakt derselben Wasseroberflaeche wie der Shader.
      get waveTime() { return phaseT; },
      get lambda() { return lambda; },
      get amp() { return ampForWind(kts); },
      get waveHeight() { return waveHeightForWind(kts); },

      setTime(t) {
         phaseT = t;
         lastTime = t;
         uniforms.uTime.value = t;
      },

      get windKts() {
         return kts;
      },
      set windKts(v) {
         kts = v;
         lambda = lambdaForWind(kts);
         uniforms.uAmp.value = ampForWind(kts);
         uniforms.uLambda.value = lambda;
         uniforms.uWaveH.value = waveHeightForWind(kts);
         uniforms.uWhite.value = whitecapsForWind(kts);
      },
   };

   return api;
}