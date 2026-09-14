// tests/run.js - test runner.
//
// Three levels, deliberately kept separate because they answer different questions:
//
//   unit/        One module, one assertion. Fast, deterministic.
//                If something breaks here, you know right away where.
//   regression/  What must NOT change. Determinism, dt-invariance,
//                golden traces. These are the guarantees the multiplayer
//                rebuild rests on - they must be proven after every change.
//   integration/ Several modules over time: ship + battery + wreck + AI.
//                Slow, but it catches what happens between modules -
//                like the Vector3 breakage in the hit return value.
//
//   pending/     Cases for functions not yet built. Only runs with
//                --pending and does not count against the exit code.
//
// Usage:
//   node tests/run.js                 all three levels
//   node tests/run.js --unit          unit only
//   node tests/run.js --regression
//   node tests/run.js --integration
//   node tests/run.js --pending       also run the open cases
//   node tests/run.js utils physics   only suites whose path contains that
//
// npm scripts: test, test:unit, test:regression, test:integration, test:pending.
// CI (.github/workflows/test.yml) runs the levels separately, so the log
// shows immediately at which level it broke.

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
   console.error("No matching suite found.");
   process.exit(1);
}

process.env.QUARTERDECK_TEST_RUNNER = "1";

const results = [];
const t0 = Date.now();

for (const s of suites) {
   console.log("\n\x1b[1m┌─ " + s.id + "\x1b[0m");
   const started = Date.now();
   try {
      const mod = await import(pathToFileURL(s.file).href);
      const r = typeof mod.default === "function" ? await mod.default() : mod.result;
      if (!r) throw new Error("Suite returned no result (missing default export or `result`)");
      results.push({ ...r, id: s.id, level: s.level, ms: Date.now() - started });
   } catch (err) {
      console.error("\x1b[31m  ABORTED  " + (err && err.stack ? err.stack : err) + "\x1b[0m");
      results.push({
         id: s.id, level: s.level, pass: 0, fail: 1, ms: Date.now() - started,
         failures: ["Suite aborted: " + (err && err.message ? err.message : String(err))],
      });
   }
}

// --- Summary -----------------------------------------------------------
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
console.log(` ${pass} passed, ${fail} failed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (pendingFail) {
   console.log(` \x1b[33m${pendingFail} open cases in pending/ (do not count)\x1b[0m`);
}
if (fail) {
   console.log("\n\x1b[31mFailed:\x1b[0m");
   for (const r of results) {
      if (r.level === "pending") continue;
      for (const f of r.failures || []) console.log("  " + r.id + " › " + f);
   }
}
process.exit(fail ? 1 : 0);
