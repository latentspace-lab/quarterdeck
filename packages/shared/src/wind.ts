// wind.ts - wind system (direction + strength) with light fluctuations
// Direction dir: degrees (where the wind blows from, 0 = North).
// Strength speed: knots.
//
// The wind is a pure function of simulation time t - no randomness, no
// state other than t. This way every participant sees the same wind once
// they've reached the same tick count; nothing needs to be transmitted
// except the base values.
import { normDeg } from "./utils.ts";

export interface WindOptions {
   dir?: number;
   speed?: number;
   gust?: number;
   veer?: number;
   variability?: number;
}

export class Wind {
   baseDir: number;
   baseSpeed: number;
   dir: number;
   speed: number;
   /** 0..1 */
   gustFactor: number;
   /** +1 veering (Stbd), -1 backing (Port) */
   veer: number;
   variability: number;
   t = 0;

   constructor(opts: WindOptions = {}) {
      this.baseDir = opts.dir ?? 0;
      this.baseSpeed = opts.speed ?? 12;
      this.dir = this.baseDir;
      this.speed = this.baseSpeed;
      this.gustFactor = opts.gust ?? 0.4;
      this.veer = opts.veer ?? 0.0;
      this.variability = opts.variability ?? 1.0;
   }

   update(dt: number, t: number): this {
      this.t = t;
      if (this.variability <= 0) {
         this.dir = this.baseDir;
         this.speed = this.baseSpeed;
         return this;
      }
      const t2 = t * 0.35;
      const dirOffset =
         Math.sin(t2 * 0.7) * 5 * this.veer + Math.sin(t2 * 2.3 + 1.1) * 2 * this.veer;
      this.dir = normDeg(this.baseDir + dirOffset);
      const sNoise =
         this.gustFactor *
         (Math.sin(t * 0.9) * 0.55 + Math.sin(t * 2.1 + 1.7) * 0.3 + Math.sin(t * 0.5 + 0.4) * 0.25);
      this.speed = Math.max(0.2, this.baseSpeed + sNoise * this.baseSpeed * 0.6);
      return this;
   }
}

export function beaufortOf(kts: number): number {
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

export function beaufortName(kts: number): string {
   const names = [
      "Calm",
      "Light Breeze",
      "Light Breeze",
      "Gentle Wind",
      "Moderate Wind",
      "Fresh Wind",
      "Strong Wind",
      "Stormy Wind",
      "Storm",
      "Severe Storm",
      "Hurricane",
      "Violent Hurricane",
   ];
   return names[beaufortOf(kts)] || "Off the Scale";
}
