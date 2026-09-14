// camera.js - camera-Regie: CHASE, COCKPIT, TOP, ORBIT
import * as THREE from "three";
import { DEG } from "./utils.js";

const MODES = ["CHASE", "COCKPIT", "TOP", "ORBIT"];

export class CameraRig {
   constructor(camera, canvas) {
      this.camera = camera;
      this.mode = "CHASE";
      // Vom gewaehlten ship gesetzt (vessels.js -> cam). valuee in metresn.
      this.rig = { dist: 15, height: 6.5, cockpitZ: -1.2, cockpitY: 2.4, lead: 8, targetY: 2.0 };
      this.azimuth = 0; // rad (relativ zur Bootskurs)
      this.elevation = 0.18;
      this.zoom = 1.0;
      this.dragging = false;
      this.shakeAmt = 0;   // Erschuetterung bei Treffern und Stoessen
      this._tmp = new THREE.Vector3();
      this._look = new THREE.Vector3();
      this._pos = new THREE.Vector3();

       // Pointer-controls (free-look / Orbit)
      canvas.addEventListener("pointerdown", (e) => {
         this.dragging = true;
         this._px = e.clientX;
         this._py = e.clientY;
      });
      window.addEventListener("pointerup", () => (this.dragging = false));
      window.addEventListener("pointermove", (e) => {
         if (!this.dragging) return;
         const dx = e.clientX - this._px;
         const dy = e.clientY - this._py;
         this._px = e.clientX;
         this._py = e.clientY;
         this.azimuth -= dx * 0.006;
         this.elevation = Math.max(-0.2, Math.min(1.3, this.elevation + dy * 0.005));
      });
      canvas.addEventListener(
         "wheel",
         (e) => {
            this.zoom = Math.max(0.4, Math.min(2.6, this.zoom - e.deltaY * 0.0011));
            e.preventDefault();
        },
        { passive: false }
       );
    }

    cycle() {
      this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
      return this.mode;
    }
    setMode(m) {
      if (MODES.includes(m)) this.mode = m;
    }
    // cameraabstaende an die ship size anpassen
    // shortr impact auf die camera (hit, mastbruch, collision)
    shake(a) { this.shakeAmt = Math.min(2.5, this.shakeAmt + a); }

    setVessel(camSpec) {
      if (camSpec) this.rig = { ...this.rig, ...camSpec };
      return this;
    }
    list() {
      return MODES;
    }

    // dt in seconds, boat: { heading (degrees), pos {x,z}, heel (degrees) }
    update(dt, boat) {
      const h = boat.heading * DEG;
      const bx = boat.pos.x;
      const bz = boat.pos.z;
      const up = boat.heel * 0.05; // leichte Neigung
      let target = this._look;
      let camPos = this._pos;

      const R = this.rig;
      const sz = R.dist / 15; // Groessenfaktor relativ zur Yacht

      if (this.mode === "CHASE") {
         const dist = R.dist * this.zoom;
         const height = R.height * this.zoom + this.elevation * 10 * sz;
         const back = h + Math.PI + this.azimuth; // hinter dem Boot
         const side = this.elevation * 0.3;
         camPos.set(
             bx + Math.sin(back) * dist * Math.cos(side) + this.azimuth * 0,
          height,
          bz + Math.cos(back) * dist
              + Math.sin(back) * dist * Math.sin(side)
         );
         target.set(
             bx + Math.sin(h) * R.lead,
          R.targetY,
          bz + Math.cos(h) * R.lead
         );
       } else if (this.mode === "COCKPIT") {
         // quarterdeck / command post: view nach vorn ueber das ship
         camPos.set(
             bx + Math.sin(h) * R.cockpitZ + this.azimuth * 3 * sz,
          R.cockpitY + this.elevation * 2 * sz,
          bz + Math.cos(h) * R.cockpitZ
              + Math.cos(h - Math.PI / 2) * this.azimuth * 3 * sz
         );
         target.set(
             bx + Math.sin(h) * 30 * sz,
          (2.0 + this.elevation * 8) * sz,
          bz + Math.cos(h) * 30 * sz
         );
       } else if (this.mode === "TOP") {
         camPos.set(
             bx + Math.sin(h + this.azimuth) * 4 * sz * this.zoom,
          35 * sz * this.zoom,
          bz + Math.cos(h + this.azimuth) * 4 * sz * this.zoom
         );
         target.set(bx, 0, bz);
       } else { // ORBIT
         const dist = R.dist * 0.95 * this.zoom;
         const a = h + Math.PI + this.azimuth;
         const r = 1 - this.elevation;
         camPos.set(
             bx + Math.sin(a) * dist * r,
          (3 + this.elevation * 28) * sz,
          bz + Math.cos(a) * dist * r
         );
         target.set(bx, 1.5 * sz, bz);
       }

       // sanftes afterfuerhren
      const k = Math.min(1, dt * (this.mode === "CHASE" ? 7 : 4));
      this.camera.position.lerp(camPos, k);
      if (this.shakeAmt > 0.001) {
         const a = this.shakeAmt * sz * 0.9;
         this.camera.position.x += (Math.random() - 0.5) * a;
         this.camera.position.y += (Math.random() - 0.5) * a;
         this.camera.position.z += (Math.random() - 0.5) * a;
         this.shakeAmt = Math.max(0, this.shakeAmt - dt * 3.2);
      }
      this.camera.lookAt(target);
      this.camera.up.set(0, 1, 0);
    }
}

export default { CameraRig };
