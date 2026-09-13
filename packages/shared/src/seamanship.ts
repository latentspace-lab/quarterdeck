// seamanship.ts - consequences of how a hull sits on the sea.
//
// Water over the rail: the lee rail is the lowest point of the deck. When it
// dips below the local sea surface, the sea pours into the battery - the ship
// takes water and people on deck go overboard. This changes flooding and
// crew, so it is gameplay, not decoration, and runs on the server as well as
// on the client. Extracted from the client's Ship class so both sides share
// one formula.

import { clamp } from "./utils.ts";
import { railClearance, type Pose } from "./pose.ts";
import type { Rng } from "./rng.ts";
import type { Where } from "./crew.ts";

/** Per-ship bookkeeping the swamp check carries between ticks. */
export interface SwampState {
   /** Seconds the rail has been continuously under water */
   swampT: number;
   /** Last computed clearance of the lee rail (m); negative = swamped */
   railClear: number;
}

/** What the check needs to write to. */
export interface SwampTargets {
   dmg: {
      flooding: number;
      sunk: boolean;
      _event(type: string, data: Record<string, unknown>): void;
   };
   crew?: {
      hit(n: number, where?: Where): unknown;
      shock(a: number): void;
   } | null;
}

/**
 * One fixed step of the swamp check. Returns the rail clearance.
 *
 * @param freeboard height of the bulwark above the waterline amidships (m)
 * @param halfBeam half the hull's beam (m)
 */
export function swampStep(
   st: SwampState,
   dt: number,
   pose: Pose,
   freeboard: number,
   halfBeam: number,
   t: SwampTargets,
   rng: Rng,
): number {
   const clear = railClearance(freeboard, pose.rollZ, halfBeam, pose.sinkIn, pose.seaY, pose.leeY);
   st.railClear = clear;
   if (clear >= 0 || t.dmg.sunk) {
      st.swampT = 0;
      return clear;
   }
   const depth = Math.min(-clear, 2.5);
   st.swampT += dt;
   // Book the water coming over the deck as flooding so the pumps and the
   // sinking logic know about it.
   t.dmg.flooding = clamp(t.dmg.flooding + depth * 0.022 * dt, 0, 1);
   // People working on deck are washed overboard.
   if (t.crew && rng() < depth * 0.18 * dt) {
      t.crew.hit(1 + ((rng() * 2) | 0), "deck");
      t.crew.shock(0.04);
   }
   if (st.swampT > 1.2) {
      st.swampT = 0;
      t.dmg._event("swamped", { depth });
   }
   return clear;
}
