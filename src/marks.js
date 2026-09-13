// marks.js - Regatta-Kurs (Windward-Leeward) + Bojen + Runden-Logik
// Wind aus dem Nord (+Z ist Luv). Kurs: Startlinie → Windward → Leeward → Ziellinie.
import * as THREE from "three";
import { normDeg, diffDeg } from "./utils.js";

// ---------- Boje (Floater / Komitee) ----------
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

// Start-/Ziellinie zwischen zwei Bojen
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

       // Start-/Ziellinie (Ost/West, 90 m breit)
      this.committee = { x: origin.x + 45, z: origin.z };
      this.pin = { x: origin.x - 45, z: origin.z };
      this.lineZ = origin.z;
      this.halfWidth = 45;

       // Wendebojen
      this.windward = { x: origin.x, z: origin.z + 850, radius: 18 };
      this.leeward = { x: origin.x + 30, z: origin.z - 800, radius: 18 };

       // Legs: 0 Startlinie · 1 Windward · 2 Leeward · 3 Ziellinie
      this.legs = [
           { type: "start", name: "Startlinie" },
           { type: "turn", ref: this.windward, name: "Windward-Wendeboje" },
           { type: "turn", ref: this.leeward, name: "Leeward-Wendeboje" },
           { type: "finish", name: "Ziellinie" },
        ];

      this._build();
      this.reset();
     }

     _build() {
      const O = this.origin;
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
      // Weg-Indikator-Marker (kleine Bojen auf den Beinen)
      this._guideMarkers = [];
     }

    // Bojen und Linien aus- bzw. einblenden (im Freeride/Training stoeren sie)
    setVisible(v) {
      this.root.visible = !!v;
      return this;
    }

    reset() {
      this.leg = 0;
      this.prevZ = this.origin.z;
      this.lapStart = performance.now();
      this.best = null;
      this.lap = 0;
      this.progress = 0;
      this.messageT = 0;
      this.message = "";
      this.dist = 0;
      this.bearing = 0;
      this.nextRef = null;
      this.legName = this.legs[0].name;
      this.justPassed = null;
      this.nextTarget = { x: this.origin.x, z: this.lineZ, radius: 0 };
    }

    // Ueberquero der Linie (z = lineZ) in norder Richtung
    _crossedLineN(boatPos) {
      return (
             boatPos.z > this.lineZ &&
          this.prevZ <= this.lineZ &&
         Math.abs(boatPos.x - this.origin.x) <= this.halfWidth + 6
          );
      }

    _distTarget(boatPos) {
      const t = this.nextTarget;
      return Math.hypot(t.x - boatPos.x, t.z - boatPos.z);
    }

    update(boatPos) {
      const now = performance.now();
      const leg = this.legs[this.leg];
              // Fortsetzung: Ueberquero / Abstand

      let advanced = false;
      let msg = "";

      if (leg.type === "start") {
          if (this._crossedLineN(boatPos)) {
            this.leg = 1;
             this.progress = 0;
             this.nextTarget = { x: this.windward.x, z: this.windward.z, radius: this.windward.radius };
             this.legName = this.legs[1].name;
             this.lapStart = now;
             msg = "Abfahrt — Runde " + this.lap + " gestartet!";
             advanced = true;
            }
          this.nextTarget = { x: this.origin.x, z: this.lineZ, radius: 0 };
        } else if (leg.type === "finish") {
          if (this._crossedLineN(boatPos)) {
            this._completeLap(now);
            advanced = true;
             return this._result("🏁 Runde " + this.lap + " in " + this._lapTime + " s");
           }
          this.nextTarget = { x: this.origin.x, z: this.lineZ, radius: 0 };
        } else if (leg.type === "turn") {
          this.nextTarget = { x: leg.ref.x, z: leg.ref.z, radius: leg.ref.radius };
           if (this._distToRef(boatPos, leg.ref) < leg.ref.radius) {
            msg = leg.name + " passiert!";
             this.leg = (this.leg + 1) % this.legs.length;
             this.progress = 0;
             this.progress = this.leg / this.legs.length;
             this.legName = this.legs[this.leg].name;
             const nt = this.legs[this.leg];
             if (nt.type === "start" || nt.type === "finish") {
               this.nextTarget = { x: this.origin.x, z: this.lineZ, radius: 0 };
                } else {
               this.nextTarget = { x: nt.ref.x, z: nt.ref.z, radius: nt.ref.radius };
                }
             advanced = true;
              }
        }

      this.prevZ = boatPos.z;
      this.dist = this._distTarget(boatPos);
      const dx = this.nextTarget.x - boatPos.x;
      const dz = this.nextTarget.z - boatPos.z;
      this.bearing = normDeg((Math.atan2(dx, dz) * 180) / Math.PI);

      if (advanced) {
         this.progress = this.leg / this.legs.length;
         this.message = msg || this.message;
         this.messageT = 3.2;
       } else if (this.messageT > 0) {
         this.messageT -= 1 / 60;
         if (this.messageT <= 0) this.message = "";
      } else {
         this.message = "";
       }
      this.progress = Math.max(this.progress, this.leg / this.legs.length);
      return this._result(msg || this.message);
     }

    _lapTime = 0;

     _distToRef(boatPos, ref) {
      return Math.hypot(ref.x - boatPos.x, ref.z - boatPos.z);
      }

     _result(extraMsg) {
      const t = this.nextTarget;
      return {
          next: t,
           dist: this.dist,
           bearing: this.bearing,
           leg: this.leg,
           legType: this.legs[this.leg].type,
           legName: this.legName,
           lap: this.lap,
           best: this.best,
           time: (performance.now() - this.lapStart) / 1000,
           progress: this.progress,
           message: extraMsg || this.message,
           justPassed: this.justPassed,
            };
       }

     _completeLap(now) {
      const lapTime = (now - this.lapStart) / 1000;
      this._lapTime = lapTime;
      this.lap++;
      this.best = this.best === null ? lapTime : Math.min(this.best, lapTime);
      this.lapStart = now;
      this.leg = 0;
      this.progress = 0;
      this.legName = this.legs[0].name;
      this.nextTarget = { x: this.origin.x, z: this.lineZ, radius: 0 };
      this.message = "🏁 Runde " + this.lap + " geschafft (" + lapTime.toFixed(1) + " s)";
      this.messageT = 4;
     }

     _resetMarkers() {}
}

export default { Course, makeBuoy };
