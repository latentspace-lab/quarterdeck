// tests/unit/rng.test.js - deterministic randomness.
import { makeRng, deriveRng, gauss } from "@quarterdeck/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("rng");
const { ok, near, eq } = suite;

const draw = (rng, n) => Array.from({ length: n }, () => rng());

suite.section("mulberry32");
{
   const a = draw(makeRng(12345), 500);
   const b = draw(makeRng(12345), 500);
   eq(fingerprint(a), fingerprint(b), "same seed, same sequence");

   const c = draw(makeRng(12346), 500);
   ok(fingerprint(a) !== fingerprint(c), "different seed, different sequence");

   ok(a.every((v) => v >= 0 && v < 1), "all values in [0, 1)");

   const mean = a.reduce((s, v) => s + v, 0) / a.length;
   near(mean, 0.5, 0.05, "mean close to 0.5");

   // Roughly check the uniform distribution: ten bins, none should be
   // empty or twice as full as expected.
   const bins = new Array(10).fill(0);
   for (const v of draw(makeRng(7), 10000)) bins[Math.floor(v * 10)]++;
   ok(bins.every((n) => n > 700 && n < 1300), "ten bins roughly evenly filled", bins.join(" "));

   ok(makeRng(0)() !== undefined && Number.isFinite(makeRng(0)()), "seed 0 gives a number");
}

suite.section("deriveRng(): separate streams from one seed");
{
   const dmg = deriveRng(99, "ship-a:damage");
   const crew = deriveRng(99, "ship-a:crew");
   ok(fingerprint(draw(dmg, 200)) !== fingerprint(draw(crew, 200)),
      "different labels give different streams");

   eq(fingerprint(draw(deriveRng(99, "x"), 200)), fingerprint(draw(deriveRng(99, "x"), 200)),
      "same label, same stream");
   ok(fingerprint(draw(deriveRng(1, "x"), 200)) !== fingerprint(draw(deriveRng(2, "x"), 200)),
      "same label, different seed");

   // The actual point: the damage model must not steal numbers from the
   // world generator. So one stream must stay independent of the other's use.
   const a1 = deriveRng(5, "a");
   const b1 = deriveRng(5, "b");
   const takeA = draw(a1, 50);
   draw(b1, 137);            // use b heavily
   const a2 = deriveRng(5, "a");
   eq(fingerprint(takeA), fingerprint(draw(a2, 50)), "stream A stays untouched by stream B");
}

suite.section("gauss(): normal distribution from a uniform one");
{
   const rng = makeRng(2024);
   const xs = Array.from({ length: 20000 }, () => gauss(rng));
   const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
   const sd = Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length);
   near(mean, 0, 0.05, "mean ~ 0", mean.toFixed(4));
   near(sd, 1, 0.05, "standard deviation ~ 1", sd.toFixed(4));
   const within1 = xs.filter((v) => Math.abs(v) < 1).length / xs.length;
   near(within1, 0.6827, 0.02, "68 % within one sigma", (within1 * 100).toFixed(1) + " %");
   ok(xs.every(Number.isFinite), "no NaN/Infinity");

   eq(fingerprint([gauss(makeRng(3))]), fingerprint([gauss(makeRng(3))]), "gauss is reproducible");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
