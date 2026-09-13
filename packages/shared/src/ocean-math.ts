// ocean-math.ts - Gerstner-Wellenmeer, reiner Rechenteil.
//
// Hier steht alles, was Client UND Server brauchen: die Wellentabelle, die
// Hoehenfunktion und der Seegangszustand. Was Three.js braucht (Mesh, Shader,
// Uniforms), bleibt im Client in ocean.js und liest von hier.
//
// Warum der Server das Wasser besitzen muss:
// Die Trefferpruefung entscheidet anhand der Rumpflage, ob ein Schuss unter
// der Wasserlinie, in die Bordwand oder ins Rigg geht. Die Rumpflage haengt an
// der Wellenhoehe unter dem Schiff. Rechnete jeder seine eigene Welle, kaeme
// jeder auf ein anderes Trefferbild. Deshalb ist die Wellenphase Teil des
// Serverzustands (SeaSync) und wird mit festem Schritt integriert.

const G = 9.81; // Erdbeschleunigung (Tiefwasser-Dispersionsrelation)

export interface WaveComponent {
   /** Amplitude (m) */
   a: number;
   /** Wellenlaenge (m) */
   L: number;
   /** Richtung relativ zur Wind-Laufrichtung (Grad) */
   off: number;
   /** Gerstner-Steilheit */
   q: number;
   /** Phase */
   ph: number;
}

// Wellen: a = Amplitude (m), L = Wellenlaenge (m), off = Richtung relativ zur
// Wind-Laufrichtung (Grad), q = Gerstner-Steilheit, ph = Phase
export const WAVES: WaveComponent[] = [
   { a: 1.30, L: 165, off: 0, q: 0.62, ph: 0.0 },
   { a: 0.80, L: 92, off: 21, q: 0.66, ph: 2.1 },
   { a: 0.46, L: 48, off: -28, q: 0.60, ph: 4.0 },
   { a: 0.26, L: 25, off: 39, q: 0.58, ph: 1.3 },
   { a: 0.14, L: 12, off: -55, q: 0.62, ph: 5.2 },
   { a: 0.08, L: 6.4, off: 74, q: 0.66, ph: 0.7 },
];

// ---------------------------------------------------------------------------
// Seegang aus Windstaerke
//
// Voll entwickelte See nach Pierson-Moskowitz: die signifikante Wellenhoehe
// waechst mit dem QUADRAT der Windgeschwindigkeit,
//
//     Hs = 0.21 * U^2 / g        (U in m/s)
//
// Das ist der Grund, warum aus 12 kn (knapp 1 m) bei 30 kn ueber 5 m werden.
// Gleichzeitig werden die Wellen LAENGER - eine Sturmsee ist keine vergroesserte
// Kabbelwelle, sondern langer, schwerer Seegang.
// ---------------------------------------------------------------------------

// Signifikante Hoehe, die sich aus der Wellentabelle bei Amplitudenfaktor 1
// ergibt: Hs = 4 * sigma, sigma^2 = Summe(a_i^2)/2
const H_PER_AMP = (() => {
   let v = 0;
   for (const w of WAVES) v += w.a * w.a;
   return 4 * Math.sqrt(v / 2);
})();

const KN_TO_MS = 0.514444;
const HS_MAX = 11.5; // Deckel, damit aus einem Orkan kein Tsunami wird

// Signifikante Wellenhoehe in Metern
export function waveHeightForWind(kts: number): number {
   const U = Math.max(kts, 0) * KN_TO_MS;
   return Math.min((0.21 * U * U) / G, HS_MAX);
}

// Amplitudenfaktor fuer die Wellentabelle
export function ampForWind(kts: number): number {
   return waveHeightForWind(kts) / H_PER_AMP;
}

// Streckung der Wellenlaengen. Bezugspunkt sind die Tabellenwerte bei 12 kn.
export function lambdaForWind(kts: number): number {
   // Die Wellenlaenge waechst langsamer als die Hoehe - sonst wird die See zwar
   // hoch, aber so flach geneigt, dass sie wie eine glatte Duenung wirkt.
   // Mit der Wurzel bleibt die Steilheit erhalten: eine Sturmsee ist steil.
   const r = Math.max(kts, 1) / 12;
   return Math.min(Math.max(Math.sqrt(r), 0.55), 1.75);
}

// Weisskappen: fangen bei Bft 4 an und bedecken die See mit zunehmendem Wind.
export function whitecapsForWind(kts: number): number {
   return Math.min(Math.max((kts - 7) / 26, 0), 1);
}

// Seezustand nach Douglas-Skala (fuer die Anzeige)
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
// h = Hoehe, dx/dz = horizontale Verschiebung
function waveSum(px: number, pz: number, t: number, windRad: number, lambda = 1): WaveSample {
   let h = 0;
   let dx = 0;
   let dz = 0;
   const invSqrtL = 1 / Math.sqrt(lambda);
   for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const k = (2 * Math.PI) / (w.L * lambda);
      // Tiefwasser: omega = sqrt(g*k). Gestreckte Wellen laufen langsamer.
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

// Wasserhoehe an Weltposition (x, z). Gerstner verschiebt die Flaeche auch
// horizontal, daher wird der Flaechenparameter per Fixpunkt-Iteration
// invertiert -> das Boot sitzt exakt auf der sichtbaren Welle.
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

/** Abfragbare Wasserflaeche - alles, was eine Hoehe an (x,z) braucht. */
export type SeaHeightFn = (x: number, z: number) => number;

// ---------------------------------------------------------------------------
// Seegangszustand
//
// Zwei Groessen, die NICHT aus der Zeit allein folgen und deshalb integriert
// werden muessen:
//
//   seaWind - die See folgt dem Wind traege. Sie baut sich schneller auf, als
//             sie abklingt (tau 45 s gegen 95 s). Frueher lag dieser Wert in
//             game.js (Zeile 392) und wurde mit variablem dt fortgeschrieben.
//   phaseT  - aufsummierte Wellenphase. Laengere Wellen laufen langsamer
//             (omega ~ 1/sqrt(lambda)); wuerde man die Phase aus der absoluten
//             Zeit berechnen, verschoebe sich das ganze Wellenfeld
//             sprunghaft, sobald der Wind auffrischt.
//
// Beide zusammen sind der uebertragbare Wasserzustand (SeaSync in types.ts).
// ---------------------------------------------------------------------------
export class SeaState {
   /** Nachlaufende Windstaerke, aus der sich der Seegang ergibt (kn) */
   seaWind: number;
   /** Aufsummierte Wellenphase (s) */
   phaseT = 0;
   /** Ausbreitungsrichtung der Wellen (rad) */
   windRad = Math.PI;

   constructor(windKts = 12) {
      this.seaWind = windKts;
   }

   /** Auf eine Windstaerke setzen, ohne Nachlauf (Start, Szenenwechsel). */
   snapTo(windKts: number): void {
      this.seaWind = windKts;
   }

   /**
    * Einen festen Schritt integrieren.
    * @param windKts aktuelle wahre Windstaerke
    * @param windDirDeg Richtung, aus der es weht (Grad)
    */
   step(dt: number, windKts: number, windDirDeg: number): void {
      // Seegang dem Wind nachfuehren (Aufbau schneller als Abklingen)
      const tau = windKts > this.seaWind ? 45 : 95;
      this.seaWind += (windKts - this.seaWind) * (1 - Math.exp(-dt / tau));
      // Wellen laufen mit dem Wind, also dorthin, wohin er weht
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

   /** Hoehe der sichtbaren Wasseroberflaeche an (x, z). */
   heightAt(x: number, z: number): number {
      return seaHeight(x, z, this.phaseT, this.windRad, this.amp, this.lambda);
   }

   /**
    * Eingefrorene Abfragefunktion fuer genau einen Tick: Phase, Amplitude und
    * Streckung werden beim Erzeugen festgehalten. Damit rechnen alle Systeme
    * eines Schrittes auf derselben Flaeche, auch wenn die See danach
    * weiterlaeuft.
    *
    * `scale` ist eine Absenkung der abgefragten Flaeche. Wrack und Geschosse
    * benutzen 0.9 (sie tauchen etwas frueher ein als der sichtbare Kamm), die
    * Rumpflage in shipPose() rechnet mit der vollen Flaeche (scale 1).
    */
   sampler(scale = 0.9): SeaHeightFn {
      const t = this.phaseT;
      const wr = this.windRad;
      const a = this.amp;
      const l = this.lambda;
      return (x: number, z: number) => seaHeight(x, z, t, wr, a, l) * scale;
   }

   /** Uebertragbarer Zustand. */
   toSync(): { seaWind: number; phaseT: number } {
      return { seaWind: this.seaWind, phaseT: this.phaseT };
   }
   fromSync(s: { seaWind: number; phaseT: number }): void {
      this.seaWind = s.seaWind;
      this.phaseT = s.phaseT;
   }
}
