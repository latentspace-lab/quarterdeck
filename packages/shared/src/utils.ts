// utils.ts - mathematische und allgemeine Hilfsfunktionen
// Winkelkonvention: 0° = Norden (+Z), 90° = Osten (+X), wie in der See.
// "Richtung" = Kursrichtung (wohin der Begriff zeigt), in Grad, nach 0..360 normalisiert.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Knoten -> m/s und umgekehrt
export const KNOT_TO_MS = 0.514444;
export const MS_TO_KNOT = 1 / KNOT_TO_MS;

/** Tabelle aus [Grad, Wert]-Paaren, aufsteigend sortiert. */
export type Table = ReadonlyArray<readonly [number, number]>;

/** Vektor in der XZ-Ebene: +z = Norden, +x = Osten. */
export interface Vec2 {
   x: number;
   z: number;
}

export const clamp = (v: number, lo: number, hi: number): number =>
   v < lo ? lo : v > hi ? hi : v;
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (v - a) / (b - a);
export const smoothstep = (edge0: number, edge1: number, x: number): number => {
   const t = clamp(invLerp(edge0, edge1, x), 0, 1);
   return t * t * (3 - 2 * t);
};

// Winkel in [0, 360)
export function normDeg(a: number): number {
   let r = a % 360;
   if (r < 0) r += 360;
   return r;
}

// Differenz des kürzesten Weges zwischen zwei Kursen in [-180, 180]
export function diffDeg(a: number, b: number): number {
   let d = normDeg(b - a);
   if (d > 180) d -= 360;
   return d;
}

// Kleinfeld-Abstand zweier Kurse in [0,180]
export function absDiffDeg(a: number, b: number): number {
   return Math.abs(diffDeg(a, b));
}

// Einheitliche Richtung "Kurs" (0=N,+z; 90=E,+x) als Vektor in der XZ-Ebene
export function dirVec(deg: number): Vec2 {
   const r = deg * DEG;
   return { x: Math.sin(r), z: Math.cos(r) };
}

// Winkel zwischen zwei Kursen in [0,180]
export function angleBetweenDeg(a: number, b: number): number {
   return absDiffDeg(a, b);
}

// Interpolation über tabellierte Werte (t in Grad 0..360, tab als [deg,val] paare,
// sortiert, deckend 0..360 oder per Wrap).
export function interpTable(t: number, tab: Table): number {
   let t0 = t;
   // Wrap auf [0, highest]
   const lo = tab[0][0];
   const hi = tab[tab.length - 1][0];
   if (t0 < lo) t0 += 360;
   if (t0 > hi) t0 -= 360;
   for (let i = 0; i < tab.length - 1; i++) {
      const [d0, v0] = tab[i];
      const [d1, v1] = tab[i + 1];
      if (t0 >= d0 && t0 <= d1) {
         const u = invLerp(d0, d1, t0);
         return lerp(v0, v1, u);
      }
   }
   return tab[tab.length - 1][1];
}

// 1D-Interpolateur-Fabrik (für Polar-Kurven). Akzeptiert tabellierte Paare.
export function makeTableInterpolator(tab: Table): (t: number) => number {
   return (t: number) => interpTable(t, tab);
}

// ---------------------------------------------------------------------------
// dt-invariante Glaettung
//
// `lerp(a, b, k)` mit festem k ist von der Aufrufrate abhaengig: derselbe
// Vorgang laeuft bei 60 fps doppelt so schnell wie bei 30 fps. Fuer Client-
// Prediction muss jede Glaettung allein von dt abhaengen, nie von der Zahl der
// Aufrufe. `approach` naehert sich exponentiell mit einer Zeitkonstante:
//
//     x(t) = ziel + (x0 - ziel) * exp(-t / tau)
//
// Bei festem dt ist das exakt reproduzierbar - und zwar auch dann, wenn Client
// und Server unterschiedlich oft rendern.
// ---------------------------------------------------------------------------
export function approach(current: number, target: number, dt: number, tau: number): number {
   if (!(tau > 0)) return target;
   if (!(dt > 0)) return current;
   return target + (current - target) * Math.exp(-dt / tau);
}

/**
 * Halbwertszeit-Schreibweise derselben Glaettung: nach `halfLife` Sekunden ist
 * die Haelfte des Abstands zum Ziel abgebaut. Liest sich beim Einstellen
 * leichter als eine Zeitkonstante.
 */
export function approachHalfLife(
   current: number,
   target: number,
   dt: number,
   halfLife: number,
): number {
   return approach(current, target, dt, halfLife / Math.LN2);
}
