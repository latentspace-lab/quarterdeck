// ocean-math.ts - Gerstner wave ocean, pure computation.
//
// Everything the client AND the server need lives here: the wave table, the
// height function, and the sea state. What Three.js needs (mesh, shader,
// uniforms) stays in the client's ocean.js and reads from here.
//
// Why the server must own the water:
// Hit testing decides, from the hull's pose, whether a shot goes in below
// the waterline, into the side, or into the rig. The hull's pose depends on
// the wave height under the ship. If everyone computed their own wave, each
// would get a different hit picture. That's why the wave phase is part of
// the server state (SeaSync) and is integrated with a fixed step.

const G = 9.81; // gravitational acceleration (deep-water dispersion relation)

export interface WaveComponent {
   /** Amplitude (m) */
   a: number;
   /** Wavelength (m) */
   L: number;
   /** Direction relative to the wind's travel direction (degrees) */
   off: number;
   /** Gerstner steepness */
   q: number;
   /** Phase */
   ph: number;
}

// Waves: a = amplitude (m), L = wavelength (m), off = direction relative to
// the wind's travel direction (degrees), q = Gerstner steepness, ph = phase
export const WAVES: WaveComponent[] = [
   { a: 1.30, L: 165, off: 0, q: 0.62, ph: 0.0 },
   { a: 0.80, L: 92, off: 21, q: 0.66, ph: 2.1 },
   { a: 0.46, L: 48, off: -28, q: 0.60, ph: 4.0 },
   { a: 0.26, L: 25, off: 39, q: 0.58, ph: 1.3 },
   { a: 0.14, L: 12, off: -55, q: 0.62, ph: 5.2 },
   { a: 0.08, L: 6.4, off: 74, q: 0.66, ph: 0.7 },
];

// ---------------------------------------------------------------------------
// Sea state from wind strength
//
// Fully developed sea per Pierson-Moskowitz: the significant wave height
// grows with the SQUARE of the wind speed,
//
//     Hs = 0.21 * U^2 / g        (U in m/s)
//
// That's why 12 kn (just under 1 m) becomes over 5 m at 30 kn. At the same
// time the waves get LONGER - a storm sea is not an enlarged chop, it's
// long, heavy swell.
// ---------------------------------------------------------------------------

// Significant height that results from the wave table at amplitude factor 1:
// Hs = 4 * sigma, sigma^2 = sum(a_i^2)/2
const H_PER_AMP = (() => {
   let v = 0;
   for (const w of WAVES) v += w.a * w.a;
   return 4 * Math.sqrt(v / 2);
})();

const KN_TO_MS = 0.514444;
const HS_MAX = 11.5; // cap, so a hurricane doesn't turn into a tsunami

// Significant wave height in metres
export function waveHeightForWind(kts: number): number {
   const U = Math.max(kts, 0) * KN_TO_MS;
   return Math.min((0.21 * U * U) / G, HS_MAX);
}

// Amplitude factor for the wave table
export function ampForWind(kts: number): number {
   return waveHeightForWind(kts) / H_PER_AMP;
}

// Stretching of the wavelengths. Reference point is the table values at 12 kn.
export function lambdaForWind(kts: number): number {
   // The wavelength grows more slowly than the height - otherwise the sea
   // would get high but so gently sloped that it reads as smooth swell.
   // Using the square root keeps the steepness: a storm sea is steep.
   const r = Math.max(kts, 1) / 12;
   return Math.min(Math.max(Math.sqrt(r), 0.55), 1.75);
}

// Whitecaps: start at Bft 4 and cover more of the sea as the wind rises.
export function whitecapsForWind(kts: number): number {
   return Math.min(Math.max((kts - 7) / 26, 0), 1);
}

// Sea state per the Douglas scale (for the display)
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

// Gerstner sum at surface parameter (px, pz), unscaled:
// h = height, dx/dz = horizontal displacement
function waveSum(px: number, pz: number, t: number, windRad: number, lambda = 1): WaveSample {
   let h = 0;
   let dx = 0;
   let dz = 0;
   const invSqrtL = 1 / Math.sqrt(lambda);
   for (let i = 0; i < WAVES.length; i++) {
      const w = WAVES[i];
      const k = (2 * Math.PI) / (w.L * lambda);
      // Deep water: omega = sqrt(g*k). Stretched waves travel slower.
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

// Water height at world position (x, z). Gerstner also displaces the surface
// horizontally, so the surface parameter is inverted by fixed-point
// iteration -> the boat sits exactly on the visible wave.
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

/** Queryable water surface - anything that needs a height at (x,z). */
export type SeaHeightFn = (x: number, z: number) => number;

// ---------------------------------------------------------------------------
// Sea state
//
// Two quantities that do NOT follow from time alone and therefore must be
// integrated:
//
//   seaWind - the sea follows the wind sluggishly. It builds up faster than
//             it subsides (tau 45 s vs. 95 s). This value used to live in
//             game.js (line 392) and was advanced with a variable dt.
//   phaseT  - accumulated wave phase. Longer waves travel slower
//             (omega ~ 1/sqrt(lambda)); computing the phase from absolute
//             time would make the whole wave field jump the instant the
//             wind freshens.
//
// Together, both make up the transferable water state (SeaSync in types.ts).
// ---------------------------------------------------------------------------
export class SeaState {
   /** Lagging wind strength that the sea state follows (kn) */
   seaWind: number;
   /** Accumulated wave phase (s) */
   phaseT = 0;
   /** Direction the waves travel (rad) */
   windRad = Math.PI;

   constructor(windKts = 12) {
      this.seaWind = windKts;
   }

   /** Set to a wind strength without lag (start, scene change). */
   snapTo(windKts: number): void {
      this.seaWind = windKts;
   }

   /**
    * Integrate one fixed step.
    * @param windKts current true wind strength
    * @param windDirDeg direction the wind blows from (degrees)
    */
   step(dt: number, windKts: number, windDirDeg: number): void {
      // Make the sea state follow the wind (builds up faster than it subsides)
      const tau = windKts > this.seaWind ? 45 : 95;
      this.seaWind += (windKts - this.seaWind) * (1 - Math.exp(-dt / tau));
      // Waves travel with the wind, i.e. toward where it is blowing
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

   /** Height of the visible water surface at (x, z). */
   heightAt(x: number, z: number): number {
      return seaHeight(x, z, this.phaseT, this.windRad, this.amp, this.lambda);
   }

   /**
    * A frozen query function for exactly one tick: phase, amplitude and
    * stretch are fixed at creation time. That way every system in a step
    * computes against the same surface, even as the sea keeps moving
    * afterward.
    *
    * `scale` lowers the queried surface. Wrecks and projectiles use 0.9
    * (they dip in a little earlier than the visible crest); the hull's pose
    * in shipPose() uses the full surface (scale 1).
    */
   sampler(scale = 0.9): SeaHeightFn {
      const t = this.phaseT;
      const wr = this.windRad;
      const a = this.amp;
      const l = this.lambda;
      return (x: number, z: number) => seaHeight(x, z, t, wr, a, l) * scale;
   }

   /** Transferable state. */
   toSync(): { seaWind: number; phaseT: number } {
      return { seaWind: this.seaWind, phaseT: this.phaseT };
   }
   fromSync(s: { seaWind: number; phaseT: number }): void {
      this.seaWind = s.seaWind;
      this.phaseT = s.phaseT;
   }
}
