// tests/integration/boot-smoke.test.js - startet das gebaute Spiel im Browser.
//
// Warum es diese Ebene braucht: alle anderen Suiten importieren Module
// einzeln. Ein FEHLENDER Import in game.js faellt dabei nie auf - erst der
// Browser fuehrt die Datei als Ganzes aus. Genau so ist auf main ein
// `voiceAnnounce(TRIGGER.ahoi)` ohne zugehoerigen Import stehengeblieben: der
// Simulator-Konstruktor warf eine ReferenceError, das Spiel startete nicht,
// und 600 gruene Unit-Tests haben es nicht gemerkt.
//
// Der Test braucht einen Build (npm run build) und Chromium. Fehlt eines von
// beidem, meldet er das und ueberspringt - er soll niemanden blockieren, der
// nur schnell die Physik pruefen will.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Boot-Smoke (Browser)");
const { ok, eq } = suite;

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "..", "packages", "client", "dist");
const BASE = "/sailing/";

const MIME = {
   ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
   ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
   ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
   ".woff2": "font/woff2", ".ico": "image/x-icon",
};

async function run() {
   if (!existsSync(join(DIST, "index.html"))) {
      suite.note("uebersprungen: kein Build unter packages/client/dist - erst `npm run build`");
      return suite.done();
   }

   let chromium;
   try {
      ({ chromium } = await import("playwright"));
   } catch {
      suite.note("uebersprungen: playwright ist nicht installiert");
      return suite.done();
   }

   const server = createServer(async (req, res) => {
      try {
         let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
         if (p.startsWith(BASE)) p = p.slice(BASE.length - 1);
         const file = join(DIST, normalize(p).replace(/^(\.\.[/\\])+/, ""));
         const target = (await stat(file).catch(() => null))?.isDirectory()
            ? join(file, "index.html")
            : file;
         const body = await readFile(target);
         res.writeHead(200, { "content-type": MIME[extname(target)] || "application/octet-stream" });
         res.end(body);
      } catch {
         res.writeHead(404).end("not found");
      }
   });
   await new Promise((r) => server.listen(0, "127.0.0.1", r));
   const url = `http://127.0.0.1:${server.address().port}${BASE}`;

   // Playwright bringt seine eigene Chromium-Version mit; ist die installierte
   // eine andere (wie im vorinstallierten Container), wird sie direkt benannt.
   const candidates = [
      process.env.CHROMIUM_PATH,
      process.env.PLAYWRIGHT_BROWSERS_PATH
         ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium")
         : null,
      undefined, // Playwright selbst suchen lassen
   ].filter((v) => v !== null);

   let browser;
   let launchErr = null;
   for (const executablePath of candidates) {
      try {
         browser = await chromium.launch({
            executablePath: executablePath || undefined,
            args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
         });
         break;
      } catch (err) {
         launchErr = err;
      }
   }
   if (!browser) {
      const err = launchErr || new Error("kein Chromium gefunden");
      suite.note("uebersprungen: Chromium laesst sich nicht starten (" + err.message.split("\n")[0] + ")");
      server.close();
      return suite.done();
   }

   const errors = [];
   const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
   page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
   page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });

   try {
      suite.section("Die Seite startet");
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2500);

      eq(errors.length, 0, "keine Fehler beim Laden",
         errors.length ? errors.slice(0, 3).join(" | ") : undefined);

      const booted = await page.evaluate(() => ({
         sim: !!window.__sim,
         menuOpen: window.__sim ? window.__sim.menuOpen : null,
         ships: [...document.querySelectorAll("button")].length,
      }));
      ok(booted.sim, "der Simulator wird erzeugt (window.__sim)");
      ok(booted.menuOpen === true, "und oeffnet das Startmenue");
      ok(booted.ships > 4, "das Menue bietet Schiffe an", booted.ships + " Schaltflaechen");

      suite.section("Die Schleife laeuft im Menue weiter");
      const t0 = await page.evaluate(() => window.__sim.t);
      await page.waitForTimeout(1200);
      const t1 = await page.evaluate(() => ({ t: window.__sim.t, phaseT: window.__sim.sea.phaseT }));
      ok(t1.t > t0, "die Simulationszeit laeuft", t0.toFixed(2) + " -> " + t1.t.toFixed(2) + " s");
      ok(t1.phaseT > 0, "und das Wasser bewegt sich auch im Menue", t1.phaseT.toFixed(2) + " s");

      suite.section("Ein Segeltoern");
      const started = await page.evaluate(() => {
         const all = [...document.querySelectorAll("button")];
         const go = all.filter((b) => b.textContent.includes("·") && b.textContent.trim().length < 40).pop();
         if (!go) return null;
         go.click();
         return go.textContent.trim();
      });
      ok(started, "die Startschaltflaeche laesst sich druecken", started);
      await page.waitForTimeout(6000);

      const s = await page.evaluate(() => {
         const sim = window.__sim;
         return {
            menuOpen: sim.menuOpen,
            speed: sim.boat.speed,
            heading: sim.boat.heading,
            modelY: sim.player.model.position.y,
            hasPoses: !!(sim.player._poseCurr && sim.player._posePrev),
            seaWind: sim.sea.seaWind,
            rendererCalls: sim.renderer.info.render.calls,
         };
      });
      eq(s.menuOpen, false, "das Menue schliesst sich");
      ok(s.speed > 0.5, "das Boot nimmt Fahrt auf", s.speed.toFixed(2) + " kn");
      ok(Number.isFinite(s.heading) && Number.isFinite(s.modelY), "Kurs und Lage sind endlich");
      ok(s.hasPoses, "die Interpolation hat zwei Lagen (Phase 0B')");
      ok(s.rendererCalls > 0, "es wird tatsaechlich gezeichnet", s.rendererCalls + " Draw-Calls");
      eq(errors.length, 0, "auch beim Segeln keine Fehler",
         errors.length ? errors.slice(0, 3).join(" | ") : undefined);

      suite.section("Die Ruderglaettung greift");
      // Echte Tastendruecke statt synthetischer Events - der Test soll den
      // Weg gehen, den ein Spieler geht.
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(1500);
      const turning = await page.evaluate(() => ({ rudder: window.__sim.boat.rudder }));
      ok(turning.rudder > 0.5, "die Taste legt das Ruder um", turning.rudder.toFixed(3));
      await page.keyboard.up("ArrowRight");
      await page.waitForTimeout(1500);
      const centred = await page.evaluate(() => window.__sim.boat.rudder);
      ok(Math.abs(centred) < 0.2, "und laesst es wieder mittschiffs laufen", centred.toFixed(3));
   } finally {
      await browser.close().catch(() => {});
      server.close();
   }
   return suite.done();
}

export default run;

if (!process.env.SEGEL_TEST_RUNNER) await run();
