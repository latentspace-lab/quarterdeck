// tests/unit/timestep.test.js - Akkumulator fuer "feste Simulation, freie Darstellung".
import { Accumulator, SIM_DT, SIM_HZ, MAX_STEPS_PER_FRAME } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("timestep");
const { ok, near, eq } = suite;

suite.section("Konstanten");
eq(SIM_HZ, 30, "Simulation laeuft mit 30 Hz");
near(SIM_DT, 1 / 30, 1e-15, "SIM_DT ist der Kehrwert");
ok(MAX_STEPS_PER_FRAME >= 2, "mindestens zwei Schritte je Frame aufholbar");

suite.section("Grundverhalten");
{
   const acc = new Accumulator(SIM_DT);
   eq(acc.advance(1000), 0, "der allererste Aufruf setzt nur die Zeitbasis");
   eq(acc.advance(1000), 0, "ohne verstrichene Zeit kein Schritt");
   // Genau ein dt: das muss ein Schritt sein, auch wenn (now-last)/1000 im
   // Fliesskomma ein Bit unter SIM_DT landet.
   eq(acc.advance(1000 + 1000 / 30), 1, "nach genau einem dt: ein Schritt");
   eq(acc.advance(1000 + 1000 / 30 + 5), 0, "5 ms spaeter noch kein zweiter");
   ok(acc.alpha > 0 && acc.alpha < 1, "alpha liegt dazwischen", acc.alpha.toFixed(3));
}

suite.section("Zeit geht nicht verloren");
{
   // 60 Frames zu 16.67 ms sind 1 s Spielzeit - also genau 30 Schritte,
   // egal wie sie auf die Frames fallen.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let steps = 0;
   for (let f = 1; f <= 60; f++) steps += acc.advance((f * 1000) / 60);
   eq(steps, 30, "60 Frames a 16.7 ms ergeben 30 Schritte");

   // Dasselbe bei 144 Hz.
   const acc2 = new Accumulator(SIM_DT);
   acc2.reset(0);
   let steps2 = 0;
   for (let f = 1; f <= 144; f++) steps2 += acc2.advance((f * 1000) / 144);
   eq(steps2, 30, "144 Frames a 6.9 ms ergeben ebenfalls 30 Schritte");

   // Und bei einer Bildrate UNTER der Simulationsrate.
   const acc3 = new Accumulator(SIM_DT);
   acc3.reset(0);
   let steps3 = 0;
   for (let f = 1; f <= 20; f++) steps3 += acc3.advance((f * 1000) / 20);
   eq(steps3, 30, "20 Frames a 50 ms ergeben auch 30 Schritte");
}

suite.section("alpha");
{
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let ms = 1000 / 30 / 2;
   acc.advance(ms); // ein halbes dt
   near(acc.alpha, 0.5, 1e-6, "ein halbes dt -> alpha 0.5");
   ms += 1000 / 30; // noch ein volles dt (Zeitstempel sind absolut)
   acc.advance(ms);
   near(acc.alpha, 0.5, 1e-6, "alpha bleibt der Rest, nicht die Summe");
   ok(acc.alpha >= 0 && acc.alpha < 1, "alpha immer in [0, 1)");
}

suite.section("Todesspirale wird gebremst");
{
   // Ein Rechner, der die Simulation nicht schafft, darf den Rueckstand nicht
   // durch immer mehr Schritte aufzuholen versuchen - sonst wird es schlimmer.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   const steps = acc.advance(900); // 0.9 s auf einen Schlag = 27 Schritte faellig
   eq(steps, MAX_STEPS_PER_FRAME, "nie mehr als MAX_STEPS_PER_FRAME je Frame");
   ok(acc.dropped > 0, "der Rest wird verworfen, nicht gestapelt", acc.dropped + " Schritte");
   ok(acc.alpha >= 0 && acc.alpha < 1, "alpha bleibt gueltig");
}

suite.section("Zeitspruenge");
{
   const acc = new Accumulator(SIM_DT);
   acc.reset(1000);
   eq(acc.advance(500), 0, "eine rueckwaerts laufende Uhr erzeugt keine Schritte");
   eq(acc.advance(500 + 60000), 0, "ein Sprung ueber eine Sekunde wird verworfen (schlafender Tab)");
   acc.reset(0);
   eq(acc.advance(1000 / 30), 1, "nach reset() laeuft es normal weiter");
}

suite.section("Feste Schrittweite");
{
   // Die eigentliche Zusage: jeder Schritt ist exakt SIM_DT lang. Der
   // Akkumulator liefert nur die ANZAHL, nie eine Restzeit.
   const acc = new Accumulator(SIM_DT);
   acc.reset(0);
   let simTime = 0;
   let wall = 0;
   const frames = [7, 23, 4, 51, 16, 16, 9, 33, 12, 40]; // unregelmaessige Frames
   for (const ms of frames) {
      wall += ms;
      simTime += acc.advance(wall) * SIM_DT;
   }
   const drift = wall / 1000 - simTime;
   ok(drift >= 0 && drift < SIM_DT, "Simulationszeit laeuft hoechstens ein dt hinterher",
      (drift * 1000).toFixed(1) + " ms");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
