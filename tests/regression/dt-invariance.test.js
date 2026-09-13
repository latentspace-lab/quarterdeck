// tests/regression/dt-invariance.test.js
//
// Die Zusage von Phase 0B': die Simulation haengt AUSSCHLIESSLICH an der
// Schrittweite, nie an der Aufrufrate oder am Bildschirm.
//
// Warum das der wichtigste Test des ganzen Umbaus ist: Client-Prediction heisst,
// dass der Client Eingaben vorwegnimmt, die der Server spaeter noch einmal
// rechnet. Kommen beide nicht auf dasselbe Ergebnis, sieht der Spieler bei
// jedem Serverpaket einen Ruck. Die alte Schleife rief sim.step(dt) mit dem
// Frame-Abstand auf - auf einem 144-Hz-Schirm also mit anderen dt-Werten als
// auf einem 60-Hz-Schirm, und damit mit anderem Ergebnis.
import { BoatDynamics, Wind, SeaState, SIM_DT, getVessel, approach, RUDDER_TAU }
   from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("dt-Invarianz");
const { ok, near, eq } = suite;

const VESSEL = getVessel("lydia");
const WIND = { dir: 20, speedKts: 16 };

/** Eine Kommandofolge, die nicht zufaellig ist, aber auch nicht langweilig. */
const rudderAt = (tick) => Math.sin(tick * 0.013) * 0.8 + Math.sin(tick * 0.071) * 0.2;

function sail(ticks, dt, commandsPerTick = 1) {
   const b = new BoatDynamics({ vessel: VESSEL, heading: 110, x: 0, z: 0 });
   const trace = [];
   for (let i = 0; i < ticks; i++) {
      // Mehrere setRudder() je Schritt: frueher hat jeder einzelne Aufruf die
      // Ruderlage weitergezogen (lerp 0.3 je Aufruf). Heute setzt er nur das
      // Kommando - geglaettet wird genau einmal, in step().
      for (let k = 0; k < commandsPerTick; k++) b.setRudder(rudderAt(i));
      b.step(dt, WIND);
      trace.push(b.heading, b.speed, b.heel, b.rudder, b.pos.x, b.pos.z);
   }
   return { b, sig: fingerprint(trace) };
}

suite.section("Die Ruderglaettung haengt nicht mehr an der Aufrufzahl");
{
   // Das war der konkrete Defekt: Controls.read() glaettete mit dt*8 und
   // BoatDynamics.setRudder() noch einmal mit festem 0.3 JE AUFRUF.
   const once = sail(600, SIM_DT, 1);
   const thrice = sail(600, SIM_DT, 3);
   const many = sail(600, SIM_DT, 17);
   eq(once.sig, thrice.sig, "ein setRudder() je Schritt == drei");
   eq(once.sig, many.sig, "== siebzehn");
   suite.note("frueher zog jeder Aufruf das Ruder um 30 % weiter - dreimal Rufen war dreimal Legen");
}

suite.section("Gleiche Schrittweite, gleiches Ergebnis");
{
   eq(sail(900, SIM_DT).sig, sail(900, SIM_DT).sig, "zweimal gerechnet, zweimal dasselbe");
   const a = sail(900, SIM_DT).b;
   const b = sail(900, SIM_DT).b;
   near(a.pos.x, b.pos.x, 0, "auf das letzte Bit dieselbe Position");
   near(a.heading, b.heading, 0, "derselbe Kurs");
}

suite.section("Der Glaetter selbst ist analytisch exakt");
{
   // approach() ist das Herzstueck. Wenn es dt-invariant ist, ist es die
   // ganze Eingabekette.
   const steps = (n, dt) => {
      let x = 0;
      for (let i = 0; i < n; i++) x = approach(x, 1, dt, RUDDER_TAU);
      return x;
   };
   near(steps(1, 0.5), steps(50, 0.01), 1e-12, "1 x 500 ms == 50 x 10 ms");
   near(steps(15, 1 / 30), steps(30, 1 / 60), 1e-12, "15 Schritte a 1/30 s == 30 a 1/60 s");
   near(steps(1, 1 / 30), 1 - Math.exp(-SIM_DT / RUDDER_TAU), 1e-15, "und trifft die Analytik");
}

suite.section("Wind ist eine reine Funktion der Simulationszeit");
{
   // Der Wind braucht gar nicht uebertragen zu werden: wer bei derselben
   // Tickzahl steht, sieht denselben Wind.
   const run = (dt, n) => {
      const w = new Wind({ dir: 20, speed: 16, variability: 1 });
      let t = 0;
      const out = [];
      for (let i = 0; i < n; i++) { t += dt; w.update(dt, t); out.push(w.dir, w.speed); }
      return { w, sig: fingerprint(out) };
   };
   eq(run(SIM_DT, 600).sig, run(SIM_DT, 600).sig, "reproduzierbar");
   // Bei gleicher Spielzeit steht er am selben Punkt, egal wie fein gerechnet wurde.
   const coarse = run(SIM_DT, 600).w;      // 20 s in 600 Schritten
   const fine = run(SIM_DT / 4, 2400).w;   // 20 s in 2400 Schritten
   near(coarse.dir, fine.dir, 1e-9, "nach 20 s dieselbe Richtung");
   near(coarse.speed, fine.speed, 1e-9, "und dieselbe Staerke");
}

suite.section("Der Seegang bleibt an der Schrittweite haengen - absichtlich");
{
   // SeaState integriert exponentiell und ist damit ueber verschiedene
   // Schrittweiten nur NAEHERUNGSWEISE gleich. Genau deshalb gehoert der
   // Zustand in den Snapshot (SeaSync) und wird nicht nachgerechnet.
   const run = (dt, n) => {
      const s = new SeaState(12);
      for (let i = 0; i < n; i++) s.step(dt, 28, 20);
      return s;
   };
   const coarse = run(SIM_DT, 900);      // 30 s
   const fine = run(SIM_DT / 8, 7200);   // 30 s
   // seaWind integriert exp(-dt/tau) und ist deshalb praktisch schrittweiten-
   // unabhaengig ...
   near(coarse.seaWind, fine.seaWind, 1e-9, "der nachlaufende Wind stimmt ueberein",
      Math.abs(coarse.seaWind - fine.seaWind).toExponential(2));
   // ... die Wellenphase dagegen summiert dt/sqrt(lambda), und lambda haengt an
   // seaWind. Ueber verschiedene Schrittweiten laeuft sie auseinander.
   ok(coarse.phaseT !== fine.phaseT,
      "die Wellenphase laeuft bei anderer Schrittweite auseinander",
      Math.abs(coarse.phaseT - fine.phaseT).toExponential(2) + " s");
   suite.note("genau darum ist der Wasserzustand Teil des Snapshots (SeaSync) und wird nicht nachgerechnet");
   eq(run(SIM_DT, 900).phaseT, run(SIM_DT, 900).phaseT, "bei gleicher Schrittweite exakt gleich");
}

suite.section("Ein langsamer Rechner rechnet dasselbe, nur spaeter");
{
   // 900 Schritte bleiben 900 Schritte - ob sie in 30 Frames zu je 30 oder in
   // 900 Frames zu je einem abgearbeitet werden, aendert nichts.
   const burst = (chunks) => {
      const b = new BoatDynamics({ vessel: VESSEL, heading: 110 });
      const trace = [];
      let tick = 0;
      for (const n of chunks) {
         for (let k = 0; k < n; k++) {
            b.setRudder(rudderAt(tick));
            b.step(SIM_DT, WIND);
            trace.push(b.heading, b.speed, b.pos.x, b.pos.z);
            tick++;
         }
      }
      return fingerprint(trace);
   };
   const smooth = burst(new Array(900).fill(1));         // 900 Frames zu 1 Schritt
   const stuttering = burst(chunked(900));               // unregelmaessige Bloecke
   const chunky = burst(new Array(180).fill(5));         // 180 Frames zu 5 Schritten
   eq(smooth, stuttering, "gleichmaessig oder ruckelnd - dieselbe Spur");
   eq(smooth, chunky, "und auch in Fuenferbloecken dieselbe");
}

function chunked(total) {
   // Unregelmaessige Bloecke, die sich auf `total` summieren.
   const out = [];
   let left = total;
   let i = 0;
   while (left > 0) {
      const n = Math.min(left, 1 + ((i * 7 + 3) % 5));
      out.push(n);
      left -= n;
      i++;
   }
   return out;
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
