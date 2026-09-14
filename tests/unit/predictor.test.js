// tests/unit/predictor.test.js - prediction and reconciliation, no network.
//
// A "server" BoatDynamics and a "client" BoatDynamics step the same inputs,
// the server a few ticks behind (the round trip). Whenever the server's
// acknowledged state comes back, the predictor must land exactly on the
// client's prediction - and when the server was pushed off course, the
// difference must come out as a correction.
import { Predictor, ViewOffset } from "../../packages/client/src/net/Predictor.js";
import { BoatDynamics, getVessel, SIM_DT } from "@quarterdeck/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("predictor");
const { ok, near, eq } = suite;

const VESSEL = getVessel("lydia");
const WIND = { dir: 20, speedKts: 16 };
const rudderAt = (i) => Math.sin(i * 0.05) * 0.9;

/** What ServerShip.toState() sends, from a BoatDynamics. */
function stateOf(d, lastSeq) {
   return {
      x: d.pos.x, z: d.pos.z, heading: d.heading, speed: d.speed, heel: d.heel,
      sailSet: d.sailSet, rudder: d.rudder, twa: d.twaSigned, tack: d.tack, luffing: d.luffing,
      leeway: d.leeway, isCapsized: d.isCapsized,
      driveMul: d.driveMul, rudderMul: d.rudderMul, dragMul: d.dragMul,
      turnBias: d.turnBias, heelBias: d.heelBias, stopped: d.stopped, lastSeq,
   };
}

function mkPair() {
   const server = new BoatDynamics({ vessel: VESSEL, heading: 110 });
   const client = new BoatDynamics({ vessel: VESSEL, heading: 110 });
   server.speed = client.speed = 4;
   return { server, client };
}

suite.section("In sync, the ghost lands on the prediction");
{
   const { server, client } = mkPair();
   const p = new Predictor(VESSEL);
   const LAG = 4; // ticks of round trip
   const sent = [];
   let maxDist = 0;
   let corrections = 0;
   for (let i = 1; i <= 300; i++) {
      const cmd = { seq: i, rudder: rudderAt(i), sailSet: i === 120 ? 0.6 : undefined };
      client.setRudder(cmd.rudder);
      if (cmd.sailSet !== undefined) client.sailSet = cmd.sailSet;
      client.step(SIM_DT, WIND);
      p.record(cmd);
      sent.push(cmd);
      // The server applies input i-LAG this tick and its state arrives now.
      if (i > LAG) {
         const c = sent[i - LAG - 1];
         server.setRudder(c.rudder);
         if (c.sailSet !== undefined) server.sailSet = c.sailSet;
         server.step(SIM_DT, WIND);
         const corr = p.reconcile(stateOf(server, c.seq), client, WIND);
         if (corr) {
            corrections++;
            maxDist = Math.max(maxDist, corr.dist);
         }
      }
   }
   ok(corrections > 250, "every acknowledged state was reconciled", corrections + " times");
   ok(maxDist < 1e-9, "and the correction was always zero: same physics, same inputs, same dt", maxDist.toExponential(2));
   eq(p.pending, LAG, "exactly the round trip's worth of inputs stays unacknowledged");
   ok(!p.last.snapped, "no snap");
}

suite.section("A pushed-off server produces exactly the push as correction");
{
   const { server, client } = mkPair();
   const p = new Predictor(VESSEL);
   for (let i = 1; i <= 30; i++) {
      client.setRudder(0.3); client.step(SIM_DT, WIND); p.record({ seq: i, rudder: 0.3 });
      server.setRudder(0.3); server.step(SIM_DT, WIND);
      p.reconcile(stateOf(server, i), client, WIND);
   }
   // A collision on the server shoves the ship 3 m sideways and slows her.
   server.pos.x += 3;
   server.speed *= 0.5;
   client.setRudder(0.3); client.step(SIM_DT, WIND); p.record({ seq: 31, rudder: 0.3 });
   server.setRudder(0.3); server.step(SIM_DT, WIND);
   const c = p.reconcile(stateOf(server, 31), client, WIND);
   ok(c, "a correction is reported");
   near(c.dx, -3, 0.05, "of the 3 m shove (client was 3 m to the other side)", c.dx.toFixed(3));
   near(c.dist, 3, 0.05, "as its distance");
   eq(c.snapped, false, "small enough to ease, not snap");
   near(client.pos.x, server.pos.x, 1e-9, "the local ship now sits where the server has her");
   near(client.speed, server.speed, 1e-9, "at the server's speed");
}

suite.section("A large jump snaps");
{
   const { server, client } = mkPair();
   const p = new Predictor(VESSEL, { snapDistance: 8 });
   client.setRudder(0); client.step(SIM_DT, WIND); p.record({ seq: 1, rudder: 0 });
   server.setRudder(0); server.step(SIM_DT, WIND);
   server.pos.z += 40;
   const c = p.reconcile(stateOf(server, 1), client, WIND);
   eq(c.snapped, true, "40 m is a teleport, not a correction");
   near(client.pos.z, server.pos.z, 1e-9, "the local ship is put there");
}

suite.section("The server's multipliers are taken over for the replay");
{
   const { server, client } = mkPair();
   const p = new Predictor(VESSEL);
   server.driveMul = 0.5; // a mast is gone, the server says
   for (let i = 1; i <= 40; i++) {
      client.setRudder(0); client.step(SIM_DT, WIND); p.record({ seq: i, rudder: 0 });
      server.setRudder(0); server.step(SIM_DT, WIND);
      p.reconcile(stateOf(server, i), client, WIND);
   }
   near(client.driveMul, 0.5, 1e-12, "driveMul copied from the acknowledged state");
   near(client.speed, server.speed, 1e-9, "so the speeds agree");
}

suite.section("History is trimmed and repeats are ignored");
{
   const p = new Predictor(VESSEL, { maxHistory: 10 });
   for (let i = 1; i <= 25; i++) p.record({ seq: i, rudder: 0 });
   eq(p.pending, 10, "only the newest inputs are kept");
   const { server, client } = mkPair();
   const s = stateOf(server, 20);
   ok(p.reconcile(s, client, WIND), "an ack for seq 20 reconciles");
   eq(p.pending, 5, "and leaves 21..25 pending");
   eq(p.reconcile(s, client, WIND), null, "the same ack again does nothing");
   eq(p.reconcile({ ...s, x: NaN }, client, WIND), null, "a state without numbers is ignored");
}

suite.section("ViewOffset absorbs and decays");
{
   const v = new ViewOffset(0.1);
   eq(v.active, false, "starts inactive");
   v.absorb({ dx: 2, dz: -1, dyaw: 5, snapped: false });
   near(v.x, 2, 1e-12, "took the x offset");
   near(v.yaw, 5, 1e-12, "and the yaw");
   for (let i = 0; i < 30; i++) v.step(SIM_DT); // 1 s = 10 tau
   ok(Math.abs(v.x) < 1e-3 && Math.abs(v.yaw) < 1e-3, "gone after a second", v.x.toExponential(1));
   v.absorb({ dx: 2, dz: 0, dyaw: 0, snapped: true });
   eq(v.active, false, "a snap clears the offset - the picture jumps with the physics");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
