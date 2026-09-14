// tests/lib/harness.js - shared scaffolding for all suites.
//
// Deliberately tiny and without dependencies: `node tests/<file>` should be
// able to run a single suite directly, without a runner, without installing
// anything. The runner (tests/run.js) just collects the results.

const COL = {
   ok: "\x1b[32m",
   fail: "\x1b[31m",
   dim: "\x1b[2m",
   head: "\x1b[1m",
   off: "\x1b[0m",
};
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (k, s) => (useColor ? COL[k] + s + COL.off : s);

export function createSuite(name) {
   let pass = 0;
   let fail = 0;
   const failures = [];

   function record(cond, msg, extra) {
      const tail = extra !== undefined && extra !== null && extra !== "" ? "   [" + extra + "]" : "";
      if (cond) {
         pass++;
         console.log("  " + c("ok", "ok  ") + "  " + msg + c("dim", tail));
      } else {
         fail++;
         failures.push(msg + tail);
         console.error("  " + c("fail", "FAIL") + "  " + msg + tail);
      }
      return !!cond;
   }

   const api = {
      name,
      /** Section heading. */
      section(title) {
         console.log("\n" + c("head", "== " + title + " =="));
      },
      /** Basic building block: the condition must be true. */
      ok: record,
      /** Strict equality. */
      eq(actual, expected, msg) {
         return record(
            Object.is(actual, expected),
            msg,
            Object.is(actual, expected) ? undefined : `expected ${fmt(expected)}, got ${fmt(actual)}`,
         );
      },
      /** Equality within a tolerance - for anything that's computed. */
      near(actual, expected, eps, msg) {
         const d = Math.abs(actual - expected);
         return record(
            d <= eps,
            msg,
            d <= eps ? d.toExponential(1) : `expected ${fmt(expected)} +-${eps}, got ${fmt(actual)} (diff ${d.toExponential(2)})`,
         );
      },
      /** Deep equality via JSON - for state snapshots. */
      deepEq(actual, expected, msg) {
         const a = JSON.stringify(actual);
         const b = JSON.stringify(expected);
         return record(a === b, msg, a === b ? undefined : `expected ${trunc(b)}, got ${trunc(a)}`);
      },
      /** The call must throw. */
      throws(fn, msg) {
         let threw = false;
         try { fn(); } catch { threw = true; }
         return record(threw, msg);
      },
      /** Pure note, does not count as an assertion. */
      note(text) {
         console.log("        " + c("dim", text));
      },
      get counts() {
         return { pass, fail, failures };
      },
      /**
       * Wrap-up. As a standalone call it sets the exit code; under the
       * runner it just returns the numbers.
       */
      done() {
         const line = `=== ${name}: ${pass} passed, ${fail} failed ===`;
         console.log("\n" + (fail ? c("fail", line) : c("ok", line)));
         if (!process.env.QUARTERDECK_TEST_RUNNER && fail) process.exitCode = 1;
         return { name, pass, fail, failures };
      },
   };
   return api;
}

function fmt(v) {
   if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toPrecision(6);
   return JSON.stringify(v);
}
function trunc(s, n = 160) {
   return s && s.length > n ? s.slice(0, n) + "…" : s;
}

/**
 * Compact fingerprint of a state. For golden tests: a sequence of numbers
 * is reduced to a short hex signature that changes on any deviation.
 * FNV-1a over the values rounded to 6 decimal places - so not every bit in
 * the last digit trips it.
 */
export function fingerprint(values, digits = 6) {
   let h = 0x811c9dc5;
   for (const v of values) {
      const s = typeof v === "number" ? v.toFixed(digits) : String(v);
      for (let i = 0; i < s.length; i++) {
         h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
      }
      h = Math.imul(h ^ 0x2c, 0x01000193) >>> 0;
   }
   return (h >>> 0).toString(16).padStart(8, "0");
}
