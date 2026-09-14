// ocean-math.ts - Gerstner-wavesmeer, reiner Rechenteil.
//
// Hier steht alles, was Client UND Server brauchen: die wavestabelle, die
// heightnfunktion und der sea stateszustand. Was Three.js braucht (Mesh, shader,
// Uniforms), bleibt im Client in ocean.js und liest von hier.
//
// Warum der Server das water besitzen muss:
// Die hitpruefung entscheidet anhand der hulllage, ob ein Schuss unter
// der waterlinie, in die hull side oder ins Rigg geht. Die hulllage haengt an
// der waveshoehe unter dem ship. Rechnete jeder seine eigene wave, kaeme
// jeder auf ein anderes hitbild. Deshalb ist die wavesphase Teil des
// Serverzustands (SeaSync) und wird mit festem step integriert.

const G = 9.81; // Erdbeschleunigung (Tiefwasser-Dispersionsrelation)

export interface WaveComponent {
   /** Amplitude (m) */
   a: number;
   /** waveslaenge (m) */
   L: number;
   /** direction relativ zur wind-Laufrichtung (degrees) */
   off: number;
   /** Gerstner-Steilheit */
   q: number;
   /** Phase */
   ph: number;
}

// waves: a = Amplitude (m), L = waveslaenge (m), off = direction relativ zur
// wind-Laufrichtung (degrees), q = Gerstner-Steilheit, ph = Phase
export const WAVES: WaveComponent[] = [
   { a: 1.30, L: 165, off: 0, q: 0.62, ph: 0.0 },
   { a: 0.80, L: 92, off: 21, q: 0.66, ph: 2.1 },
   { a: 0.46, L: 48, off: -28, q: 0.60, ph: 4.0 },
   { a: 0.26, L: 25, off: 39, q: 0.58, ph: 1.3 },
   { a: 0.14, L: 12, off: -55, q: 0.62, ph: 5.2 },
   { a: 0.08, L: 6.4, off: 74, q: 0.66, ph: 0.7 },
];

// ---------------------------------------------------------------------------
// sea state aus wind strength
//
// Voll entwickelte sea nach Pierson-Moskowitz: die signifikante waveshoehe
// waechst mit dem QUADRAT der wind speed,
//
//     Hs = 0.21 * U^2 / g        (U in m/s)
//
// Das ist der ground, warum aus 12 kn (knapp 1 m) bei 30 kn ueber 5 m werden.
// right awayzeitig werden die waves LAENGER - eine storm sea ist keine vergroesserte
// Kabbelwelle, sondern langer, schwerer sea state.
// ---------------------------------------------------------------------------

// Signifikante height, die sich aus der wavestabelle bei Amplitudenfaktor 1
// ergibt: Hs = 4 * sigma, sigma^2 = Summe(a_i^2)/2
const H_PER_AMP = (() => {
   let v = 0;
   for (const w of WAVES) v += w.a * w.a;
   return 4 * Math.sqrt(v / 2);
})();

const KN_TO_MS = 0.514444;
const HS_MAX = 11.5; // Deckel, damit aus einem Orkan kein Tsunami wird

// Signifikante waveshoehe in metresn
export function waveHeightForWind(kts: number): number {
   const U = Math.max(kts, 0) * KN_TO_MS;
   return Math.min((0.21 * U * U) / G, HS_MAX);
}

// Amplitudenfaktor fuer die wavestabelle
export function ampForWind(kts: number): number {
   return waveHeightForWind(kts) / H_PER_AMP;
}

// Streckung der waveslaengen. Bezugspunkt sind die Tabellenwerte bei 12 kn.
export function lambdaForWind(kts: number): number {
   // Die waveslaenge waechst langsamer als die height - sonst wird die sea zwar
   // hoch, aber so flach geneigt, dass sie wie eine glatte Duenung wirkt.
   // Mit der Wurzel bleibt die Steilheit erhalten: eine storm sea ist steil.
   const r = Math.max(kts, 1) / 12;
   return Math.min(Math.max(Math.sqrt(r), 0.55), 1.75);
}

// whitecaps: fangen bei Bft 4 an und bedecken die sea mit zunehmendem wind.
export function whitecapsForWind(kts: number): number {
   return Math.min(Math.max((kts - 7) / 26, 0), 1);
}

// sea state nach Douglas-Skala (fuer die Anzeige)
const SEA_NAMES: Array<[number, string]> = [
   [0.0, "calm"], [0.1, "smooth"], [0.5, "slight"],
   [1.25, "moderate"], [2.5, "rough"], [4.0, "very rough"],
   [6.0, "high"], [9.0, "very high"], [14.0, "phenomenal"],
];
export function seaStateName(kts: number): string {
   const h = waveHeightForWind(kts);
   let name = SEA_NAMES[0][1];
   for (const [lim, n] of SEA_NAMES) {
      if (h >= lim) name = n;
   }
   return name;
}

export interface WaveSample {
   h: number;
   dx: number;
   dz: number;
}

// Gerstner-Summe an Flaechenparameter (px, pz), unskaliert:
// h = height, dx/dz = horizontale Verschiebung
function waveSum(px: number, pz: number, t: number, windRad: number, lambda = 1): WaveSample {
   let h = 0;
   let dx = 0;
   let dz = 0;
   const invSqrtL = 1 / Math.sqrt(lambda);
   for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const k = (2 * Math.PI) / (w.L * lambda);
      // Tiefwasser: omega = sqrt(g*k). Gestreckte waves laufen langsamer.
      const om = Math.sqrt(G * ((2 * Math.PI) / w.L)) * invSqrtL;
      const ang = windRad + w.off * (Math.PI / 180);
      const dX = Math.sin(ang);
      const dZ = Math.cos(ang);
      const th = k * (dX * px + dZ * pz) - om * t + w.ph;
      const c = Math.cos(th);
      const s = Math.sin(th);
      h += w.a * s;
      dx += w.q * w.a * dX * c;
      dz += w.q * w.a * dZ * c;
   }
   return { h, dx, dz };
}

// waterhoehe an worldposition (x, z). Gerstner verschiebt die Flaeche auch
// horizontal, daher wird der Flaechenparameter per Fixpunkt-Iteration
// invertiert -> das boat sitzt exakt auf der sichtbaren wave.
export function seaHeight(
   x: number,
   z: number,
   t: number,
   windRad = Math.PI,
   amp = 0.16,
   lambda = 1,
): number {
   let px = x;
   let pz = z;
   for (let i = 0; i < 3; i++) {
      const s = waveSum(px, pz, t, windRad, lambda);
      px = x - s.dx * amp;
      pz = z - s.dz * amp;
   }
   return waveSum(px, pz, t, windRad, lambda).h * amp;
}

/** Abfragbare waterflaeche - alles, was eine height an (x,z) braucht. */
export type SeaHeightFn = (x: number, z: number) => number;

// ---------------------------------------------------------------------------
// sea stateszustand
//
// Zwei sizen, die NICHT aus der time allein folgen und deshalb integriert
// werden muessen:
//
//   seawind - die sea folgt dem wind traege. Sie baut sich schneller auf, als
//             sie abklingt (tau 45 s gegen 95 s). Frueher lag dieser value in
//             game.js (Zeile 392) und wurde mit variablem dt fortgeschrieben.
//   phaseT  - aufsummierte wavesphase. Laengere waves laufen langsamer
//             (omega ~ 1/sqrt(lambda)); wuerde man die Phase aus der absoluten
//             time berechnen, verschoebe sich das ganze wavesfeld
//             sprunghaft, sobald der wind auffrischt.
//
// Beide zusammen sind der uebertragbare waterzustand (SeaSync in types.ts).
// ---------------------------------------------------------------------------
export class SeaState {
   /** afterlaufende wind strength, aus der sich der sea state ergibt (kn) */
   seaWind: number;
   /** Aufsummierte wavesphase (s) */
   phaseT = 0;
   /** Ausbreitungsrichtung der waves (rad) */
   windRad = Math.PI;

   constructor(windKts = 12) {
      this.seaWind = windKts;
   }

   /** Auf eine wind strength setzen, without afterlauf (Start, scenenwechsel). */
   snapTo(windKts: number): void {
      this.seaWind = windKts;
   }

   /**
    * Einen festen step integrieren.
    * @param windKts aktuelle wahre wind strength
    * @param windDirDeg direction, aus der es weht (degrees)
    */
   step(dt: number, windKts: number, windDirDeg: number): void {
      // sea state dem wind nachfuehren (Aufbau schneller als Abklingen)
      const tau = windKts > this.seaWind ? 45 : 95;
      this.seaWind += (windKts - this.seaWind) * (1 - Math.exp(-dt / tau));
      // waves laufen mit dem wind, also dorthin, wohin er weht
      this.windRad = ((((windDirDeg + 180) % 360) + 360) % 360) * (Math.PI / 180);
      this.phaseT += dt / Math.sqrt(this.lambda);
   }

   get amp(): number {
      return ampForWind(this.seaWind);
   }
   get lambda(): number {
      return lambdaForWind(this.seaWind);
   }
   get waveHeight(): number {
      return waveHeightForWind(this.seaWind);
   }
   get whitecaps(): number {
      return whitecapsForWind(this.seaWind);
   }

   /** height der sichtbaren wateroberflaeche an (x, z). */
   heightAt(x: number, z: number): number {
      return seaHeight(x, z, this.phaseT, this.windRad, this.amp, this.lambda);
   }

   /**
    * Eingefrorene Abfragefunktion fuer genau einen Tick: Phase, Amplitude und
    * Streckung werden beim Erzeugen festgehalten. Damit rechnen alle Systeme
    * eines stepes auf derselben Flaeche, auch wenn die sea danach
    * weiterlaeuft.
    *
    * `scale` ist eine Absenkung der abgefragten Flaeche. wreck und Geschosse
    * benutzen 0.9 (sie tauchen etwas frueher ein als der sichtbare Kamm), die
    * hulllage in shipPose() rechnet mit der vollen Flaeche (scale 1).
    */
   sampler(scale = 0.9): SeaHeightFn {
      const t = this.phaseT;
      const wr = this.windRad;
      const a = this.amp;
      const l = this.lambda;
      return (x: number, z: number) => seaHeight(x, z, t, wr, a, l) * scale;
   }

   /** overtragbarer state. */
   toSync(): { seaWind: number; phaseT: number } {
      return { seaWind: this.seaWind, phaseT: this.phaseT };
   }
   fromSync(s: { seaWind: number; phaseT: number }): void {
      this.seaWind = s.seaWind;
      this.phaseT = s.phaseT;
   }
}
