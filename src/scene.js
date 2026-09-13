// scene.js - 3D-Szene-Setup: Himmel, Sonne, Lichter, Wolken
import * as THREE from "three";

export function createScene() {
   const scene = new THREE.Scene();
   scene.background = new THREE.Color(0x8fb8e0);
   scene.fog = new THREE.Fog(0xbcd6ee, 1600, 6000);

    // Himmel-Kuppel (Gradient)
   const skyGeo = new THREE.SphereGeometry(7000, 32, 24);
   const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
         topColor: { value: new THREE.Color(0x1f5fa8) },
         midColor: { value: new THREE.Color(0x87b8e0) },
         botColor: { value: new THREE.Color(0xd3e6f2) },
         sunDir: { value: new THREE.Vector3(0.4, 0.55, 0.6).normalize() },
         sunColor: { value: new THREE.Color(1.0, 0.94, 0.78) },
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
            uniform vec3 sunDir; uniform vec3 sunColor;
            varying vec3 vDir;
            void main(){
               float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
               vec3 col = mix(botColor, midColor, smoothstep(0.0,0.55,h));
               col = mix(col, topColor, smoothstep(0.5,1.0,h));
                // Sonnen-Scheibe
               float sun = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 512.0);
               col = mix(col, sunColor, sun);
                // Halo
               float halo = pow(max(dot(normalize(vDir), normalize(sunDir)), 0.0), 40.0);
               col += sunColor * halo * 0.25;
                gl_FragColor = vec4(col, 1.0);
             }
         `,
      depthWrite: false,
     });
   const sky = new THREE.Mesh(skyGeo, skyMat);
   scene.add(sky);

    // Sonne (Sprite / Scheibe)
   const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4d6 });
   const sun = new THREE.Mesh(new THREE.CircleGeometry(180, 32), sunMat);
   sun.position.copy(skyMat.uniforms.sunDir.value).multiplyScalar(6200);
   scene.add(sun);

    // Lichter
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
   scene.add(new THREE.HemisphereLight(0x99bbff, 0x0a1a2a, 0.55));
   scene.add(new THREE.AmbientLight(0x404a55, 0.35));

    // Wolken (einfache Sprites)
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
      clouds,
      setSunDir(deg, elevDeg) {
        const e = elevDeg * Math.PI / 180;
         const a = deg * Math.PI / 180;
         const d = new THREE.Vector3(Math.sin(a), Math.sin(e), Math.cos(a)).normalize();
        skyMat.uniforms.sunDir.value.copy(d);
        this.sun.position.copy(d).multiplyScalar(6200);
        this.sunLight.position.copy(d).multiplyScalar(500);
      },
      add(obj) {
        this.scene.add(obj);
       },
      remove(obj) {
        this.scene.remove(obj);
       },
    };
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
