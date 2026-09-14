// marks.js - the regatta course: buoys and lines in the scene, and the race
// judged by the shared course tracker (@segel/shared/course), which is what
// the server runs in a regatta room. wind from the north: +Z is upwind.
import * as THREE from "three";
import { courseLayout, newRace, raceStep, SIM_DT } from "@segel/shared";

// ---------- mark (Floater / Komitee) ----------
export function makeBuoy(color, type = "float") {
   const g = new THREE.Group();
   const bodyMat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      emissive: new THREE.Color(color).multiplyScalar(0.2),
   });
   if (type === "committee") {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 3.2, 12), bodyMat);
      body.position.y = 1.6;
      g.add(body);
      const light = new THREE.Mesh(
          new THREE.SphereGeometry(0.45, 10, 10),
          new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x666666, emissiveIntensity: 0.6 })
          );
      light.position.y = 3.4;
      g.add(light);
      return g;
   }
   const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.2, 12), bodyMat);
   body.position.y = 0.6;
   g.add(body);
   const top = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.3, 12), bodyMat);
   top.position.y = 1.9;
   g.add(top);
   const light = new THREE.Mesh(
       new THREE.SphereGeometry(0.25, 8, 8),
       new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: 0.9 })
        );
   light.position.y = 2.8;
   g.add(light);
   return g;
}

// Start-/targetlinie zwischen zwei markn
function makeLine(a, b, color, y = 0.1) {
   const dx = b.x - a.x;
   const dz = b.z - a.z;
   const len = Math.hypot(dx, dz);
   const geo = new THREE.CylinderGeometry(0.07, 0.07, len, 6);
   const ang = -Math.atan2(dx, dz);
   geo.rotateZ(Math.PI / 2);
   geo.rotateY(ang);
   const mesh = new THREE.Mesh(
       geo,
       new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.3), roughness: 0.5 })
        );
   mesh.position.set((a.x + b.x) / 2, y, (a.z + b.z) / 2);
   return mesh;
}

export class Course {
   constructor(scene, origin = { x: 0, z: 0 }) {
      this.scene = scene;
      this.origin = origin;
      this.root = new THREE.Group();
      scene.add(this.root);
      this.layout = courseLayout(origin);
      // Kept as properties: the HUD and older callers read them.
      this.committee = this.layout.committee;
      this.pin = this.layout.pin;
      this.lineZ = this.layout.lineZ;
      this.halfWidth = this.layout.halfWidth;
      this.windward = this.layout.windward;
      this.leeward = this.layout.leeward;
      this.legs = this.layout.legs;
      this._build();
      this.reset(0);
   }

   _build() {
      const cb = makeBuoy(0x222222, "committee");
      cb.position.set(this.committee.x, 0, this.committee.z);
      this.root.add(cb);
      const pb = makeBuoy(0x2b6cb0, "turn");
      pb.position.set(this.pin.x, 0, this.pin.z);
      this.root.add(pb);
      const ww = makeBuoy(0xd23b3b, "turn");
      ww.position.set(this.windward.x, 0, this.windward.z);
      this.root.add(ww);
      const ll = makeBuoy(0x2ecc40, "turn");
      ll.position.set(this.leeward.x, 0, this.leeward.z);
      this.root.add(ll);
      this.root.add(makeLine(this.committee, this.pin, 0xffe680, 0.12));
      this.root.add(makeLine(this.committee, this.pin, 0xf2f2f2, 0.5));
   }

   /** Move the buoys to another origin (a server room's course). */
   moveTo(origin) {
      this.origin = { x: origin.x, z: origin.z };
      this.layout = courseLayout(this.origin);
      this.committee = this.layout.committee;
      this.pin = this.layout.pin;
      this.lineZ = this.layout.lineZ;
      this.halfWidth = this.layout.halfWidth;
      this.windward = this.layout.windward;
      this.leeward = this.layout.leeward;
      this.legs = this.layout.legs;
      for (const c of [...this.root.children]) this.root.remove(c);
      this._build();
      return this;
   }

   // markn und Linien show/hide (im Freeride/Training stoeren sie)
   setVisible(v) {
      this.root.visible = !!v;
      return this;
   }

   /** Start a new race at simulation time t. */
   reset(t = 0) {
      this.race = newRace(this.layout, t, { x: this.origin.x, z: this.origin.z - 1 });
      this.message = "";
      this.messageT = 0;
      this.lapTimeLast = 0;
      return this;
   }

   get leg() { return this.race.leg; }
   get lap() { return this.race.lap; }
   get best() { return this.race.best; }
   get progress() { return this.race.progress; }

   /**
    * One simulation step. `t` is simulation time - the same clock the server
    * judges with in a regatta room. Returns what the HUD shows.
    */
   update(boatPos, t) {
      const s = raceStep(this.layout, this.race, boatPos, t);
      if (s.advanced) {
         this.message = s.message;
         this.messageT = 3.2;
         if (s.lapDone) this.lapTimeLast = s.lapTime;
      } else if (this.messageT > 0) {
         this.messageT -= SIM_DT;
         if (this.messageT <= 0) this.message = "";
      } else {
         this.message = "";
      }
      return {
         next: s.next,
         dist: s.dist,
         bearing: s.bearing,
         leg: s.leg,
         legType: s.legType,
         legName: s.legName,
         lap: this.race.lap,
         best: this.race.best,
         time: s.time,
         progress: this.race.progress,
         message: s.message || this.message,
         justPassed: s.passed,
      };
   }
}

export default { Course, makeBuoy };
