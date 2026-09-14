// scene.js - 3D scene setup: sky, sun, lights, clouds.
//
// Every colour here comes from the style palette (style.js) and can be
// swapped at runtime with setPalette(), so the same sky dome and lights serve
// both the modern and the aquatint look.
import * as THREE from "three";
import { palette, rgb } from "./style.js";

// Linear THREE.Color from a palette entry (hex or raw linear triple).
const lin = (c) => new THREE.Color().setRGB(...rgb(c));

export function createScene() {
   const scene = new THREE.Scene();
   scene.background = new THREE.Color(0x8fb8e0);
   scene.fog = new THREE.Fog(0xbcd6ee, 1600, 6000);

    // Sky dome (gradient)
   const skyGeo = new THREE.SphereGeometry(7000, 32, 24);
   const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
         topColor: { value: new THREE.Color(0x1f5fa8) },
         midColor: { value: new THREE.Color(0x87b8e0) },
         botColor: { value: new THREE.Color(0xd3e6f2) },
         sunDir: { value: new THREE.Vector3(0.4, 0.55, 0.6).normalize() },
         sunColor: { value: new THREE.Color(1.0, 0.94, 0.78) },
         // how far above the horizon (in the 0..1 height term) midColor
         // turns into topColor: 0.5 reaches it at the zenith
         band: { value: 0.5 },
      },
      vertexShader:
         `
            varying vec3 vDir;
            void main(){
               vDir = normalize(position);
               gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
             }
         `,
      fragmentShader:
         `
            uniform vec3 topColor; uniform vec3 midColor; uniform vec3 botColor;
            uniform vec3 sunDir; uniform vec3 sunColor; uniform float band;
            varying vec3 vDir;
            void main(){
               float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
               vec3 col = mix(botColor, midColor, smoothstep(0.0,0.55,h));
               col = mix(col, topColor, smoothstep(0.5, 0.5 + band, h));
                // sun disc
               float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 512.0);
               col = mix(col, sunColor, sun);
                // halo
               float halo = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 40.0);
               col += sunColor * halo * 0.25;
                gl_FragColor = vec4(col, 1.0);
             }
         `,
      depthWrite: false,
     });
   const sky = new THREE.Mesh(skyGeo, skyMat);
   scene.add(sky);

    // Sun (disc)
   const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
   const sun = new THREE.Mesh(new THREE.CircleGeometry(180, 32), sunMat);
   sun.position.copy(skyMat.uniforms.sunDir.value).multiplyScalar(6200);
   scene.add(sun);

    // Lights
   const sunLight = new THREE.DirectionalLight(0xfff0d2, 2.4);
   sunLight.position.copy(skyMat.uniforms.sunDir.value).multiplyScalar(500);
   sunLight.castShadow = true;
   sunLight.shadow.mapSize.set(1024, 1024);
   sunLight.shadow.camera.far = 2000;
   sunLight.shadow.camera.left = -100;
   sunLight.shadow.camera.right = 100;
   sunLight.shadow.camera.top = 100;
   sunLight.shadow.camera.bottom = -100;
   scene.add(sunLight);
   const hemi = new THREE.HemisphereLight(0x99bbff, 0x0a1a2a, 0.55);
   scene.add(hemi);
   const ambient = new THREE.AmbientLight(0x404a55, 0.35);
   scene.add(ambient);

    // Clouds (simple sprites)
   const cloudMat = new THREE.SpriteMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      fog: false,
      fogExp2: false,
     });
   const cloudTex = makeCloudTexture();
   cloudMat.map = cloudTex;
   const clouds = new THREE.Group();
   const rng = seedRng(1337);
   for (let i = 0; i < 30; i++) {
      const c = new THREE.Sprite(cloudMat.clone());
      const sc = 400 + rng() * 700;
      c.scale.set(sc, sc * 0.55, 1);
      const ang = rng() * Math.PI * 2;
      const dist = 1500 + rng() * 3500;
      c.position.set(
         Math.cos(ang) * dist,
        1200 + rng() * 700,
        Math.sin(ang) * dist
        );
      c.material.opacity = 0.4 + rng() * 0.5;
      clouds.add(c);
      }
   scene.add(clouds);

   const api = {
      scene,
      skyMat,
      sun,
      sunLight,
      hemi,
      ambient,
      clouds,
      setSunDir(deg, elevDeg) {
        const e = elevDeg * Math.PI / 180;
         const a = deg * Math.PI / 180;
         const d = new THREE.Vector3(Math.sin(a), Math.sin(e), Math.cos(a)).normalize();
        skyMat.uniforms.sunDir.value.copy(d);
        this.sun.position.copy(d).multiplyScalar(6200);
        this.sunLight.position.copy(d).multiplyScalar(500);
      },
      /** Re-tint sky, fog, lights and clouds from a style's world palette. */
      setPalette(w) {
         scene.background.copy(lin(w.background));
         scene.fog.color.copy(lin(w.fog));
         scene.fog.near = w.fogNear;
         scene.fog.far = w.fogFar;
         skyMat.uniforms.topColor.value.copy(lin(w.skyTop));
         skyMat.uniforms.midColor.value.copy(lin(w.skyMid));
         skyMat.uniforms.botColor.value.copy(lin(w.skyBot));
         skyMat.uniforms.sunColor.value.copy(lin(w.skySun));
         skyMat.uniforms.band.value = w.skyBand;
         sunMat.color.copy(lin(w.sunDisc));
         sunLight.color.copy(lin(w.sunLight));
         sunLight.intensity = w.sunIntensity;
         hemi.color.copy(lin(w.hemiSky));
         hemi.groundColor.copy(lin(w.hemiGround));
         hemi.intensity = w.hemiIntensity;
         ambient.color.copy(lin(w.ambient));
         ambient.intensity = w.ambientIntensity;
         for (const c of clouds.children) c.material.color.copy(lin(w.cloud));
      },
      add(obj) {
        this.scene.add(obj);
       },
      remove(obj) {
        this.scene.remove(obj);
       },
    };
   api.setPalette(palette().world);
   return api;
}

function makeCloudTexture() {
   const c = document.createElement("canvas");
   c.width = c.height = 128;
   const ctx = c.getContext("2d");
   for (let i = 0; i < 18; i++) {
      const x = 30 + Math.random() * 68;
      const y = 30 + Math.random() * 68;
      const r = 10 + Math.random() * 28;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.9)");
      g.addColorStop(0.5, "rgba(255,255,255,0.4)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
     }
   const tex = new THREE.CanvasTexture(c);
   tex.needsUpdate = true;
   return tex;
}

function seedRng(seed) {
   let s = seed || 1;
   return function () {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
     };
}
