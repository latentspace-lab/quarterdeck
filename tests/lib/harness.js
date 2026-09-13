// tests/lib/harness.js - gemeinsames Geruest fuer alle Suiten.
//
// Bewusst winzig und ohne Abhaengigkeiten: `node tests/<datei>` soll eine
// einzelne Suite direkt ausfuehren koennen, ohne Runner, ohne Installation.
// Der Runner (tests/run.js) sammelt nur die Ergebnisse ein.

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
      /** Abschnittsueberschrift. */
      section(title) {
         console.log("\n" + c("head", "== " + title + " =="));
      },
      /** Grundbaustein: Bedingung muss wahr sein. */
      ok: record,
      /** Strikte Gleichheit. */
      eq(actual, expected, msg) {
         return record(
            Object.is(actual, expected),
            msg,
            Object.is(actual, expected) ? undefined : `erwartet ${fmt(expected)}, war ${fmt(actual)}`,
         );
      },
      /** Gleichheit im Rahmen einer Toleranz - fuer alles, was gerechnet wird. */
      near(actual, expected, eps, msg) {
         const d = Math.abs(actual - expected);
         return record(
            d <= eps,
            msg,
            d <= eps ? d.toExponential(1) : `erwartet ${fmt(expected)} +-${eps}, war ${fmt(actual)} (Abw. ${d.toExponential(2)})`,
         );
      },
      /** Tiefe Gleichheit ueber JSON - fuer Zustands-Schnappschuesse. */
      deepEq(actual, expected, msg) {
         const a = JSON.stringify(actual);
         const b = JSON.stringify(expected);
         return record(a === b, msg, a === b ? undefined : `erwartet ${trunc(b)}, war ${trunc(a)}`);
      },
      /** Der Aufruf muss werfen. */
      throws(fn, msg) {
         let threw = false;
         try { fn(); } catch { threw = true; }
         return record(threw, msg);
      },
      /** Reine Notiz, zaehlt nicht als Zusicherung. */
      note(text) {
         console.log("        " + c("dim", text));
      },
      get counts() {
         return { pass, fail, failures };
      },
      /**
       * Abschluss. Als Einzelaufruf setzt es den Exit-Code; unter dem Runner
       * liefert es nur die Zahlen zurueck.
       */
      done() {
         const line = `=== ${name}: ${pass} bestanden, ${fail} gescheitert ===`;
         console.log("\n" + (fail ? c("fail", line) : c("ok", line)));
         if (!process.env.SEGEL_TEST_RUNNER && fail) process.exitCode = 1;
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
 * Kompakter Fingerabdruck eines Zustands. Fuer Golden-Tests: eine Zahlenfolge
 * wird auf eine kurze Hex-Signatur reduziert, die sich bei jeder Abweichung
 * aendert. FNV-1a ueber die auf 6 Nachkommastellen gerundeten Werte - damit
 * schlaegt nicht jedes Bit im letzten Digit an.
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
