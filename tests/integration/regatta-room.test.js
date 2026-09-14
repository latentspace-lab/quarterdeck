// tests/integration/regatta-room.test.js - a race judged on the server.
//
// Two players in a regatta room. One is walked around the course on the
// server (positions set directly, tick by tick), and the room must judge the
// start, the marks and the lap, put them in the state for everyone and
// broadcast each pass.
import { Client } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { startServer, ROOM_REGATTA } from "../../packages/server/src/index.ts";
import { listRooms } from "../../packages/client/src/net/NetClient.js";
import { MSG, courseLayout } from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Regatta room");
const { ok, near, eq } = suite;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 5000, label = "condition") {
   const t0 = Date.now();
   while (Date.now() - t0 < ms) {
      if (pred()) return true;
      await sleep(15);
   }
   throw new Error("timed out waiting for " + label);
}
const shipOf = (room, id) => room.state && room.state.ships ? room.state.ships.get(id) : undefined;

async function run() {
   const srv = await startServer(0, "127.0.0.1", { greet: false });
   const client = new Client(srv.url);
   try {
      suite.section("Joining a regatta");
      const room = await client.create(ROOM_REGATTA, { vesselId: "yacht", name: "A", roomName: "Cowes", enemies: ["amelie"] });
      const events = [];
      room.onMessage(MSG.event, (e) => events.push(e));
      const welcome = await new Promise((res, rej) => { room.onMessage(MSG.welcome, res); setTimeout(() => rej(new Error("no welcome")), 3000); });
      eq(welcome.mode, "regatta", "the welcome says it is a regatta");
      ok(welcome.course && welcome.course.origin, "and carries the course origin", JSON.stringify(welcome.course));
      eq(welcome.params.windBaseDir, 0, "wind from the north unless told otherwise");
      await waitFor(() => room.state && room.state.ships && room.state.ships.size === 1, 3000, "state");
      eq(room.state.ships.size, 1, "no AI enemies in a race, even if asked for");
      const me = shipOf(room, room.sessionId);
      eq(me.raceLeg, 0, "on the start leg");
      eq(me.raceLap, 0, "no lap yet");
      eq(me.raceBest, -1, "no best time yet");
      ok(me.z < 0, "spawned south of the start line", me.z.toFixed(0) + " m");

      const rooms = await listRooms(srv.url);
      const mine = rooms.find((r) => r.roomId === room.roomId);
      ok(mine && mine.metadata.mode === "regatta" && mine.metadata.name === "Cowes", "the lobby lists it as a regatta named Cowes");

      const room2 = await client.joinById(room.roomId, { vesselId: "yacht", name: "B" });
      room2.onMessage(MSG.welcome, () => {});
      room2.onMessage(MSG.event, () => {});
      await waitFor(() => room2.state && room2.state.ships && room2.state.ships.size === 2, 3000, "both boats");

      suite.section("Around the course");
      const server = matchMaker.getLocalRoomById(room.roomId);
      const ship = server.sim.ships.get(room.sessionId);
      const L = courseLayout(welcome.course.origin);
      const place = async (x, z) => {
         ship.dyn.pos.x = x; ship.dyn.pos.z = z;
         await sleep(120);
      };
      const lastEvent = (type) => [...events].reverse().find((e) => e.type === type && e.shipId === room.sessionId);

      await place(0, -5);
      await place(0, 5); // over the start line, northwards
      await waitFor(() => lastEvent("mark"), 3000, "start crossing");
      ok(/started/.test(lastEvent("mark").message), "the start is announced", lastEvent("mark").message);
      await waitFor(() => shipOf(room2, room.sessionId).raceLeg === 1, 3000, "leg 1 in state");
      eq(shipOf(room2, room.sessionId).raceLeg, 1, "the other player sees us on leg 1");
      near(shipOf(room2, room.sessionId).raceProgress, 0.25, 1e-6, "a quarter of the lap");

      await place(L.windward.x + 3, L.windward.z - 3);
      await waitFor(() => lastEvent("mark") && /Windward/.test(lastEvent("mark").message), 3000, "windward");
      ok(true, "the windward mark is rounded", lastEvent("mark").message);
      await place(L.leeward.x + 3, L.leeward.z + 3);
      await waitFor(() => lastEvent("mark") && /Leeward/.test(lastEvent("mark").message), 3000, "leeward");
      ok(true, "the leeward mark is rounded", lastEvent("mark").message);
      await waitFor(() => shipOf(room, room.sessionId).raceLeg === 3, 3000, "finish leg");
      ok(shipOf(room, room.sessionId).raceTime > 0.2, "the lap clock runs", shipOf(room, room.sessionId).raceTime.toFixed(2) + " s");

      await place(0, -5);
      await place(0, 5); // finish
      await waitFor(() => lastEvent("lap"), 3000, "lap event");
      const lap = lastEvent("lap");
      eq(lap.lap, 1, "lap 1 completed");
      ok(lap.lapTime > 0.3 && lap.lapTime < 10, "in a plausible time", lap.lapTime.toFixed(2) + " s");
      near(lap.best, lap.lapTime, 1e-9, "the first lap is the best");
      await waitFor(() => shipOf(room2, room.sessionId).raceLap === 1, 3000, "lap in state");
      const seen = shipOf(room2, room.sessionId);
      eq(seen.raceLap, 1, "the other player sees the completed lap");
      near(seen.raceBest, lap.lapTime, 1e-3, "and the best time");
      eq(seen.raceLeg, 0, "we are back on the start leg");

      suite.section("Leaving");
      await room2.leave(true);
      await room.leave(true);
   } finally {
      await srv.shutdown();
   }
   return suite.done();
}

export default run;

if (!process.env.QUARTERDECK_TEST_RUNNER) await run();
