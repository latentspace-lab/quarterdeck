// tests/integration/colyseus-room.test.js - a real server, real sockets.
//
// Starts the game server on an ephemeral port, joins it with the official
// client SDK and checks the whole loop: join -> welcome -> state patches ->
// inputs -> acknowledgement -> second player -> leave.
import { Client } from "@colyseus/sdk";
import { matchMaker } from "@colyseus/core";
import { startServer, ROOM_BATTLE } from "../../packages/server/src/index.ts";
import { MSG, SIM_HZ } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Colyseus room");
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
const shipOf = (room, id) => room.state.ships.get(id);

async function run() {
   const srv = await startServer(0, "127.0.0.1", { greet: false });
   suite.note("server on " + srv.url);
   const client = new Client(srv.url);

   try {
      suite.section("Joining");
      const room = await client.joinOrCreate(ROOM_BATTLE, { vesselId: "lydia", name: "Hornblower" });
      const events1 = [];
      room.onMessage(MSG.event, (e) => events1.push(e));
      const welcome = await new Promise((resolve, reject) => {
         room.onMessage(MSG.welcome, resolve);
         setTimeout(() => reject(new Error("no welcome")), 3000);
      });
      eq(welcome.shipId, room.sessionId, "the welcome names our ship (= session id)");
      ok(Number.isInteger(welcome.params.terrainSeed), "and carries the world parameters", "seed " + welcome.params.terrainSeed);
      eq(welcome.params.tickRate, SIM_HZ, "at the shared tick rate");

      await waitFor(() => room.state && room.state.tick > 5 && shipOf(room, room.sessionId), 5000, "first patches");
      const me = shipOf(room, room.sessionId);
      eq(me.vesselId, "lydia", "our ship is the vessel we asked for");
      eq(me.name, "Hornblower", "with the name we gave");
      eq(room.state.terrainSeed, welcome.params.terrainSeed, "the state repeats the seed");
      ok(room.state.seaWind > 0 && room.state.phaseT > 0, "the sea state is synced",
         room.state.seaWind.toFixed(1) + " kn, phase " + room.state.phaseT.toFixed(2));

      suite.section("The clock runs at the tick rate");
      const t0 = room.state.tick;
      await sleep(1000);
      const dTick = room.state.tick - t0;
      ok(dTick >= SIM_HZ * 0.7 && dTick <= SIM_HZ * 1.4, "about 30 ticks per second reach the client", dTick + " ticks/s");

      suite.section("Inputs are applied and acknowledged");
      const headingBefore = me.heading;
      let seq = 0;
      const send = setInterval(() => room.send(MSG.input, { seq: ++seq, rudder: 1 }), 1000 / SIM_HZ);
      await sleep(2000);
      clearInterval(send);
      const lastSent = seq;
      await waitFor(() => shipOf(room, room.sessionId).lastSeq >= lastSent, 3000, "ack of last input");
      const after = shipOf(room, room.sessionId);
      eq(after.lastSeq, lastSent, "the server acknowledges the last input it applied", lastSent);
      ok(after.speed > 0.5, "the ship has way on", after.speed.toFixed(2) + " kn");
      ok(after.rudder > 0.9, "the rudder is hard over", after.rudder.toFixed(3));
      ok(Math.abs(((after.heading - headingBefore + 540) % 360) - 180) > 5,
         "and the course has changed", headingBefore.toFixed(1) + " -> " + after.heading.toFixed(1));
      ok(after.driveMul > 0 && after.dragMul >= 1, "the re-simulation inputs travel with the state");

      suite.section("Garbage is ignored");
      room.send(MSG.input, { seq: "x", rudder: NaN });
      room.send(MSG.input, "nope");
      await sleep(150);
      eq(shipOf(room, room.sessionId).lastSeq, lastSent, "a malformed input is not acknowledged");

      suite.section("A second player");
      const client2 = new Client(srv.url);
      const room2 = await client2.joinById(room.roomId, { vesselId: "hotspur" });
      const events = [];
      room2.onMessage(MSG.event, (e) => events.push(e));
      const welcome2 = await new Promise((resolve, reject) => {
         room2.onMessage(MSG.welcome, resolve);
         setTimeout(() => reject(new Error("no welcome for player two")), 3000);
      });
      eq(welcome2.params.terrainSeed, welcome.params.terrainSeed, "the newcomer gets the same world");
      await waitFor(() => room.state.ships.size === 2 && room2.state && room2.state.ships.size === 2, 5000, "both see two ships");
      eq(room.state.ships.size, 2, "the first player sees two ships");
      eq(shipOf(room, room2.sessionId).vesselId, "hotspur", "and knows what the newcomer sails");
      const p1 = shipOf(room, room.sessionId);
      const p2 = shipOf(room, room2.sessionId);
      ok(Math.hypot(p1.x - p2.x, p1.z - p2.z) > 50, "spawned apart", Math.hypot(p1.x - p2.x, p1.z - p2.z).toFixed(0) + " m");

      suite.section("Events are broadcast");
      // Reach into the server-side room: a mast goes over the side on player
      // one's ship. Every client must hear about it on the next tick.
      const serverRoom = matchMaker.getLocalRoomById(room.roomId);
      ok(serverRoom, "the room can be reached on the server");
      serverRoom.sim.ships.get(room.sessionId).dmg.breakMast("main", "test");
      await waitFor(() => events.some((e) => e.type === "mastLost"), 3000, "mastLost broadcast");
      const lost = events.find((e) => e.type === "mastLost");
      eq(lost.kind, "ship", "as a ship event");
      eq(lost.shipId, room.sessionId, "naming the ship");
      eq(lost.mast, "main", "and the mast");
      ok(events1.some((e) => e.type === "mastLost"), "the ship's own player hears it too");
      await waitFor(() => shipOf(room2, room.sessionId).mastsStanding === 2, 3000, "mast count in state");
      eq(shipOf(room2, room.sessionId).mastsStanding, 2, "the state shows two masts standing");
      ok(shipOf(room2, room.sessionId).wreckDrag > 0, "and the wreck dragging alongside");

      suite.section("Leaving");
      await room2.leave(true);
      await waitFor(() => room.state.ships.size === 1, 5000, "the second ship is removed");
      eq(room.state.ships.size, 1, "a consented leave removes the ship");
      await room.leave(true);
   } finally {
      await srv.shutdown();
   }
   return suite.done();
}

export default run;

if (!process.env.SEGEL_TEST_RUNNER) await run();
