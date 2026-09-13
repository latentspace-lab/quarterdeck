// RegattaRoom.ts - racing the windward-leeward course on the server.
//
// The same simulation as a battle (nobody fires, but the physics, the wind
// and the sea are the same), plus the shared course tracker judging every
// boat: line crossings, mark roundings, laps and best times go into the
// state, and each pass is broadcast as an event. No AI enemies.

import {
   courseLayout,
   newRace,
   raceStep,
   type CourseLayout,
   type RaceProgress,
   type RoomCreateOptions,
   type WelcomeMessage,
} from "@segel/shared";
import { BattleRoom } from "./BattleRoom.ts";
import type { ServerShip } from "../sim/ServerShip.ts";

export class RegattaRoom extends BattleRoom {
   protected mode = "regatta" as const;
   layout: CourseLayout = courseLayout({ x: 0, z: 0 });
   private readonly races = new Map<string, RaceProgress>();

   onCreate(options: RoomCreateOptions = {}) {
      // The course points north; unless told otherwise the wind comes from
      // there, so the first leg is a beat. Enemies make no sense in a race.
      super.onCreate({ ...options, enemies: [], windBaseDir: options.windBaseDir ?? 0 });
   }

   protected spawnFor(index: number) {
      return this.sim.spawnPointRegatta(index, this.layout.origin);
   }

   protected welcomeExtras(): Partial<WelcomeMessage> {
      return { course: { origin: { x: this.layout.origin.x, z: this.layout.origin.z } } };
   }

   protected onShipAdded(ship: ServerShip): void {
      const r = newRace(this.layout, this.sim.t, ship.pos);
      this.races.set(ship.id, r);
      ship.race = { leg: 0, lap: 0, progress: 0, time: 0, best: null };
   }

   protected afterStep(): void {
      for (const [id, r] of this.races) {
         const ship = this.sim.ships.get(id);
         if (!ship || !ship.alive) continue;
         const step = raceStep(this.layout, r, ship.pos, this.sim.t);
         ship.race = { leg: r.leg, lap: r.lap, progress: r.progress, time: step.time, best: r.best };
         if (step.advanced) {
            this.broadcast("event", {
               kind: "ship",
               type: step.lapDone ? "lap" : "mark",
               shipId: id,
               leg: step.leg,
               legName: step.legName,
               lap: r.lap,
               lapTime: step.lapTime,
               best: r.best,
               message: step.message,
            });
         }
      }
   }

   protected removeShip(id: string): void {
      this.races.delete(id);
      super.removeShip(id);
   }
}
