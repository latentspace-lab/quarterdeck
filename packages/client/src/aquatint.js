// aquatint.js - the screen-space pass that turns the rendered scene into a
// hand-coloured aquatint.
//
// The scene is rendered into an off-screen target with a depth texture, then
// one full-screen shader does what the printing process did:
//   1. the etched line   - ink outlines where the depth breaks (masts, hulls,
//                          rigging, nearby wave crests against the sky),
//   2. the tonal plate   - colour desaturated and pulled onto an ink -> wash
//                          -> paper ramp, so nothing is pure black or white,
//   3. the bitten tone   - the full range of the plate (an S-curve: deep ink
//                          in the troughs, paper in the sails) laid down in
//                          faint steps, as the acid bit the plate in stages,
//   4. (optional) grain  - a fixed screen-space rosin grain, off by default:
//                          at screen scale the prints read as smooth washes,
//   5. the plate tone    - a mild vignette.
//
// The plain style never comes through here; game.js renders straight to the
// canvas in that case, so the old look stays exactly as it was.
import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const VERT = `
varying vec2 vUv;
void main() {
   vUv = uv;
   gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = `
precision highp float;
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform vec2 uResolution;
uniform float uNear;
uniform float uFar;
uniform float uStrength;   // 0 = untouched scene, 1 = full print
uniform float uEdge;       // ink line strength
uniform float uGrain;      // rosin grain amplitude
uniform float uVignette;
uniform float uChroma;     // share of the colour's saturation that survives
uniform float uTone;       // weight of the ink/paper ramp against the colour
uniform float uCurve;      // how much of the S-curve (contrast) is applied
uniform float uSteps;      // number of tonal steps of the bitten plate
uniform float uStepMix;    // how much the steps show
uniform vec3 uInk;         // display-space colours
uniform vec3 uShadow;
uniform vec3 uPaper;
varying vec2 vUv;

// Distance along the view axis from a depth-buffer value.
float viewDist(vec2 uv) {
   float z = texture2D(tDepth, uv).x;
   float ndc = z * 2.0 - 1.0;
   return (2.0 * uNear * uFar) / (uFar + uNear - ndc * (uFar - uNear));
}

float hash(vec2 p) {
   p = fract(p * vec2(123.34, 456.21));
   p += dot(p, p + 45.32);
   return fract(p.x * p.y);
}

vec3 toDisplay(vec3 c) { return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2)); }

void main() {
   vec3 c = toDisplay(texture2D(tDiffuse, vUv).rgb);

   // 1. The etched line. Compare each pixel's distance with its four
   //    neighbours, relative to the nearer of the two, so a one-pixel-wide
   //    stay gets its line and a gentle wave slope does not. Lines fade with
   //    distance: an engraver does not outline the far horizon.
   vec2 px = 1.0 / uResolution;
   float d0 = viewDist(vUv);
   float dl = viewDist(vUv - vec2(px.x, 0.0));
   float dr = viewDist(vUv + vec2(px.x, 0.0));
   float dd = viewDist(vUv - vec2(0.0, px.y));
   float du = viewDist(vUv + vec2(0.0, px.y));
   float nearD = min(d0, min(min(dl, dr), min(dd, du)));
   float jump = max(max(abs(dr - d0), abs(dl - d0)), max(abs(du - d0), abs(dd - d0)));
   float grad = jump / max(nearD, 1.0);
   float edge = smoothstep(0.05, 0.18, grad) * (1.0 - smoothstep(250.0, 600.0, nearD)) * uEdge;

   // 2. The tonal plate: lose a third of the chroma, then pull the value
   //    onto ink -> wash -> paper and blend that with the washed colour.
   //    The hand-colouring must survive: the sea stays green, the ensign red.
   float lum = dot(c, vec3(0.299, 0.587, 0.114));
   // The plate has a full range: an S-curve pulls the troughs toward the
   // ink and the sails toward the paper, then the tone comes in steps.
   float lumC = mix(lum, lum * lum * (3.0 - 2.0 * lum), uCurve);
   float lumQ = floor(lumC * uSteps + 0.5) / uSteps;
   lumC = mix(lumC, lumQ, uStepMix);
   c *= (lumC + 0.02) / (lum + 0.02);
   lum = lumC;
   vec3 wash = mix(vec3(lum), c, uChroma);
   vec3 tone = lum < 0.5
      ? mix(uInk, uShadow, lum * 2.0)
      : mix(uShadow, uPaper, (lum - 0.5) * 2.0);
   vec3 art = mix(wash, tone, uTone);
   art = mix(art, uInk, edge * 0.85);

   // 3. Grain, optional and off by default: at screen scale the prints read
   //    as smooth washes, the rosin grain only shows under a glass.
   if (uGrain > 0.0) {
      float g = hash(floor(gl_FragCoord.xy / 1.5)) - 0.5;
      art *= 1.0 + g * uGrain * (1.0 - lum);
   }

   // 4. Plate tone. The paper is the brightest thing on the sheet.
   vec2 q = vUv - 0.5;
   art *= 1.0 - dot(q, q) * uVignette;
   art = min(art, uPaper * 1.03);

   gl_FragColor = vec4(mix(c, art, uStrength), 1.0);
}
`;

/** Display-space vec3 from an sRGB hex number (no linearisation). */
function display(hex) {
   return new THREE.Vector3(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
}

/**
 * Build the pass. `render()` draws scene + camera through the aquatint
 * shader onto the canvas; `setSize()` follows the window; `dispose()` frees
 * the target. Tunables live on `uniforms`.
 */
export function createAquatint(renderer, scene, camera, opts = {}) {
   const pr = renderer.getPixelRatio();
   const size = renderer.getSize(new THREE.Vector2());
   let w = Math.max(1, Math.floor(size.width * pr));
   let h = Math.max(1, Math.floor(size.height * pr));

   const makeTarget = (samples) => {
      const depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
      const rt = new THREE.WebGLRenderTarget(w, h, {
         type: THREE.HalfFloatType,
         samples,
         depthTexture,
      });
      rt.texture.name = "aquatint.scene";
      return rt;
   };
   // Multisampling keeps the rigging from sparkling; the depth attachment
   // is resolved along with the colour (three r158+).
   let target = makeTarget(opts.samples ?? 4);

   const uniforms = {
      tDiffuse: { value: target.texture },
      tDepth: { value: target.depthTexture },
      uResolution: { value: new THREE.Vector2(w, h) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uStrength: { value: opts.strength ?? 1.0 },
      uEdge: { value: opts.edge ?? 1.0 },
      uGrain: { value: opts.grain ?? 0.0 },
      uVignette: { value: opts.vignette ?? 0.36 },
      uChroma: { value: opts.chroma ?? 0.85 },
      uTone: { value: opts.tone ?? 0.28 },
      uCurve: { value: opts.curve ?? 0.55 },
      uSteps: { value: opts.steps ?? 18.0 },
      uStepMix: { value: opts.stepMix ?? 0.18 },
      uInk: { value: display(opts.ink ?? 0x1a1d1c) },
      uShadow: { value: display(opts.shadow ?? 0x55544a) },
      uPaper: { value: display(opts.paper ?? 0xf1ebdb) },
   };
   const material = new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false,
   });
   const quad = new FullScreenQuad(material);

   return {
      uniforms,
      get target() { return target; },
      render() {
         renderer.setRenderTarget(target);
         renderer.render(scene, camera);
         renderer.setRenderTarget(null);
         uniforms.tDiffuse.value = target.texture;
         uniforms.tDepth.value = target.depthTexture;
         uniforms.uNear.value = camera.near;
         uniforms.uFar.value = camera.far;
         quad.render(renderer);
      },
      setSize(width, height) {
         const ratio = renderer.getPixelRatio();
         w = Math.max(1, Math.floor(width * ratio));
         h = Math.max(1, Math.floor(height * ratio));
         target.setSize(w, h);
         uniforms.uResolution.value.set(w, h);
      },
      dispose() {
         target.dispose();
         material.dispose();
         quad.dispose();
      },
   };
}
