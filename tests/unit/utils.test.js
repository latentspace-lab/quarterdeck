// tests/unit/utils.test.js - Winkel, Interpolation, dt-invariante Glaettung.
import {
   clamp, lerp, invLerp, smoothstep, normDeg, diffDeg, absDiffDeg,
   dirVec, interpTable, approach, approachHalfLife, DEG, RAD, KNOT_TO_MS,
} from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("utils");
const { ok, near, eq } = suite;

suite.section("Skalare");
eq(clamp(5, 0, 1), 1, "clamp deckelt oben");
eq(clamp(-5, 0, 1), 0, "clamp deckelt unten");
eq(clamp(0.5, 0, 1), 0.5, "clamp laesst durch");
eq(lerp(10, 20, 0.25), 12.5, "lerp");
eq(invLerp(10, 20, 12.5), 0.25, "invLerp ist die Umkehrung");
eq(smoothstep(0, 1, 0.5), 0.5, "smoothstep in der Mitte");
eq(smoothstep(0, 1, -3), 0, "smoothstep klemmt unten");
eq(smoothstep(0, 1, 3), 1, "smoothstep klemmt oben");

suite.section("Winkel");
eq(normDeg(-10), 350, "normDeg(-10)");
eq(normDeg(370), 10, "normDeg(370)");
eq(normDeg(0), 0, "normDeg(0)");
eq(diffDeg(350, 10), 20, "diffDeg ueber den Nullpunkt");
eq(diffDeg(10, 350), -20, "diffDeg rueckwaerts ueber den Nullpunkt");
eq(absDiffDeg(10, 350), 20, "absDiffDeg ist vorzeichenlos");
ok(Math.abs(diffDeg(0, 180)) === 180, "gegenueber liegt bei 180");
near(DEG * RAD, 1, 1e-12, "DEG und RAD sind zueinander invers");
near(KNOT_TO_MS, 0.514444, 1e-6, "ein Knoten in m/s");

suite.section("Richtungsvektoren (0 = Nord/+Z, 90 = Ost/+X)");
near(dirVec(0).z, 1, 1e-12, "Nord zeigt nach +Z");
near(dirVec(0).x, 0, 1e-12, "Nord hat kein X");
near(dirVec(90).x, 1, 1e-12, "Ost zeigt nach +X");
near(dirVec(180).z, -1, 1e-12, "Sued zeigt nach -Z");
for (const d of [0, 37, 91, 180, 271, 359]) {
   near(Math.hypot(dirVec(d).x, dirVec(d).z), 1, 1e-12, "dirVec(" + d + ") ist normiert");
}

suite.section("Tabellen-Interpolation");
const TAB = [[0, 0], [90, 10], [180, 0]];
eq(interpTable(0, TAB), 0, "Stuetzstelle links");
eq(interpTable(90, TAB), 10, "Stuetzstelle Mitte");
eq(interpTable(45, TAB), 5, "linear dazwischen");
eq(interpTable(135, TAB), 5, "linear im zweiten Abschnitt");
eq(interpTable(180, TAB), 0, "Stuetzstelle rechts");

// ---------------------------------------------------------------------------
suite.section("approach(): dt-invariante Glaettung");
// Das ist die Zusage, auf der Client-Prediction steht: die Glaettung darf nur
// von der verstrichenen Zeit abhaengen, nicht davon, in wie vielen Schritten
// sie verstrichen ist.
{
   const target = 100;
   const tau = 0.25;

   // Ein Schritt ueber 1 s gegen 100 Schritte ueber je 10 ms.
   let a = 0;
   a = approach(a, target, 1.0, tau);
   let b = 0;
   for (let i = 0; i < 100; i++) b = approach(b, target, 0.01, tau);
   near(a, b, 1e-9, "1 x 1000 ms == 100 x 10 ms");

   // Und gegen 30 Schritte zu 1/30 s - die echte Simulationsrate.
   let c = 0;
   for (let i = 0; i < 30; i++) c = approach(c, target, 1 / 30, tau);
   near(a, c, 1e-9, "1 x 1000 ms == 30 x 1/30 s");

   // Analytisch: nach tau sind 1 - 1/e des Abstands abgebaut.
   near(approach(0, 1, tau, tau), 1 - Math.exp(-1), 1e-12, "nach einem tau: 1-1/e");

   ok(approach(5, 5, 0.017, tau) === 5, "wer am Ziel ist, bleibt dort");
   eq(approach(0, 1, 0, tau), 0, "dt = 0 aendert nichts");
   near(approach(0, 1, 1e6, tau), 1, 1e-12, "sehr grosses dt landet am Ziel");
   near(approachHalfLife(0, 1, 0.3, 0.3), 0.5, 1e-12, "Halbwertszeit halbiert den Abstand");

   // Monotonie: die Annaeherung schiesst nie ueber das Ziel hinaus.
   let over = false;
   let x = 0;
   for (let i = 0; i < 500; i++) { x = approach(x, 1, 0.2, 0.05); if (x > 1 + 1e-12) over = true; }
   ok(!over, "kein Ueberschwingen, auch bei dt >> tau");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
