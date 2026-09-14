// headless.ts - run a simulation without a browser or a socket.
//
//   npm run server:headless
//
// A quick proof that @quarterdeck/shared and the server simulation run in plain
// Node and how fast: two ships, two minutes of game time, one number.

import { SIM_HZ, makeRng } from "@quarterdeck/shared";
import { Simulation, DEFAULT_PARAMS } from "./sim/Simulation.ts";

export { Simulation, DEFAULT_PARAMS } from "./sim/Simulation.ts";
export { ServerShip } from "./sim/ServerShip.ts";

const room = new Simulation(DEFAULT_PARAMS);
room.add("a", "lydia", { x: 0, z: 0, heading: 110 });
room.add("b", "amelie", { x: 420, z: 120, heading: 270 });

const rng = makeRng(DEFAULT_PARAMS.rngSeed);
const t0 = Date.now();
const TICKS = SIM_HZ * 120; // two minutes of game time
for (let i = 0; i < TICKS; i++) {
   room.applyInputs("a", [{ seq: i, rudder: Math.sin(i * 0.004) * 0.12 }]);
   room.step();
   if (rng() < 0.002) room.ships.get("b")!.dmg.applyHit({ side: "PORT", s: 0.5, y: 3 });
}
const ms = Date.now() - t0;
const snap = room.snapshot();
console.log(`headless: ${TICKS} ticks (${TICKS / SIM_HZ}s of game time) in ${ms} ms`);
console.log(`  world ${room.world.seed}: ${room.world.islands.length} islands, ${room.world.reefs.length} reefs`);
console.log(`  sea ${room.sea.seaWind.toFixed(2)} kn, phase ${room.sea.phaseT.toFixed(2)} s`);
for (const s of snap.ships) {
   console.log(
      `  ${s.id} (${s.vesselId}): ${s.speed.toFixed(2)} kn, heading ${s.heading.toFixed(1)}°, ` +
         `hull ${(s.hullIntegrity * 100).toFixed(0)} %, masts ${s.mastsStanding}`,
   );
}
