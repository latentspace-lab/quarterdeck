// tests/unit/input-queue.test.js - one input per tick, orders never lost.
import { takeNext, mergeOrders, MAX_INPUT_BACKLOG } from "../../packages/server/src/rooms/inputQueue.ts";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("input queue");
const { ok, eq } = suite;

const cmd = (seq, extra = {}) => ({ seq, rudder: seq / 100, ...extra });

suite.section("One per tick, in order");
{
   const q = [cmd(1), cmd(2), cmd(3)];
   eq(takeNext(q).seq, 1, "the oldest first");
   eq(takeNext(q).seq, 2, "then the next");
   eq(q.length, 1, "one left");
   eq(takeNext(q).seq, 3, "and the last");
   eq(takeNext(q), null, "empty: nothing this tick");
}

suite.section("A backlog is trimmed from the front");
{
   const q = [];
   for (let i = 1; i <= MAX_INPUT_BACKLOG + 3; i++) q.push(cmd(i));
   const first = takeNext(q);
   eq(first.seq, 4, "the three oldest are dropped, the fourth is applied");
   eq(q.length, MAX_INPUT_BACKLOG - 1, "the rest waits");
}

suite.section("Orders survive the trim");
{
   const q = [
      cmd(1, { fire: "PORT" }),
      cmd(2, { ammo: "chain" }),
      cmd(3, { cutWreck: true, sailSet: 0.5 }),
      cmd(4),
   ];
   // 3 + MAX queued: the three oldest are dropped, seq 4 is the first kept.
   for (let i = 5; i <= 3 + MAX_INPUT_BACKLOG; i++) q.push(cmd(i));
   const applied = takeNext(q);
   eq(applied.seq, 4, "the first kept input is applied");
   eq(applied.fire, "PORT", "with the broadside from a dropped input");
   eq(applied.ammo, "chain", "the load");
   eq(applied.cutWreck, true, "the cut-away");
   eq(applied.sailSet, 0.5, "and the sail change");
   ok(applied.rudder === 0.04, "its own rudder value is kept - rudder is continuous, the last one counts");
}

suite.section("mergeOrders() combines sides and keeps the newest load");
{
   const kept = cmd(9, { ammo: "grape" });
   mergeOrders([cmd(1, { fire: "PORT" }), cmd(2, { fire: "STBD" }), cmd(3, { ammo: "ball" })], kept);
   eq(kept.fire, "BOTH", "port and starboard become both");
   eq(kept.ammo, "grape", "an ammo order already on the kept input wins over an older one");
   const k2 = cmd(9, { fire: "STBD" });
   mergeOrders([cmd(1, { fire: "STBD" })], k2);
   eq(k2.fire, "STBD", "the same side twice stays that side");
   const k3 = cmd(9, { sailSet: 1 });
   mergeOrders([cmd(1, { sailSet: 0.25 })], k3);
   eq(k3.sailSet, 1, "the newer sail setting wins");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
