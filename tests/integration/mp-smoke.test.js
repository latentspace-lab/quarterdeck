// tests/integration/mp-smoke.test.js - the built game joins a real server.
//
// Starts the game server in this process, opens the built client in Chromium
// with ?mp=1, and checks the loop end to end: the page joins, a second player
// (a Node SDK client) appears as a remote ship on the page, and the page's
// keyboard input shows up in the server's state for that second player.
// Skips without a build or a browser, like the boot-smoke test.
import { startServer } from "../../packages/server/src/index.ts";
import { NetClient } from "../../packages/client/src/net/NetClient.js";
import { serveDist, launchChromium, watchErrors } from "../lib/browser.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Multiplayer smoke (browser)");
const { ok, eq, near } = suite;

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
   const srv = await startServer(0, "127.0.0.1", { greet: false });
   const page = await browser.newPage({ viewport: { width: 1280, height: 760 } });
   const errors = watchErrors(page);
   let other = null;
   try {
      suite.section("The page joins a battle");
      const url = `${site.url}?mp=1&server=${encodeURIComponent(srv.url)}&vessel=lydia&name=Browser&enemies=hirondelle&roomName=Smoke%20Test`;
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.__sim && window.__sim.mode === "Multiplayer" && window.__sim.session && window.__sim.session.shipId, null, { timeout: 15000 });
      const joined = await page.evaluate(() => ({
         menuOpen: window.__sim.menuOpen,
         shipId: window.__sim.session.shipId,
         roomId: window.__sim.session.net.roomId,
         remotes: window.__sim.session.remotes.size,
         terrain: window.__sim.terrain.visible,
      }));
      eq(joined.menuOpen, false, "the menu closed on join");
      ok(joined.shipId, "the page has a ship", joined.shipId);
      eq(joined.remotes, 1, "the AI enemy is a remote ship on the page");
      eq(joined.terrain, true, "the server's chart is shown");
      eq(errors.length, 0, "no errors while joining", errors.slice(0, 3).join(" | "));

      suite.section("A second player appears");
      other = new NetClient(srv.url);
      await other.join({ vesselId: "hotspur", name: "Node", roomId: joined.roomId });
      await page.waitForFunction(() => window.__sim.session.remotes.size === 2, null, { timeout: 5000 });
      const seen = await page.evaluate((id) => {
         const r = window.__sim.session.remotes.get(id);
         return r ? { vesselId: r.vesselId, inScene: window.__sim.scene.scene.children.includes(r.model) } : null;
      }, other.shipId);
      ok(seen && seen.vesselId === "hotspur", "the page knows what the newcomer sails");
      ok(seen && seen.inScene, "and has its model in the scene");

      suite.section("Keyboard input reaches the server");
      await page.keyboard.down("ArrowRight");
      await new Promise((r) => setTimeout(r, 1500));
      const mine = other.state.ships.get(joined.shipId);
      ok(mine && mine.rudder > 0.5, "the other player sees the page's rudder hard over", mine && mine.rudder.toFixed(2));
      ok(mine && mine.lastSeq > 20, "the page's inputs are acknowledged", mine && "seq " + mine.lastSeq);
      await page.keyboard.up("ArrowRight");
      const local = await page.evaluate(() => ({
         speed: window.__sim.boat.speed, x: window.__sim.boat.pos.x, z: window.__sim.boat.pos.z,
         hud: !!document.querySelector("#foePanel") && getComputedStyle(document.querySelector("#foePanel")).display !== "none",
         draw: window.__sim.renderer.info.render.calls,
         corr: window.__sim.session.correction,
         pending: window.__sim.session.predictor.pending,
      }));
      ok(local.speed > 0.5, "the page's ship sails", local.speed.toFixed(2) + " kn");
      ok(Math.hypot(local.x - mine.x, local.z - mine.z) < 8, "and is within a round trip of the server's copy",
         Math.hypot(local.x - mine.x, local.z - mine.z).toFixed(1) + " m");
      ok(local.corr && local.corr.dist < 0.5, "prediction reconciles with a tiny correction",
         local.corr && local.corr.dist.toFixed(3) + " m, " + local.pending + " pending");
      ok(local.hud, "the HUD lists the other ships");
      ok(local.draw > 0, "it draws", local.draw + " calls");
      eq(errors.length, 0, "no errors while sailing", errors.slice(0, 3).join(" | "));

      suite.section("A broadside from the keyboard");
      await page.keyboard.press("KeyE");
      await page.waitForFunction(() => window.__sim.player.battery.broadsides >= 1, null, { timeout: 4000 });
      await new Promise((r) => setTimeout(r, 700));
      const guns = await page.evaluate(() => ({
         broadsides: window.__sim.player.battery.broadsides,
         balls: window.__sim.player.battery._shots.length,
         fired: window.__sim.player.battery.shotsFired,
         state: document.querySelector("#gunStateS") && document.querySelector("#gunStateS").textContent,
      }));
      eq(guns.broadsides, 1, "the server's salvo came back and was played");
      ok(guns.fired > 0 && guns.balls > 0, "the balls are in the air, replayed from the server's shots", guns.fired + " fired, " + guns.balls + " flying");
      ok(/LOADING/.test(guns.state || ""), "the HUD shows the starboard battery reloading from the server's timer", guns.state);
      const seenByOther = other.state.ships.get(joined.shipId);
      ok(seenByOther.reloadStbd > 0, "the other player sees the reload in the state", seenByOther.reloadStbd.toFixed(1) + " s");

      suite.section("The lobby in the menu");
      await page.evaluate(() => window.__sim.openMenu());
      await page.waitForFunction(() => document.querySelector(".mode-btn[data-mode='Multiplayer']"), null, { timeout: 3000 });
      await page.click(".mode-btn[data-mode='Multiplayer']");
      await page.waitForFunction(() => document.querySelectorAll("#roomList .room-row").length >= 1, null, { timeout: 5000 });
      const lobby = await page.evaluate(() => {
         const rows = [...document.querySelectorAll("#roomList .room-row")];
         return rows.map((r) => ({
            name: r.querySelector(".room-title").textContent,
            kind: r.querySelector(".room-kind").textContent,
            info: r.querySelector(".room-info").textContent,
         }));
      });
      ok(lobby.some((r) => r.name === "Smoke Test" && r.kind === "Battle"), "the menu lists the room we are in, by name and kind", JSON.stringify(lobby));
      ok(lobby.some((r) => /2\/8 players/.test(r.info) && /1 AI/.test(r.info)), "with players and AI count", lobby[0] && lobby[0].info);
      const resumed = await page.evaluate(() => {
         const b = document.querySelector("#menuResume");
         if (!b) return false;
         b.click();
         return true;
      });
      ok(resumed, "'Back to the battle' returns to the game");
      await page.waitForFunction(() => window.__sim.menuOpen === false, null, { timeout: 3000 });

      suite.section("The other player leaves");
      await other.leave();
      other = null;
      await page.waitForFunction(() => window.__sim.session.remotes.size === 1, null, { timeout: 5000 });
      ok(true, "the page drops the remote ship");

      suite.section("A regatta on the page");
      const page2 = await browser.newPage({ viewport: { width: 1280, height: 760 } });
      const errors2 = watchErrors(page2);
      try {
         await page2.goto(`${site.url}?mp=1&server=${encodeURIComponent(srv.url)}&vessel=yacht&name=Racer&mode=regatta&roomName=Cowes`,
            { waitUntil: "load", timeout: 30000 });
         await page2.waitForFunction(() => window.__sim && window.__sim.session && window.__sim.session.mode === "regatta"
            && window.__sim.mode === "Multiplayer", null, { timeout: 15000 });
         await page2.waitForFunction(() => document.querySelector("#hudCourse") && /Leg 1/.test(document.querySelector("#hudCourse").textContent), null, { timeout: 5000 });
         const race = await page2.evaluate(() => ({
            buoys: window.__sim.course.root.visible,
            windward: window.__sim.course.windward.z,
            hud: document.querySelector("#hudCourse").textContent,
            lap: document.querySelector("#hudLap").textContent,
         }));
         eq(race.buoys, true, "the course buoys are shown");
         near(race.windward, 850, 0, "at the server's course");
         ok(/Leg 1 · Start line/.test(race.hud), "the HUD shows the first leg from the server's state", race.hud);
         ok(/Runde 0|Lap 0/.test(race.lap), "and lap 0", race.lap);
         eq(errors2.length, 0, "no errors on the regatta page", errors2.slice(0, 3).join(" | "));
      } finally {
         await page2.close().catch(() => {});
      }
   } finally {
      if (other) await other.leave().catch(() => {});
      await browser.close().catch(() => {});
      await srv.shutdown();
      site.close();
   }
   return suite.done();
}

export default run;

if (!process.env.SEGEL_TEST_RUNNER) await run();
