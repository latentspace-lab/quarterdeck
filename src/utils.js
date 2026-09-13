// utils.js - mathematische und allgemeine Hilfsfunktionen
// Winkelkonvention: 0° = Norden (+Z), 90° = Osten (+X), wie in der See.
// "Richtung" = Kursrichtung (wohin der Begriff zeigt), in Grad, nach 0..360 normalisiert.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// Knoten -> m/s und umgekehrt
export const KNOT_TO_MS = 0.514444;
export const MS_TO_KNOT = 1 / KNOT_TO_MS;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (v - a) / (b - a);
export const smoothstep = (edge0, edge1, x) => {
   const t = clamp(invLerp(edge0, edge1, x), 0, 1);
   return t * t * (3 - 2 * t);
};

// Winkel in [0, 360)
export function normDeg(a) {
   let r = a % 360;
   if (r < 0) r += 360;
   return r;
}

// Differenz des kürzesten Weges zwischen zwei Kursen in [-180, 180]
export function diffDeg(a, b) {
   let d = normDeg(b - a);
   if (d > 180) d -= 360;
   return d;
}

// Kleinfeld-Abstand zweier Kurse in [0,180]
export function absDiffDeg(a, b) {
   return Math.abs(diffDeg(a, b));
}

// Einheitliche Richtung "Kurs" (0=N,+z; 90=E,+x) als Vektor in der XZ-Ebene
// Gibt einen 2D-Vektor {x, z} zurück, in dem +z = Norden, +x = Osten.
export function dirVec(deg) {
   const r = deg * DEG;
   return { x: Math.sin(r), z: Math.cos(r) };
}

// Winkel zwischen zwei Kursen in [0,180]
export function angleBetweenDeg(a, b) {
   return absDiffDeg(a, b);
}

// Interpolation über tabellierte Werte (t in Grad 0..360, tab als [deg,val] paare,
// sortiert, deckend 0..360 oder per Wrap).
export function interpTable(t, tab) {
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
export function makeTableInterpolator(tab) {
   return (t) => interpTable(t, tab);
}
