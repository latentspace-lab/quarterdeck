// puffs.js - the painted effects of the aquatint style: powder smoke, spray,
// burning smoke, flames and the cloud masses, all drawn by ONE instanced
// billboard field with one draw call.
//
// Every puff is a quad whose fragment shader paints what the colourist
// painted: a cumulus of a few lobes with a lit top, a grey-mauve underside
// and an ink contour (smoke, spray, clouds), or an opaque tongue of flame
// (cream core, orange, oxblood edge). Powder smoke near the guns is lit
// apricot from below by the flash while it is young.
//
// The field is owned by the Simulator and reached through `puffField()` by
// the modules that emit (guns, debris, warship). Without a field - plain
// style, Node tests - the emitters fall back to their old sprites.
import * as THREE from "three";
import { palette, rgb } from "./style.js";

let _field = null;
/** The active field, or null (plain style, no DOM). */
export function puffField() { return _field; }
/** Install (or remove with null) the field the emitters draw into. */
export function setPuffField(f) { _field = f; return f; }

/** Hash / value-noise / fbm helpers shared with the sea shader. */
export const NOISE_GLSL = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
   vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
   return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

export const KIND = { SMOKE: 0, BURN: 1, FLAME: 2, CLOUD: 3 };

const VERT = `
attribute vec3 aPos; attribute vec2 aSize; attribute float aSeed; attribute float aAlpha; attribute float aGlow; attribute float aKind; attribute float aRot;
varying vec2 vUv; varying float vSeed, vAlpha, vGlow, vKind, vDist;
void main() {
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec2 q = position.xy; float c = cos(aRot), s = sin(aRot);
  q = vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  vec3 wp = aPos + right * q.x * aSize.x + up * q.y * aSize.y;
  vUv = position.xy * 2.0; vSeed = aSeed; vAlpha = aAlpha; vGlow = aGlow; vKind = aKind;
  vec4 mv = viewMatrix * vec4(wp, 1.0); vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = `
precision highp float;
${NOISE_GLSL}
uniform vec2 uLight2; uniform float uTime; uniform vec3 uFogCol; uniform vec2 uFogRange;
uniform vec3 uLit[4]; uniform vec3 uShade[4]; uniform vec3 uGlowCol; uniform vec3 uInk;
uniform vec3 uFlameCore, uFlameMid, uFlameEdge;
varying vec2 vUv; varying float vSeed, vAlpha, vGlow, vKind, vDist;

// A cumulus of five lobes, roughened by noise: signed distance, negative inside.
float cloudSdf(vec2 p, float seed) {
   float d = 1e3;
   for (int i = 0; i < 5; i++) {
      float fi = float(i);
      vec2 c = (vec2(hash12(vec2(seed, fi)), hash12(vec2(fi, seed + 3.0))) - 0.5) * 0.9;
      c.y *= 0.7;
      float r = 0.32 + 0.22 * hash12(vec2(seed + 7.0, fi));
      d = min(d, length(p - c) - r);
   }
   d += (fbm(p * 2.6 + seed * 13.0) - 0.5) * 0.30;
   return d;
}

void main() {
  int k = int(vKind + 0.5);
  vec3 col; float alpha;
  if (k == 2) {
     // flame: a tongue, wider below, licking upward with scrolling noise
     vec2 q = vUv; q.x *= 1.35;
     float n = fbm(vec2(q.x * 2.2 + vSeed * 9.0, q.y * 1.6 - uTime * 2.2 + vSeed * 5.0));
     float body = 1.0 - length(vec2(q.x, q.y > 0.0 ? q.y * 0.85 : q.y * 1.3));
     float f = body + (n - 0.5) * 0.7 - 0.15;
     alpha = smoothstep(0.30, 0.42, f);
     col = mix(uFlameEdge, uFlameMid, smoothstep(0.32, 0.60, f));
     col = mix(col, uFlameCore, smoothstep(0.62, 0.95, f));
     col = mix(col, uInk, smoothstep(0.42, 0.30, f) * 0.5 * alpha);
  } else {
     float d = cloudSdf(vUv, vSeed);
     float soft = (k == 3) ? 0.30 : 0.0;   // sky clouds are washes, not puffs
     alpha = 1.0 - smoothstep(-0.10 - soft, 0.05 + soft * 0.4, d);
     float e = 0.06;
     vec2 g = vec2(cloudSdf(vUv + vec2(e, 0.0), vSeed) - d, cloudSdf(vUv + vec2(0.0, e), vSeed) - d) / e;
     vec3 n = normalize(vec3(-g * 0.9, 0.9));
     float light = clamp(dot(n, normalize(vec3(uLight2, 0.8))), 0.0, 1.0);
     // the underside is always in shadow, the top always lit
     light = clamp(light * 0.7 + (vUv.y * 0.5 + 0.5) * 0.45, 0.0, 1.0);
     col = mix(uShade[k], uLit[k], light);
     // powder smoke near the guns is lit apricot from below by the flash
     col = mix(col, uGlowCol, vGlow * (1.0 - light) * 0.9);
     // ink at the edge, as the etched contour of the cloud
     float rim = smoothstep(-0.16, -0.02, d) * alpha;
     col = mix(col, uInk, rim * ((k == 3) ? 0.06 : 0.22));
  }
  float fog = smoothstep(uFogRange.x, uFogRange.y, vDist);
  col = mix(col, uFogCol, fog);
  gl_FragColor = vec4(col, alpha * vAlpha);
}`;

const lin = (c) => new THREE.Color().setRGB(...rgb(c));

export class PuffField {
   constructor(cap = 900) {
      this.cap = cap;
      this.items = [];
      const base = new THREE.PlaneGeometry(1, 1);
      const geo = new THREE.InstancedBufferGeometry();
      geo.index = base.index;
      geo.setAttribute("position", base.attributes.position);
      geo.setAttribute("uv", base.attributes.uv);
      const mk = (n, size) => {
         const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
         a.setUsage(THREE.DynamicDrawUsage);
         geo.setAttribute(n, a);
         return a;
      };
      this.aPos = mk("aPos", 3); this.aSize = mk("aSize", 2); this.aSeed = mk("aSeed", 1);
      this.aAlpha = mk("aAlpha", 1); this.aGlow = mk("aGlow", 1); this.aKind = mk("aKind", 1); this.aRot = mk("aRot", 1);
      this.uniforms = {
         uLight2: { value: new THREE.Vector2(-0.6, 0.6) }, uTime: { value: 0 },
         uFogCol: { value: new THREE.Color() }, uFogRange: { value: new THREE.Vector2(1000, 4000) },
         uLit: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
         uShade: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color(), new THREE.Color()] },
         uGlowCol: { value: new THREE.Color() }, uInk: { value: new THREE.Color() },
         uFlameCore: { value: new THREE.Color() }, uFlameMid: { value: new THREE.Color() }, uFlameEdge: { value: new THREE.Color() },
      };
      const mat = new THREE.ShaderMaterial({
         uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 10;
      this.geo = geo;
      this.glowK = 1;
      this._wind = new THREE.Vector3();
      this._tmp = new THREE.Vector3();
      this.setPalette(palette().world);
   }

   /** Colours from a style's world palette (see style.js). */
   setPalette(w) {
      const p = w.puffs;
      if (!p) return;
      const u = this.uniforms;
      u.uFogCol.value.copy(lin(w.fog));
      u.uFogRange.value.set(w.fogNear, w.fogFar);
      u.uLit.value[0].copy(lin(p.smokeLit)); u.uShade.value[0].copy(lin(p.smokeShade));
      u.uLit.value[1].copy(lin(p.burnLit)); u.uShade.value[1].copy(lin(p.burnShade));
      u.uLit.value[2].set(1, 1, 1); u.uShade.value[2].set(1, 1, 1);
      u.uLit.value[3].copy(lin(p.cloudLit)); u.uShade.value[3].copy(lin(p.cloudShade));
      u.uGlowCol.value.copy(lin(p.glow)); u.uInk.value.copy(lin(p.ink));
      u.uFlameCore.value.copy(lin(p.flameCore)); u.uFlameMid.value.copy(lin(p.flameMid)); u.uFlameEdge.value.copy(lin(p.flameEdge));
      this.glowK = p.glowK ?? 1;
   }

   add(p) {
      if (this.items.length >= this.cap) return null;
      this.items.push(p);
      return p;
   }
   remove(p) {
      const i = this.items.indexOf(p);
      if (i >= 0) this.items.splice(i, 1);
   }
   /** Drop every puff, or only those of one kind. */
   clear(kind) {
      if (kind === undefined) this.items.length = 0;
      else this.items = this.items.filter((p) => p.kind !== kind);
   }

   /**
    * Advance and upload. `wind` is the drift in m/s (world x/z), `camera`
    * sorts and `sunDir` (world, normalised) lights the lobes.
    */
   update(dt, wind, camera, sunDir) {
      this.uniforms.uTime.value += dt;
      const items = this.items;
      for (let i = items.length - 1; i >= 0; i--) {
         const p = items[i];
         p.life += dt;
         if (p.update) p.update(p, dt, wind, this);
         if (p.life > p.max) items.splice(i, 1);
      }
      const cp = camera.position;
      for (const p of items) p._d = p.pos.distanceToSquared(cp);
      items.sort((a, b) => b._d - a._d);
      for (let i = 0; i < items.length; i++) {
         const p = items[i];
         this.aPos.setXYZ(i, p.pos.x, p.pos.y, p.pos.z);
         this.aSize.setXY(i, p.w, p.h); this.aSeed.setX(i, p.seed); this.aAlpha.setX(i, p.alpha);
         this.aGlow.setX(i, p.glow || 0); this.aKind.setX(i, p.kind); this.aRot.setX(i, p.rot || 0);
      }
      for (const a of [this.aPos, this.aSize, this.aSeed, this.aAlpha, this.aGlow, this.aKind, this.aRot]) a.needsUpdate = true;
      this.geo.instanceCount = items.length;
      if (sunDir) {
         const right = this._tmp.setFromMatrixColumn(camera.matrixWorld, 0);
         const lx = sunDir.dot(right);
         const up = this._tmp.setFromMatrixColumn(camera.matrixWorld, 1);
         this.uniforms.uLight2.value.set(lx, sunDir.dot(up));
      }
   }

   dispose() {
      this.geo.dispose();
      this.mesh.material.dispose();
      this.items.length = 0;
   }
}

// ------------------------------------------------------------- emitters

function smokeUpdate(p, dt, wind) {
   const u = p.life / p.max;
   p.vel.multiplyScalar(1 - Math.min(dt * 1.4, 0.9));
   p.pos.addScaledVector(p.vel, dt);
   p.pos.x += wind.x * dt * 0.8; p.pos.z += wind.z * dt * 0.8; p.pos.y += dt * (0.35 + p.rise);
   const sc = p.s0 + p.grow * (1 - Math.exp(-p.life / 2.6));
   p.w = sc; p.h = sc * 0.85;
   p.alpha = p.peak * Math.min(1, u * 9) * Math.pow(1 - u, 1.2);
   p.glow = Math.max(0, p.glow0 - p.life * 0.6);
}

/** Powder smoke at a muzzle: six puffs that bloom outboard and drift to leeward. */
export function muzzleSmoke(field, world, out) {
   for (let k = 0; k < 6; k++) {
      const s0 = 3.0 + Math.random() * 2.4;
      const pos = world.clone().addScaledVector(out, 1.2 + k * 1.6 + Math.random())
         .add(new THREE.Vector3((Math.random() - 0.5) * 1.5, (Math.random() - 0.3) * 1.2, (Math.random() - 0.5) * 1.5));
      field.add({
         kind: KIND.SMOKE, pos,
         vel: out.clone().multiplyScalar(6.5 - k * 0.9).add(new THREE.Vector3(0, 0.8 + Math.random() * 0.6, 0)),
         s0, grow: 7 + Math.random() * 6, rise: 0, life: 0, max: 9 + Math.random() * 6, peak: 0.92 - k * 0.05,
         seed: Math.random() * 100, rot: (Math.random() - 0.5) * 0.6, glow0: (0.95 - k * 0.1) * field.glowK,
         w: s0, h: s0, alpha: 0, update: smokeUpdate,
      });
   }
}

/** Brown-grey smoke off a fire. */
export function burnSmoke(field, world) {
   const s0 = 1.6 + Math.random() * 1.4;
   field.add({
      kind: KIND.BURN, pos: world.clone(),
      vel: new THREE.Vector3((Math.random() - 0.5) * 0.6, 1.6 + Math.random(), (Math.random() - 0.5) * 0.6),
      s0, grow: 9 + Math.random() * 6, rise: 0.9, life: 0, max: 10 + Math.random() * 5, peak: 0.8,
      seed: Math.random() * 100, rot: Math.random() - 0.5, glow0: 0.5, w: s0, h: s0, alpha: 0, update: smokeUpdate,
   });
}

/**
 * A flame anchored to a point `local` in `follow`'s space; it pulses and
 * streams burning smoke while it lives. Remove with field.remove().
 */
export function flame(field, follow, local, base) {
   return field.add({
    kind: KIND.FLAME, pos: new THREE.Vector3(), follow, local, base, life: 0, max: Infinity,
      seed: Math.random() * 100, w: base, h: base * 1.8, alpha: 0.95, smokeIn: Math.random() * 0.3,
      update: (p, dt, wind, f) => {
         const t = p.life;
         const pul = 1 + 0.25 * Math.sin(t * 6.3 + p.seed) + 0.12 * Math.sin(t * 13.1 + p.seed * 2.0);
         p.w = p.base * pul;
         p.h = p.base * 1.9 * (1 + 0.3 * Math.sin(t * 4.7 + p.seed));
         p.pos.copy(p.local).applyMatrix4(p.follow.matrixWorld);
         p.pos.y += p.h * 0.35;
         p.smokeIn -= dt;
         if (p.smokeIn <= 0) {
            p.smokeIn = 0.35 + Math.random() * 0.2;
            burnSmoke(f, p.pos.clone().add(new THREE.Vector3(0, p.base * 0.8, 0)));
         }
      },
   });
}

/** A column of spray where a ball (or a spar) strikes the water. */
export function splash(field, x, y, z, size) {
   field.add({
      kind: KIND.SMOKE, pos: new THREE.Vector3(x, y + size * 0.3, z), y0: y, size, life: 0, max: 1.5 + Math.random() * 0.4,
      seed: Math.random() * 100, w: size * 0.35, h: size, alpha: 0.7, rot: (Math.random() - 0.5) * 0.3, glow: 0,
      update: (p) => {
         const u = p.life / p.max;
         const sc = p.size * (1 + u * 1.1);
         // a narrow column of spray that shoots up, spreads and falls back
         p.w = sc * (0.30 + u * 0.25); p.h = sc * 1.5;
         p.pos.y = p.y0 + Math.sin(Math.min(u, 0.55) * Math.PI) * p.size * 1.3;
         p.alpha = 0.72 * Math.pow(1 - u, 1.4);
      },
   });
}

/** The cloud masses on the horizon: static, seeded, cleared with KIND.CLOUD. */
export function cloudBank(field, n = 12, seed = 3) {
   let s = seed;
   const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
   for (let i = 0; i < n; i++) {
      const ang = rnd() * Math.PI * 2, dist = 1600 + rnd() * 1800;
      const w = 500 + rnd() * 900;
      field.add({
         kind: KIND.CLOUD, pos: new THREE.Vector3(Math.cos(ang) * dist, 500 + rnd() * 500, Math.sin(ang) * dist),
         w, h: w * (0.35 + rnd() * 0.25), seed: rnd() * 100, alpha: 0.85, rot: 0, life: 0, max: Infinity,
      });
   }
}
