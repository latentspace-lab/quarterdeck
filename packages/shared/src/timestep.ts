// timestep.ts - feste Simulationsrate.
//
// Warum ueberhaupt:
//
// Die physics enthaelt an mehreren Stellen Glaettungsterme der Form
// `x += (ziel - x) * f(dt)`. Solche Terme sind nur dann exakt reproduzierbar,
// wenn dt konstant ist - `f(dt1) danach f(dt2)` ist nicht dasselbe wie
// `f(dt1 + dt2)`. Client-Prediction verlangt aber genau das: der Client
// rechnet dieselben inputn noch einmal, die der Server schon gerechnet hat,
// und muss auf dasselbe Ergebnis kommen. Also: Simulation mit festem step,
// rendering mit frameschirmrate, dazwischen interpoliert.
//
// 30 Hz ist der Kompromiss: fein genug fuer ballistics und hitpruefung,
// grob genug, dass ein Server mehrere Raeume traegt.

/** Simulationsschritt in seconds. Client und Server benutzen exakt diesen value. */
export const SIM_HZ = 30;
export const SIM_DT = 1 / SIM_HZ;

/**
 * Hoechstzahl an Simulationsschritten je Frame. Verhindert die
 * "Todesspirale": wenn ein Rechner die Simulation withouthin nicht schafft,
 * holt er den Rueckstand nicht durch noch mehr stepe auf - dann laeuft die
 * gamezeit lieber sichtbar langsamer.
 */
export const MAX_STEPS_PER_FRAME = 5;

/**
 * Fliesskomma-gameraum beim Abzaehlen der stepe.
 *
 * Ohne ihn ist der haeufigste Fall ueberhaupt - framerate gleich
 * Simulationsrate - der unangenehmste: `(now - last) / 1000` liegt dann mal
 * ein Bit ueber und mal ein Bit unter dt, und die Schleife liefert abwechselnd
 * 0 und 2 stepe statt gleichmaessig 1. Sichtbar wird das als feines
 * Zittern. Eine Nanosekunde gameraum raeumt das aus, without dass je time
 * entsteht, die es nicht gab.
 */
const STEP_EPS = 1e-9;

/**
 * Akkumulator fuer die Schleife "feste Simulation, freie rendering".
 *
 *     const acc = new Accumulator();
 *     function frame(now) {
 *        for (let i = acc.advance(now); i > 0; i--) sim.stepFixed(SIM_DT);
 *        renderer.render(acc.alpha);
 *     }
 */
export class Accumulator {
   readonly dt: number;
   private acc = 0;
   private last = 0;
   private started = false;
   /** Restanteil im laufenden step (0..1) - der Interpolationsfaktor. */
   alpha = 0;
   /** Zahl der stepe, die beim letzten advance() verworfen wurden. */
   dropped = 0;

   constructor(dt: number = SIM_DT) {
      this.dt = dt;
   }

   /** Auf eine neue timebasis setzen (Start, pausenende, Tab-Wechsel). */
   reset(nowMs: number): void {
      this.last = nowMs;
      this.acc = 0;
      this.alpha = 0;
      this.dropped = 0;
      this.started = true;
   }

   /**
    * time bis `nowMs` verbuchen. Liefert die Zahl der faelligen
    * Simulationsschritte und setzt `alpha` fuer die rendering.
    */
   advance(nowMs: number): number {
      if (!this.started) {
         this.reset(nowMs);
         return 0;
      }
      const elapsed = (nowMs - this.last) / 1000;
      this.last = nowMs;
      // Ein negativer oder absurder Sprung (Systemzeit, schlafender Tab) darf
      // die Simulation nicht in eine Aufholjagd schicken.
      this.acc += elapsed > 0 && elapsed < 1 ? elapsed : 0;

      let steps = Math.floor((this.acc + STEP_EPS) / this.dt);
      this.dropped = 0;
      if (steps > MAX_STEPS_PER_FRAME) {
         this.dropped = steps - MAX_STEPS_PER_FRAME;
         this.acc -= this.dropped * this.dt;
         steps = MAX_STEPS_PER_FRAME;
      }
      this.acc = Math.max(0, this.acc - steps * this.dt);
      this.alpha = this.acc / this.dt;
      return steps;
   }
}
