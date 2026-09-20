// tests/integration/hud-layout.test.js - the HUD in the built game.
//
// The HUD is one innerHTML template plus a stylesheet; no unit test sees it
// render. This suite opens the built client in Chromium, starts a battle
// through the real menu and checks what a player would: the orders panel is
// gone and the readouts themselves take the orders (the battery fires, the
// helm buttons steer), the panels fold and unfold, a hit unfolds the hull
// panel by itself, and a fold survives a reload. Skips without a build or
// a browser, like the other browser suites.
import { serveDist, launchChromium, watchErrors } from "../lib/browser.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("HUD layout (browser)");
const { ok, eq } = suite;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start a battle in a frigate the way a player does: mode card, ship card, Start. */
async function boot(page, url) {
   await page.goto(url + "?random=0", { waitUntil: "load", timeout: 30000 });
   await page.waitForFunction(() => window.__sim && window.__sim.menuOpen, null, { timeout: 15000 });
   await page.evaluate(() => document.getElementById("splash")?.remove());
   await page.click(".mode-btn[data-mode='Battle']");
   await page.click(".ship-btn[data-vessel='lydia']");
   await page.click("#menuStart");
   await page.waitForFunction(() => window.__sim.menuOpen === false, null, { timeout: 5000 });
   await sleep(1500);
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
   const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
      eq(gone.tabs, "toggleMenu,cycleCamera", "Menu and View are the tabs under the compass");
      for (const id of ["#gunPanel", "#shipPanel", "#crewPanel", "#foePanel", "#windPanel", "#conn"]) {
         ok(await shown(id), id + " is shown in a battle");
      }
      eq(errors.length, 0, "no errors while starting", errors.slice(0, 3).join(" | "));

      suite.section("The battery is the gunnery control");
      await page.click("#cmdFireP");
      await page.waitForFunction(() => window.__sim.player.battery.broadsides >= 1, null, { timeout: 4000 });
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
      await page.click("#ammoRow button[data-cmd='ammo:chain']");
      await sleep(300);
      const loaded = await page.evaluate(() => ({
         ammo: window.__sim.battery.status().ammo.id,
         on: [...document.querySelectorAll("#ammoRow button")].filter((b) => b.classList.contains("on")).map((b) => b.textContent).join(","),
      }));
      eq(loaded.ammo, "chain", "clicking the chip loads chain shot");
      eq(loaded.on, "Chain", "and only that chip is lit");

      suite.section("The conn strip steers");
      const stbd = await page.$("[data-hold='KeyD']");
      const box = await stbd.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await sleep(1000);
      const held = await page.evaluate(() => window.__sim.boat.rudder);
      await page.mouse.up();
      ok(held > 0.3, "holding the starboard button puts the helm over", held.toFixed(2));
      await sleep(1500);
      const released = await page.evaluate(() => window.__sim.boat.rudder);
      ok(Math.abs(released) < 0.2, "and it comes back amidships on release", released.toFixed(2));
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
      await page.click("#shipPanel .panel-head");
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
      await page.click("#shipPanel .panel-head");
      ok(!(await page.evaluate(() => document.querySelector("#shipPanel").classList.contains("is-collapsed"))),
         "a second click opens it again");

      suite.section("A leak unfolds the hull panel by itself");
      await page.click("#shipPanel .panel-head");
      await sleep(200);
      await page.evaluate(() => { window.__sim.player.dmg.flooding = 0.3; });
      await page.waitForFunction(() => !document.querySelector("#shipPanel").classList.contains("is-collapsed"), null, { timeout: 2000 });
      ok(true, "water in the ship opens the folded panel");
      await sleep(7000);
      eq(await page.evaluate(() => document.querySelector("#shipPanel").classList.contains("is-collapsed")), true,
         "and it folds again once the news is old");

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
