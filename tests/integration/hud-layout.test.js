// tests/integration/hud-layout.test.js - the HUD in the built game.
//
// The HUD is one innerHTML template plus a stylesheet; no unit test sees it
// render. This suite opens the built client in Chromium, starts a battle
// through the real menu and checks what a player would: the orders panel is
// gone and the readouts themselves take the orders (the battery fires, the
// helm buttons steer), the panels fold and unfold, a hit unfolds the hull
// panel by itself, and a fold survives a reload. Skips without a build or
// a browser, like the other browser suites.
//
// Every wait here is on a condition, never a fixed sleep, and the timeouts
// are generous: under software GL on the CI runner a frame can take a
// second or more, and the game only acts on a click at the next frame.
// Buttons are pressed with an in-page click(): the runner's pointer
// hit-testing proved unreliable, and the wiring behind the button is what
// this suite is about.
import { serveDist, launchChromium, watchErrors } from "../lib/browser.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("HUD layout (browser)");
const { ok, eq } = suite;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SLOW = 60000;
const press = (page, sel) => page.evaluate((s) => document.querySelector(s).click(), sel);

/** Start a battle in a frigate the way a player does: mode card, ship card, Start. */
async function boot(page, url) {
   await page.goto(url + "?random=0", { waitUntil: "load", timeout: 30000 });
   await page.waitForFunction(() => window.__sim && window.__sim.menuOpen, null, { timeout: SLOW });
   await page.evaluate(() => document.getElementById("splash")?.remove());
   await page.click(".mode-btn[data-mode='Battle']");
   await page.click(".ship-btn[data-vessel='lydia']");
   await page.click("#menuStart");
   await page.waitForFunction(() => window.__sim.menuOpen === false, null, { timeout: SLOW });
   // The HUD is filled on the first frame after the start; wait for it.
   await page.waitForFunction(() => document.querySelector("#gunStateP").textContent === "READY"
      && document.querySelector("#gunPipsP .pip"), null, { timeout: SLOW });
}

async function run() {
   const site = await serveDist();
   if (!site) {
      suite.note("skipped: no build under packages/client/dist - run `npm run build`");
      return suite.done();
   }
   const { browser, reason } = await launchChromium();
   if (!browser) {
      suite.note("skipped: " + reason);
      site.close();
      return suite.done();
   }
   const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
   const errors = watchErrors(page);
   const shown = (sel) => page.evaluate((s) => {
      const el = document.querySelector(s);
      return !!el && getComputedStyle(el).display !== "none";
   }, sel);
   try {
      await boot(page, site.url);

      suite.section("The orders panel is gone; the readouts stand in columns");
      const gone = await page.evaluate(() => ({
         cmdPanel: !!document.querySelector("#cmdPanel"),
         vessel: !!document.querySelector("#cmdVessel") || !!document.querySelector("[data-cmd='cycleVessel']"),
         hints: document.querySelectorAll("#hud .hint").length,
         left: !!document.querySelector("#hud-left"),
         right: !!document.querySelector("#hud-right"),
         tabs: [...document.querySelectorAll("#hud-tabs button")].map((b) => b.dataset.cmd).join(","),
      }));
      eq(gone.cmdPanel, false, "no Captain's Orders panel");
      eq(gone.vessel, false, "no 'Change ship' button");
      eq(gone.hints, 0, "no key-hint lines in the HUD");
      ok(gone.left && gone.right, "the panels sit in a left and a right column");
      eq(gone.tabs, "toggleMenu,cycleCamera", "Menu and View are the tabs in the bottom-right corner");
      const anchored = await page.evaluate(() => {
         const r = (s) => document.querySelector(s).getBoundingClientRect();
         return { gun: r("#gunPanel").bottom, conn: r("#conn").bottom, h: innerHeight, foe: r("#foePanel").bottom, wind: r("#windPanel").bottom };
      });
      ok(anchored.h - anchored.gun < 40 && anchored.foe < anchored.gun, "the battery is anchored at the bottom left, below the readouts");
      ok(anchored.h - anchored.conn < 80 && anchored.wind < anchored.conn, "the conn is anchored at the bottom right, below the readouts");
      for (const id of ["#gunPanel", "#shipPanel", "#crewPanel", "#foePanel", "#windPanel", "#conn"]) {
         ok(await shown(id), id + " is shown in a battle");
      }
      eq(errors.length, 0, "no errors while starting", errors.slice(0, 3).join(" | "));

      suite.section("The battery is the gunnery control");
      await press(page, "#cmdFireP");
      await page.waitForFunction(() => window.__sim.player.battery.broadsides >= 1, null, { timeout: SLOW });
      await page.waitForFunction(() => /LOADING/.test(document.querySelector("#gunStateP").textContent), null, { timeout: SLOW });
      const fired = await page.evaluate(() => ({
         disabled: document.querySelector("#cmdFireP").disabled,
         state: document.querySelector("#gunStateP").textContent,
         stbd: document.querySelector("#gunStateS").textContent,
      }));
      eq(fired.disabled, true, "the port row is disabled while it reloads");
      ok(/LOADING/.test(fired.state), "and reads LOADING", fired.state);
      eq(fired.stbd, "READY", "the starboard row still reads READY");
      const pips = await page.evaluate(() => ({
         guns: window.__sim.battery.status().guns,
         port: document.querySelectorAll("#gunPipsP .pip").length,
         out: document.querySelectorAll("#gunPipsP .pip.out").length,
      }));
      eq(pips.port, pips.guns, "one pip per gun of the port battery", pips.guns + " guns");
      eq(pips.out, 0, "and none of them knocked out yet");
      await press(page, "#ammoRow button[data-cmd='ammo:chain']");
      await page.waitForFunction(() => window.__sim.battery.status().ammo.id === "chain"
         && document.querySelector("#ammoRow button[data-cmd='ammo:chain']").classList.contains("on"), null, { timeout: SLOW });
      const loaded = await page.evaluate(() => ({
         ammo: window.__sim.battery.status().ammo.id,
         on: [...document.querySelectorAll("#ammoRow button")].filter((b) => b.classList.contains("on")).map((b) => b.textContent).join(","),
      }));
      eq(loaded.ammo, "chain", "clicking the chip loads chain shot");
      eq(loaded.on, "Chain", "and only that chip is lit");

      suite.section("The conn offers only what applies");
      const right = await page.evaluate(() => ({
         hidden: document.querySelector("#cmdRight").hidden,
         display: getComputedStyle(document.querySelector("#cmdRight")).display,
         cut: getComputedStyle(document.querySelector("#cmdCut")).display,
         sail: document.querySelector("#cmdSailIn .l").textContent,
      }));
      ok(right.hidden && right.display === "none", "'Right the ship' is not offered while she is upright");
      eq(right.cut, "none", "'Cut away wreck' is not offered without a wreck");
      eq(right.sail, "Set sail", "a square-rigger sets sail rather than trimming");

      suite.section("The hull panel folds and remembers it");
      ok(!(await page.evaluate(() => document.querySelector("#shipPanel").classList.contains("is-collapsed"))),
         "the ship's panel starts open");
      await press(page, "#shipPanel .panel-head");
      await page.waitForFunction(() => document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: SLOW });
      const folded = await page.evaluate(() => ({
         collapsed: document.querySelector("#shipPanel").classList.contains("is-collapsed"),
         sum: document.querySelector("#dmgSum").textContent,
         body: getComputedStyle(document.querySelector("#shipPanel .panel-body")).display,
         stored: JSON.parse(localStorage.getItem("quarterdeck.hud") || "{}"),
      }));
      eq(folded.collapsed, true, "a click on the head folds it");
      ok(/Hull \d+% · Leak \d+%/.test(folded.sum), "the head sums it up", folded.sum);
      eq(folded.body, "none", "the body is hidden");
      eq(folded.stored.dmg, false, "the choice is stored");
      await press(page, "#shipPanel .panel-head");
      await page.waitForFunction(() => !document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: SLOW });
      ok(true, "a second click opens it again");

      suite.section("A leak unfolds the hull panel by itself");
      await press(page, "#shipPanel .panel-head");
      await page.waitForFunction(() => document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: SLOW });
      await page.evaluate(() => { window.__sim.player.dmg.flooding = 0.3; });
      await page.waitForFunction(() => !document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: SLOW });
      const why = await page.evaluate(() => document.querySelector("#shipPanel .panel-why").textContent);
      ok(/taking water/.test(why), "water in the ship opens the folded panel and says so", why);
      await page.waitForFunction(() => document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: SLOW });
      ok(true, "and it folds again once the news is old");

      suite.section("The fold survives a reload");
      await boot(page, site.url);
      const again = await page.evaluate(() => ({
         collapsed: document.querySelector("#shipPanel").classList.contains("is-collapsed"),
         port: document.querySelector("#gunStateP").textContent,
      }));
      eq(again.collapsed, true, "hull condition stays folded after a reload");
      eq(again.port, "READY", "the battery is ready in the new battle");
      eq(errors.length, 0, "no errors in the whole run", errors.slice(0, 3).join(" | "));
   } finally {
      await browser.close().catch(() => {});
      site.close();
   }
   return suite.done();
}

export default run;

if (!process.env.QUARTERDECK_TEST_RUNNER) await run();
