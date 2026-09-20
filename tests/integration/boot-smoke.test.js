// tests/integration/boot-smoke.test.js - starts the built game in a browser.
//
// Why this layer is needed: every other suite imports modules individually.
// A MISSING import in game.js never shows up that way - only the browser
// runs the file as a whole. That is exactly how a
// `voiceAnnounce(TRIGGER.ahoi)` without its import ended up stuck on main:
// the Simulator constructor threw a ReferenceError, the game never started,
// and 600 green unit tests never noticed.
//
// This test needs a build (npm run build) and Chromium. Missing either, it
// reports that and skips - it should not block anyone who just wants to
// check the physics quickly.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Boot smoke (browser)");
const { ok, eq } = suite;

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, "..", "..", "packages", "client", "dist");
const BASE = "/quarterdeck/";

const MIME = {
   ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
   ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg",
   ".svg": "image/svg+xml", ".ogg": "audio/ogg", ".mp3": "audio/mpeg",
   ".woff2": "font/woff2", ".ico": "image/x-icon",
};

async function run() {
   if (!existsSync(join(DIST, "index.html"))) {
      suite.note("skipped: no build under packages/client/dist - run `npm run build` first");
      return suite.done();
   }

   let chromium;
   try {
      ({ chromium } = await import("playwright"));
   } catch {
      suite.note("skipped: playwright is not installed");
      return suite.done();
   }

   const server = createServer(async (req, res) => {
      try {
         let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
         // Serve only under BASE, exactly as the dev server and GitHub Pages
         // do. A hard-coded root path like /sounds/x.ogg must 404 here, or the
         // suite would pass on URLs that are broken in a real deployment.
         if (!p.startsWith(BASE)) { res.writeHead(404).end("outside base"); return; }
         p = p.slice(BASE.length - 1);
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
   // ?voice=1: the voice lines are off by default, but their wiring is
   // checked here so they still work when switched back on.
   const url = `http://127.0.0.1:${server.address().port}${BASE}?voice=1`;

   // Playwright ships its own Chromium build; if the installed one is
   // different (as in the pre-installed container), name it directly.
   const candidates = [
      process.env.CHROMIUM_PATH,
      process.env.PLAYWRIGHT_BROWSERS_PATH
         ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium")
         : null,
      undefined, // let Playwright find it itself
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
      const err = launchErr || new Error("no Chromium found");
      suite.note("skipped: Chromium won't launch (" + err.message.split("\n")[0] + ")");
      server.close();
      return suite.done();
   }

   const errors = [];
   const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
   page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));
   page.on("console", (m) => { if (m.type() === "error" && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });

   try {
      suite.section("The page starts");
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForTimeout(2500);

      eq(errors.length, 0, "no errors while loading",
         errors.length ? errors.slice(0, 3).join(" | ") : undefined);

      const booted = await page.evaluate(() => ({
         sim: !!window.__sim,
         menuOpen: window.__sim ? window.__sim.menuOpen : null,
         ships: [...document.querySelectorAll("button")].length,
      }));
      ok(booted.sim, "the simulator is created (window.__sim)");
      ok(booted.menuOpen === true, "and opens the start menu");
      ok(booted.ships > 4, "the menu offers ships", booted.ships + " buttons");

      suite.section("A sailing trip");
      await page.evaluate(() => document.getElementById("splash")?.remove());
      // A player's first touch is the splash or a ship card, not Start: that
      // is the gesture that unlocks audio while the menu is still open.
      await page.mouse.click(20, 20);
      await page.waitForTimeout(1500);
      const started = await page.evaluate(() => {
         const all = [...document.querySelectorAll("button")];
         const go = all.filter((b) => b.textContent.includes("·") && b.textContent.trim().length < 40).pop();
         if (!go) return null;
         go.id = "__start";
         return go.textContent.trim();
      });
      ok(started, "the start button can be pressed", started);
      // A real click, not element.click(): only a trusted pointer event counts
      // as the user activation that lets the browser start audio.
      await page.click("#__start");
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
      eq(s.menuOpen, false, "the menu closes");
      ok(s.speed > 0.5, "the boat gathers way", s.speed.toFixed(2) + " kn");
      ok(Number.isFinite(s.heading) && Number.isFinite(s.modelY), "course and pose are finite");
      ok(s.hasPoses, "the interpolation has two poses (Phase 0B')");
      ok(s.rendererCalls > 0, "something is actually being drawn", s.rendererCalls + " draw calls");
      eq(errors.length, 0, "no errors while sailing either",
         errors.length ? errors.slice(0, 3).join(" | ") : undefined);

      // The soundtrack is fetched over HTTP like any other asset, so a wrong
      // base path or a renamed file shows up here and nowhere else.
      suite.section("The soundtrack plays");
      const music = await page.evaluate(() => {
         const st = window.__sim.soundtrack;
         return {
            preloaded: st._preloaded,
            bytes: Object.values(st._raw).map((b) => b.byteLength),
            playing: st.playing,
            current: st.currentTrack,
            looping: st._current ? st._current.source.loop : null,
         };
      });
      ok(music.preloaded, "the track list preloaded");
      ok(music.bytes.length > 0 && music.bytes.every((n) => n > 0),
         "the audio file was actually fetched", music.bytes.join(", ") + " bytes");
      ok(music.playing, "music is playing after the first interaction");
      eq(music.current, "the-royal-navy", "and it is The Royal Navy");
      eq(music.looping, false, "the opening track does not loop");

      // A playing flag only proves start() was called. Tap the output and
      // measure real signal, so a silent or empty buffer cannot pass.
      const signal = await page.evaluate(async () => {
         const st = window.__sim.soundtrack;
         const an = st._ctx.createAnalyser();
         an.fftSize = 2048;
         st._gain.connect(an);
         const buf = new Float32Array(an.fftSize);
         let peak = 0;
         for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 60));
            an.getFloatTimeDomainData(buf);
            for (const v of buf) if (Math.abs(v) > peak) peak = Math.abs(v);
         }
         return { state: st._ctx.state, peak: +peak.toFixed(5) };
      });
      eq(signal.state, "running", "the audio context is running");
      ok(signal.peak > 0.001, "and real audio samples are flowing", "peak " + signal.peak);

      suite.section("The voice lines");
      const voice = await page.evaluate(() => {
         const v = window.__sim.voice;
         return {
            loaded: v.loaded("GB"),
            count: Object.keys(v._buffers).filter((k) => k.startsWith("GB:")).length,
            ahoy: !!v._lastPlayed["GB:ahoi"],
         };
      });
      ok(voice.loaded, "the Royal Navy set is decoded", voice.count + " lines");
      ok(voice.ahoy, "\"Ahoy\" was spoken for the open menu on the first interaction");

      suite.section("The rudder smoothing kicks in");
      // Real key presses instead of synthetic events - the test should take
      // the path a player takes.
      await page.keyboard.down("ArrowRight");
      await page.waitForTimeout(1500);
      const turning = await page.evaluate(() => ({ rudder: window.__sim.boat.rudder }));
      ok(turning.rudder > 0.5, "the key puts the rudder over", turning.rudder.toFixed(3));
      await page.keyboard.up("ArrowRight");
      await page.waitForTimeout(1500);
      const centred = await page.evaluate(() => window.__sim.boat.rudder);
      ok(Math.abs(centred) < 0.2, "and lets it run back amidships", centred.toFixed(3));
   } finally {
      await browser.close().catch(() => {});
      server.close();
   }
   return suite.done();
}

export default run;

if (!process.env.QUARTERDECK_TEST_RUNNER) await run();
