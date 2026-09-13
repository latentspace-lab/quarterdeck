// tests/run.js - Testlaeufer.
//
// Drei Ebenen, bewusst getrennt, weil sie verschiedene Fragen beantworten:
//
//   unit/        Ein Modul, eine Zusicherung. Schnell, deterministisch.
//                Faellt hier etwas um, weiss man sofort, wo.
//   regression/  Was sich NICHT aendern darf. Determinismus, dt-Invarianz,
//                Golden-Spuren. Das sind die Zusagen, auf denen der
//                Mehrspieler-Umbau steht - sie muessen bei jeder Aenderung
//                nachgewiesen werden.
//   integration/ Mehrere Module ueber Zeit: Schiff + Batterie + Wrack + KI.
//                Langsam, dafuer faengt es das, was zwischen den Modulen
//                passiert - wie der Vector3-Bruch in der Trefferrueckgabe.
//
//   pending/     Faelle fuer noch nicht gebaute Funktionen. Laeuft nur mit
//                --pending mit und zaehlt nicht gegen den Exit-Code.
//
// Aufruf:
//   node tests/run.js                 alle drei Ebenen
//   node tests/run.js --unit          nur Unit
//   node tests/run.js --regression
//   node tests/run.js --integration
//   node tests/run.js --pending       zusaetzlich die offenen Faelle
//   node tests/run.js utils physics   nur Suiten, deren Pfad das enthaelt
//
// npm-Skripte: test, test:unit, test:regression, test:integration, test:pending.
// Die CI (.github/workflows/test.yml) faehrt die Ebenen einzeln, damit im Log
// sofort sichtbar ist, auf welcher Ebene es bricht.

import { readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const LEVELS = ["unit", "regression", "integration"];

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const filters = argv.filter((a) => !a.startsWith("--"));

let levels = LEVELS.filter((l) => flags.has("--" + l));
if (!levels.length) levels = [...LEVELS];
if (flags.has("--pending")) levels.push("pending");

function suitesIn(level) {
   const dir = join(HERE, level);
   if (!existsSync(dir)) return [];
   return readdirSync(dir)
      .filter((f) => f.endsWith(".test.js"))
      .sort()
      .map((f) => ({ level, file: join(dir, f), id: level + "/" + f.replace(/\.test\.js$/, "") }));
}

const suites = levels
   .flatMap(suitesIn)
   .filter((s) => !filters.length || filters.some((f) => s.id.includes(f)));

if (!suites.length) {
   console.error("Keine passende Suite gefunden.");
   process.exit(1);
}

process.env.SEGEL_TEST_RUNNER = "1";

const results = [];
const t0 = Date.now();

for (const s of suites) {
   console.log("\n\x1b[1m┌─ " + s.id + "\x1b[0m");
   const started = Date.now();
   try {
      const mod = await import(pathToFileURL(s.file).href);
      const r = typeof mod.default === "function" ? await mod.default() : mod.result;
      if (!r) throw new Error("Suite liefert kein Ergebnis (default export oder `result` fehlt)");
      results.push({ ...r, id: s.id, level: s.level, ms: Date.now() - started });
   } catch (err) {
      console.error("\x1b[31m  ABBRUCH  " + (err && err.stack ? err.stack : err) + "\x1b[0m");
      results.push({
         id: s.id, level: s.level, pass: 0, fail: 1, ms: Date.now() - started,
         failures: ["Suite abgebrochen: " + (err && err.message ? err.message : String(err))],
      });
   }
}

// --- Zusammenfassung -------------------------------------------------------
const w = Math.max(...results.map((r) => r.id.length));
console.log("\n\x1b[1m" + "─".repeat(w + 34) + "\x1b[0m");
let pass = 0;
let fail = 0;
let pendingFail = 0;
for (const r of results) {
   const isPending = r.level === "pending";
   if (isPending) pendingFail += r.fail;
   else { pass += r.pass; fail += r.fail; }
   const mark = r.fail === 0 ? "\x1b[32m✓\x1b[0m" : isPending ? "\x1b[33m○\x1b[0m" : "\x1b[31m✗\x1b[0m";
   console.log(
      ` ${mark} ${r.id.padEnd(w)}  ${String(r.pass).padStart(4)} ok  ` +
         `${String(r.fail).padStart(3)} fail  ${String(r.ms).padStart(6)} ms`,
   );
}
console.log("\x1b[1m" + "─".repeat(w + 34) + "\x1b[0m");
console.log(` ${pass} bestanden, ${fail} gescheitert in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (pendingFail) {
   console.log(` \x1b[33m${pendingFail} offene Faelle in pending/ (zaehlen nicht)\x1b[0m`);
}
if (fail) {
   console.log("\n\x1b[31mFehlgeschlagen:\x1b[0m");
   for (const r of results) {
      if (r.level === "pending") continue;
      for (const f of r.failures || []) console.log("  " + r.id + " › " + f);
   }
}
process.exit(fail ? 1 : 0);
