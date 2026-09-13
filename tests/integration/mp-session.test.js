// tests/integration/mp-session.test.js - the client's network layer, headless.
//
// NetClient, RemoteShip and MultiplayerSession against a real server, with a
// stand-in for the Simulator (a THREE.Scene, a BoatDynamics, a client Ship)
// but no WebGL and no DOM. What the browser does on top of this is drawing.
import * as THREE from "three";
import { matchMaker } from "@colyseus/core";
import { startServer } from "../../packages/server/src/index.ts";
import { NetClient } from "../../packages/client/src/net/NetClient.js";
import { RemoteShip } from "../../packages/client/src/net/RemoteShip.js";
import { MultiplayerSession } from "../../packages/client/src/net/MultiplayerSession.js";
import { Ship } from "../../packages/client/src/ship.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import { getVessel, Wind, SeaState, World, SIM_DT, SIM_HZ, BoatDynamics } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Multiplayer session (headless)");
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

/** The slice of Simulator that MultiplayerSession touches. */
function fakeSim(vesselId = "lydia") {
   const scene = new THREE.Scene();
   const api = { scene, add: (o) => scene.add(o), remove: (o) => scene.remove(o) };
   const debris = new DebrisField(scene, { max: 60 });
   const vessel = getVessel(vesselId);
   const player = new Ship({ id: "player", vessel, scene: api, debris, targets: () => [], sound: false, isPlayer: true });
   let world = null;
   return {
      scene: api, debris, vessel, player,
      get boat() { return player.dyn; },
      wind: new Wind({ dir: 0, speed: 10 }),
      sea: new SeaState(10),
      sunDir: new THREE.Vector3(0.4, 0.6, 0.7),
      terrain: {
         visible: false,
         regenerate(seed) { world = new World(seed); return world; },
         setVisible(v) { this.visible = v; },
         get world() { return world; },
      },
   };
}

async function run() {
   const srv = await startServer(0, "127.0.0.1", { greet: false });
   try {
      suite.section("NetClient joins and reports ships");
      const A = new NetClient(srv.url);
      const added = [];
      const removed = [];
      A.onShipAdd((id) => added.push(id));
      A.onShipRemove((id) => removed.push(id));
      const welcome = await A.join({ vesselId: "lydia", name: "A", create: { windBaseDir: 30, windBaseSpeed: 14 } });
      eq(welcome.shipId, A.shipId, "welcome names our ship");
      eq(welcome.params.windBaseDir, 30, "the room was created with our wind");
      await waitFor(() => added.includes(A.shipId), 3000, "own ship added");
      ok(added.includes(A.shipId), "our own ship is reported as added");

      const B = new NetClient(srv.url);
      await B.join({ vesselId: "hotspur", name: "B", roomId: A.roomId });
      await waitFor(() => added.includes(B.shipId), 3000, "B added at A");
      ok(added.includes(B.shipId), "the second player's ship is reported");
      eq(A.state.ships.get(B.shipId).vesselId, "hotspur", "with its vessel");

      suite.section("RemoteShip follows the server");
      const scene = new THREE.Scene();
      const api = { scene, add: (o) => scene.add(o), remove: (o) => scene.remove(o) };
      const debris = new DebrisField(scene, { max: 60 });
      const remote = new RemoteShip({ id: B.shipId, vesselId: "hotspur", name: "B", scene: api, debris, delay: 100 });
      ok(scene.children.includes(remote.model), "its model is in the scene");
      let seq = 0;
      const feed = setInterval(() => {
         const s = A.state.ships.get(B.shipId);
         if (s) remote.push(s, performance.now());
         B.send({ seq: ++seq, rudder: 1 });
      }, 1000 / SIM_HZ);
      await sleep(1500);
      clearInterval(feed);
      const sea = new SeaState(14);
      const ctx = {
         wind: { dir: 30, speedKts: 14 }, t: 1, waveT: sea.phaseT, waveRad: sea.windRad,
         amp: sea.amp, lambda: sea.lambda, seaFull: sea.sampler(1), crewLod: true,
      };
      remote.render(performance.now(), ctx, SIM_DT);
      const latest = remote.latest;
      ok(latest && latest.speed > 0.5, "the remote ship has way on", latest && latest.speed.toFixed(2) + " kn");
      ok(Math.hypot(remote.model.position.x - latest.x, remote.model.position.z - latest.z) < 3,
         "the model is drawn within a few metres of the newest state (100 ms behind)",
         Math.hypot(remote.model.position.x - latest.x, remote.model.position.z - latest.z).toFixed(2) + " m");
      near(remote.model.rotation.y, latest.heading * Math.PI / 180, 0.05, "and on its heading");
      ok(remote.ship.dyn.rudder > 0.5, "the rudder angle came through", remote.ship.dyn.rudder.toFixed(2));

      suite.section("Events reach the remote ship's model");
      const room = matchMaker.getLocalRoomById(A.roomId);
      room.sim.ships.get(B.shipId).dmg.breakMast("main", "test");
      await waitFor(() => A.peekEvents().some((e) => e.type === "mastLost"), 3000, "mastLost at A");
      const evs = A.drainEvents();
      const lost = evs.find((e) => e.type === "mastLost");
      eq(lost.shipId, B.shipId, "for the right ship");
      remote.onEvent(lost);
      ok(remote.model.userData.lostMasts.has("main"), "the mainmast is gone from the model");
      ok(debris.hasWreckage(B.shipId), "and hangs alongside as wreckage");

      suite.section("MultiplayerSession on a stand-in Simulator");
      const sim = fakeSim("lydia");
      const session = new MultiplayerSession(sim, { delay: 100 });
      const w2 = await session.start({ url: srv.url, vesselId: "lydia", name: "C", roomId: A.roomId });
      eq(w2.params.terrainSeed, welcome.params.terrainSeed, "same world as the others");
      eq(sim.terrain.world.seed, welcome.params.terrainSeed, "the terrain was regenerated from the seed");
      eq(sim.terrain.visible, true, "and shown");
      eq(sim.wind.baseDir, 30, "wind base parameters taken over");
      await waitFor(() => session.remotes.size === 2, 3000, "two remote ships");
      eq(session.remotes.size, 2, "the other two players are remote ships");
      ok(!session.remotes.has(session.shipId), "our own ship is not one of them");

      // Step like the Simulator would: local physics, then the session.
      const wind = { dir: sim.wind.dir, speedKts: sim.wind.speed };
      for (let i = 0; i < SIM_HZ * 2; i++) {
         sim.sea.step(SIM_DT, sim.wind.speed, sim.wind.dir);
         sim.boat.setRudder(-1);
         sim.boat.step(SIM_DT, wind);
         session.stepFixed(SIM_DT, { rudder: -1 });
         await sleep(1000 / SIM_HZ);
      }
      const me = session.net.state.ships.get(session.shipId);
      ok(me.lastSeq > 30, "our inputs are acknowledged", "seq " + me.lastSeq);
      ok(me.rudder < -0.5, "the server has our rudder", me.rudder.toFixed(2));
      ok(Math.hypot(sim.boat.pos.x - me.x, sim.boat.pos.z - me.z) < 15,
         "the local ship stays near the server's copy", Math.hypot(sim.boat.pos.x - me.x, sim.boat.pos.z - me.z).toFixed(1) + " m");
      near(sim.sea.seaWind, session.net.state.seaWind, 0.5, "sea state follows the server");
      near(sim.wind.dir, session.net.state.windDir, 1e-6, "wind direction is the server's");

      const ctx2 = {
         wind, t: 2, waveT: sim.sea.phaseT, waveRad: sim.sea.windRad,
         amp: sim.sea.amp, lambda: sim.sea.lambda, seaFull: sim.sea.sampler(1), crewLod: true,
      };
      session.render(ctx2, SIM_DT);
      const others = session.others(sim.boat.pos);
      eq(others.length, 2, "the HUD list has both others");
      ok(others.every((o) => Number.isFinite(o.dist) && o.masts >= 2), "with distance and mast count");
      ok(others.some((o) => o.masts === 2), "one of them shows the lost mast");

      suite.section("Leaving");
      await B.leave();
      await waitFor(() => removed.includes(B.shipId), 3000, "B removed at A");
      ok(removed.includes(B.shipId), "a ship that leaves is reported as removed");
      await waitFor(() => session.remotes.size === 1, 3000, "session drops it too");
      eq(session.remotes.size, 1, "the session disposed its remote ship");
      await session.stop();
      await A.leave();
      remote.dispose();
   } finally {
      await srv.shutdown();
   }
   return suite.done();
}

export default run;

if (!process.env.SEGEL_TEST_RUNNER) await run();
