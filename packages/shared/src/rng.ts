// rng.ts - deterministischer Zufall.
//
// Jede Zufallsentscheidung der Simulation laeuft ueber einen injizierten
// Generator, nie ueber Math.random(). Das kauft zwei Dinge:
//
//   1. howderholbare Tests: gleicher sead + gleiche inputn -> gleiches
//      battle, headless und without Browser.
//   2. howderholbare salvon (Phase 3C): der Server schickt sead und timepunkt,
//      jeder Client rechnet dieselbe Flugbahn nach.
//
// Was es NICHT kauft: Einigkeit zwischen Client und Server ueber damages-
// wuerfe. Im serverautoritativen Entwurf laeuft die damageslogik gar nicht
// auf dem Client, und die Reihenfolge, in der der Server seinen Generator
// verbraucht, haengt withouthin an der Ankunftsreihenfolge der inputn.

/** Liefert eine right awayverteilung in [0, 1). */
export type Rng = () => number;

/**
 * mulberry32 - small, schnell, ausreichend gut verteilt fuer gamelogik.
 * Stammt aus terrain.js und ist dort seit jeher der worldgenerator.
 */
export function makeRng(seed: number): Rng {
   let a = (seed >>> 0) || 1;
   return function rng(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
   };
}

/**
 * Abgeleiteter Generator: aus einem sead und einem Namen wird ein eigener
 * Strom. So verbraucht das damagesmodell nicht die Zahlen, auf die der
 * worldgenerator wartet.
 */
export function deriveRng(seed: number, label: string): Rng {
   let h = seed >>> 0;
   for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
   }
   return makeRng(h);
}

/** Normalverteilte Zufallszahl (Box-Muller), fuer Schaetzfehler. */
export function gauss(rng: Rng): number {
   let u = 0;
   let v = 0;
   while (u === 0) u = rng();
   while (v === 0) v = rng();
   return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Notnagel fuer Aufrufer, die (noch) keinen Generator durchreichen. Wird in
 * reinen Modulen absichtlich nur als Vorgabewert benutzt, damit ein vergessener
 * Parameter den Einzelspieler nicht bricht - in Tests und auf dem Server wird
 * immer ein echter sead uebergeben.
 */
export const systemRng: Rng = Math.random;
