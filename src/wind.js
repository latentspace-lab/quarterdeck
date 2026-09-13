// wind.js - Wind-System (Richtung + Staerke) mit leichten Schwankungen
// Richtung dir: Grad (woher der Wind weht, 0 = Nord).
// Staerke speed: Knoten.
import { normDeg } from "./utils.js";

export class Wind {
   constructor(opts = {}) {
      this.baseDir = opts.dir ?? 0;
      this.baseSpeed = opts.speed ?? 12;
      this.dir = this.baseDir;
      this.speed = this.baseSpeed;
      this.gustFactor = opts.gust ?? 0.4; // 0..1
      this.veer = opts.veer ?? 0.0; // +1 right (stbd), -1 left (backbord)
      this.variability = opts.variability ?? 1.0;
      this.t = 0;
   }

   update(dt, t) {
      this.t = t;
      if (this.variability <= 0) {
         this.dir = this.baseDir;
         this.speed = this.baseSpeed;
         return this;
      }
      const t2 = t * 0.35;
      const dirOffset =
         Math.sin(t2 * 0.7) * 5 * this.veer +
         Math.sin(t2 * 2.3 + 1.1) * 2 * this.veer;
      this.dir = normDeg(this.baseDir + dirOffset);
      const sNoise =
         this.gustFactor *
          (Math.sin(t * 0.9) * 0.55 + Math.sin(t * 2.1 + 1.7) * 0.3 + Math.sin(t * 0.5 + 0.4) * 0.25);
      this.speed = Math.max(0.2, this.baseSpeed + sNoise * this.baseSpeed * 0.6);
      return this;
   }
}

export function beaufortOf(kts) {
   if (kts < 1) return 0;
   if (kts < 4) return 1;
   if (kts < 7) return 2;
   if (kts < 11) return 3;
   if (kts < 17) return 4;
   if (kts < 22) return 5;
   if (kts < 28) return 6;
   if (kts < 34) return 7;
   if (kts < 41) return 8;
   if (kts < 48) return 9;
   if (kts < 56) return 10;
   if (kts < 64) return 11;
   return 12;
}

export function beaufortName(kts) {
   const names = [
      "Windstille",
      "Leichte Brise",
      "Leichte Brise",
      "Schwacher Wind",
      "Maessiger Wind",
      "Frischer Wind",
      "Starker Wind",
       "Stuermischer Wind",
       "Sturm",
       "Schwerer Sturm",
       "Orkan",
       "Starker Orkan",
   ];
   return names[beaufortOf(kts)] || "Windschwaecher";
}
