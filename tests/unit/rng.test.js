// tests/unit/rng.test.js - deterministischer Zufall.
import { makeRng, deriveRng, gauss } from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("rng");
const { ok, near, eq } = suite;

const draw = (rng, n) => Array.from({ length: n }, () => rng());

suite.section("mulberry32");
{
   const a = draw(makeRng(12345), 500);
   const b = draw(makeRng(12345), 500);
   eq(fingerprint(a), fingerprint(b), "gleicher Seed, gleiche Folge");

   const c = draw(makeRng(12346), 500);
   ok(fingerprint(a) !== fingerprint(c), "anderer Seed, andere Folge");

   ok(a.every((v) => v >= 0 && v < 1), "alle Werte in [0, 1)");

   const mean = a.reduce((s, v) => s + v, 0) / a.length;
   near(mean, 0.5, 0.05, "Mittelwert nahe 0.5");

   // Gleichverteilung grob pruefen: zehn Faecher, keines darf leer oder
   // doppelt so voll wie erwartet sein.
   const bins = new Array(10).fill(0);
   for (const v of draw(makeRng(7), 10000)) bins[Math.floor(v * 10)]++;
   ok(bins.every((n) => n > 700 && n < 1300), "zehn Faecher halbwegs gleich besetzt", bins.join(" "));

   ok(makeRng(0)() !== undefined && Number.isFinite(makeRng(0)()), "Seed 0 liefert eine Zahl");
}

suite.section("deriveRng(): getrennte Stroeme aus einem Seed");
{
   const dmg = deriveRng(99, "ship-a:damage");
   const crew = deriveRng(99, "ship-a:crew");
   ok(fingerprint(draw(dmg, 200)) !== fingerprint(draw(crew, 200)),
      "verschiedene Label ergeben verschiedene Stroeme");

   eq(fingerprint(draw(deriveRng(99, "x"), 200)), fingerprint(draw(deriveRng(99, "x"), 200)),
      "gleiches Label, gleicher Strom");
   ok(fingerprint(draw(deriveRng(1, "x"), 200)) !== fingerprint(draw(deriveRng(2, "x"), 200)),
      "gleicher Label, anderer Seed");

   // Der eigentliche Zweck: das Schadensmodell darf dem Weltgenerator keine
   // Zahlen wegnehmen. Also muss ein Strom unabhaengig von der Nutzung des
   // anderen bleiben.
   const a1 = deriveRng(5, "a");
   const b1 = deriveRng(5, "b");
   const takeA = draw(a1, 50);
   draw(b1, 137);            // b ausgiebig benutzen
   const a2 = deriveRng(5, "a");
   eq(fingerprint(takeA), fingerprint(draw(a2, 50)), "Strom A bleibt von Strom B unberuehrt");
}

suite.section("gauss(): normalverteilt aus gleichverteilt");
{
   const rng = makeRng(2024);
   const xs = Array.from({ length: 20000 }, () => gauss(rng));
   const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
   const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
   near(mean, 0, 0.05, "Mittelwert ~ 0", mean.toFixed(4));
   near(sd, 1, 0.05, "Standardabweichung ~ 1", sd.toFixed(4));
   const within1 = xs.filter((v) => Math.abs(v) < 1).length / xs.length;
   near(within1, 0.6827, 0.02, "68 % innerhalb einer Sigma", (within1 * 100).toFixed(1) + " %");
   ok(xs.every(Number.isFinite), "keine NaN/Infinity");

   eq(fingerprint([gauss(makeRng(3))]), fingerprint([gauss(makeRng(3))]), "gauss ist reproduzierbar");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
