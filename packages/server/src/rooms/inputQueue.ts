// inputQueue.ts - which client input a ship gets this tick.
//
// One input per ship per tick: the client applied each command to exactly one
// physics step, so the server must too or its prediction cannot be replayed.
// Inputs arrive in bursts (a slow tab steps several ticks per frame, the
// network bunches packets), so a backlog is worked off one per tick. A backlog
// beyond `max` is trimmed from the front - but the trimmed inputs' orders
// (fire, load, cut the wreck, a sail change) are folded into the next input
// that is kept: a rudder value may be lost, a broadside may not.

import type { InputCommand } from "@quarterdeck/shared";

/** Default ceiling on queued inputs per ship (~270 ms at 30 Hz). */
export const MAX_INPUT_BACKLOG = 8;

/** Fold the one-shot orders of `dropped` (in order) into `kept`. */
export function mergeOrders(dropped: InputCommand[], kept: InputCommand): InputCommand {
   for (const d of dropped) {
      if (d.fire) {
         kept.fire = !kept.fire || kept.fire === d.fire ? d.fire : "BOTH";
      }
      if (d.ammo !== undefined && kept.ammo === undefined) kept.ammo = d.ammo;
      if (d.cutWreck) kept.cutWreck = true;
      if (d.sailSet !== undefined && kept.sailSet === undefined) kept.sailSet = d.sailSet;
   }
   return kept;
}

/**
 * Take the input for this tick from `queue` (mutated), trimming a backlog
 * beyond `max` without losing orders. Returns null when nothing is queued.
 */
export function takeNext(queue: InputCommand[], max = MAX_INPUT_BACKLOG): InputCommand | null {
   if (!queue.length) return null;
   if (queue.length > max) {
      const dropped = queue.splice(0, queue.length - max);
      mergeOrders(dropped, queue[0]);
   }
   return queue.shift() as InputCommand;
}
