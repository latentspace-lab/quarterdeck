// Simulation.ts - one room's world, without any networking.
//
// A world, a wind, a sea state and n ships, stepped at a fixed rate. The
// Colyseus room wraps this and only adds clients, messages and schema sync;
// tests drive it directly. Every room owns its own World instance - nothing
// here touches the shared package's global "active world".

import {
   Wind,
   SeaState,
   World,
   SIM_DT,
   SIM_HZ,
   normDeg,
   dirVec,
   step as collideStep,
   groundStep,
   type InputCommand,
   type WorldParams,
   type WorldSnapshot,
   type ServerEvent,
} from "@segel/shared";
import { ServerShip, type ServerShipOptions } from "./ServerShip.ts";

export const DEFAULT_PARAMS: WorldParams = {
   windBaseDir: 20,
   windBaseSpeed: 16,
   windVariability: 1,
   terrainSeed: 1337,
   rngSeed: 4242,
   tickRate: SIM_HZ,
};

export interface SpawnPoint {
   x: number;
   z: number;
   heading: number;
   speed: number;
}

export class Simulation {
   readonly params: WorldParams;
   readonly world: World;
   readonly wind: Wind;
   readonly sea: SeaState;
   readonly ships = new Map<string, ServerShip>();
   tick = 0;
   t = 0;

   private events: ServerEvent[] = [];
   private readonly depthAt: (x: number, z: number) => number;

   constructor(params: Partial<WorldParams> = {}) {
      this.params = { ...DEFAULT_PARAMS, ...params };
      this.world = new World(this.params.terrainSeed);
      this.wind = new Wind({
         dir: this.params.windBaseDir,
         speed: this.params.windBaseSpeed,
         variability: this.params.windVariability,
      });
      this.sea = new SeaState(this.params.windBaseSpeed);
      this.depthAt = (x, z) => this.world.waterDepth(x, z);
   }

   add(id: string, vesselId: string, opts: ServerShipOptions = {}): ServerShip {
      const s = new ServerShip(id, vesselId, this.params.rngSeed, opts);
      this.ships.set(id, s);
      return s;
   }

   remove(id: string): boolean {
      return this.ships.delete(id);
   }

   /**
    * Where the n-th ship starts: on a line across the wind, 160 m apart, on a
    * broad reach with a little way on - a square-rigger started head to wind
    * would take minutes to get moving. Mirrors the client's _placeAtStart.
    */
   spawnPoint(index: number): SpawnPoint {
      const windDir = this.wind.baseDir;
      const across = dirVec(windDir + 90);
      const spread = (index - 1.5) * 160;
      return {
         x: across.x * spread,
         z: across.z * spread,
         heading: normDeg(windDir - 100),
         speed: 3,
      };
   }

   /** Queue this tick's inputs for one ship. Applied in order at the next step(). */
   applyInputs(id: string, cmds: InputCommand[]): void {
      const sh = this.ships.get(id);
      if (!sh) return;
      for (const cmd of cmds) sh.applyInput(cmd);
   }

   /** Exactly one simulation step of SIM_DT - never anything else. */
   step(): void {
      this.t += SIM_DT;
      this.tick++;
      this.wind.update(SIM_DT, this.t);
      this.sea.step(SIM_DT, this.wind.speed, this.wind.dir);
      const wind = { dir: this.wind.dir, speedKts: this.wind.speed };
      const sea = this.sea.sampler(1);

      for (const sh of this.ships.values()) sh.step(SIM_DT, wind, sea);

      const alive = this.alive();
      if (alive.length > 1) {
         for (const ev of collideStep(alive, SIM_DT)) {
            if (ev.type === "collision") {
               this.events.push({ kind: "world", type: "collision", a: ev.a.id, b: ev.b.id, closing: ev.closing });
            } else {
               this.events.push({ kind: "world", type: "locked", a: ev.a.id, b: ev.b.id });
            }
         }
      }
      for (const sh of alive) groundStep(sh, this.depthAt, SIM_DT);

      for (const sh of this.ships.values()) {
         for (const ev of sh.drainEvents()) this.events.push({ kind: "ship", ...ev });
      }
   }

   alive(): ServerShip[] {
      return [...this.ships.values()].filter((s) => s.alive);
   }

   drainEvents(): ServerEvent[] {
      const e = this.events;
      this.events = [];
      return e;
   }

   snapshot(): WorldSnapshot {
      return {
         tick: this.tick,
         sea: this.sea.toSync(),
         ships: [...this.ships.values()].map((s) => s.toState()),
      };
   }
}
