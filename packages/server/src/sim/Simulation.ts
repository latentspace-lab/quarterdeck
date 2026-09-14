// Simulation.ts - one room's world, without any networking.
//
// A world, a wind, a sea state and n ships, stepped at a fixed rate. The
// Colyseus room wraps this and only adds clients, messages and schema sync;
// tests drive it directly. Every room owns its own World instance - nothing
// here touches the shared package's global "active world".
//
// Order of one tick: wind and sea -> captains decide -> ships sail and take
// their pose -> broadsides ordered by players go off -> projectiles fly and
// hit -> hulls collide and touch ground -> events are collected.

import {
   Wind,
   SeaState,
   World,
   SIM_DT,
   SIM_HZ,
   normDeg,
   dirVec,
   deriveRng,
   step as collideStep,
   groundStep,
   type InputCommand,
   type WorldParams,
   type WorldSnapshot,
   type ServerEvent,
   type TargetBox,
   type Rng,
} from "@quarterdeck/shared";
import { ServerShip, type ServerShipOptions } from "./ServerShip.ts";
import { Captain, type CaptainOptions } from "./Captain.ts";

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
   readonly captains = new Map<string, Captain>();
   tick = 0;
   t = 0;

   private events: ServerEvent[] = [];
   private readonly depthAt: (x: number, z: number) => number;
   private readonly spawnRng: Rng;

   constructor(params: Partial<WorldParams> = {}) {
      // An explicit `undefined` (a room option that was not given) must not
      // clobber a default - the params go out to every client as the welcome.
      const given = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined));
      this.params = { ...DEFAULT_PARAMS, ...given };
      this.world = new World(this.params.terrainSeed);
      this.wind = new Wind({
         dir: this.params.windBaseDir,
         speed: this.params.windBaseSpeed,
         variability: this.params.windVariability,
      });
      this.sea = new SeaState(this.params.windBaseSpeed);
      this.depthAt = (x, z) => this.world.waterDepth(x, z);
      this.spawnRng = deriveRng(this.params.rngSeed, "spawn");
   }

   add(id: string, vesselId: string, opts: ServerShipOptions = {}): ServerShip {
      const s = new ServerShip(id, vesselId, this.params.rngSeed, opts);
      this.ships.set(id, s);
      return s;
   }

   /** Add an AI-controlled ship with a captain. */
   addAI(id: string, vesselId: string, opts: ServerShipOptions = {}, captain: CaptainOptions = {}): ServerShip {
      const s = this.add(id, vesselId, { ...opts, ai: true });
      this.captains.set(id, new Captain(s, captain));
      return s;
   }

   remove(id: string): boolean {
      this.captains.delete(id);
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

   /**
    * Where the n-th boat starts a regatta: below the start line, staggered,
    * close-hauled on starboard so the first beat is to the windward mark.
    */
   spawnPointRegatta(index: number, origin = { x: 0, z: 0 }): SpawnPoint {
      const windDir = this.wind.baseDir;
      return {
         x: origin.x + (index - 1.5) * 32,
         z: origin.z - 110 - index * 34,
         heading: normDeg(windDir - 70),
         speed: 3,
      };
   }

   /**
    * Enemies line up to windward, a good 900 m off and staggered across the
    * wind, heading for the players' spawn line. Mirrors the client's
    * _startBattle; skill and range vary per captain from the room seed.
    */
   spawnEnemies(vesselIds: string[], captain: CaptainOptions = {}): ServerShip[] {
      const windDir = this.wind.baseDir;
      const up = dirVec(windDir);
      const across = dirVec(windDir + 90);
      const out: ServerShip[] = [];
      vesselIds.forEach((vesselId, i) => {
         const spread = (i - (vesselIds.length - 1) / 2) * 420;
         let x = up.x * 900 + across.x * spread;
         let z = up.z * 900 + across.z * spread;
         if (!this.world.isOpenWater(x, z)) {
            const safe = this.world.findOpenWater({
               rng: this.spawnRng,
               near: { x, z },
               minDist: 0,
               maxDist: 800,
            });
            x = safe.x;
            z = safe.z;
         }
         const heading = normDeg((Math.atan2(-x, -z) * 180) / Math.PI);
         const id = "ai-" + (this.captains.size + 1);
         out.push(
            this.addAI(id, vesselId, { x, z, heading, speed: 4, team: "red" }, {
               doctrine: "rig",
               skill: 0.8 + this.spawnRng() * 0.25,
               engage: 170 + this.spawnRng() * 120,
               ...captain,
            }),
         );
      });
      return out;
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
      const gunSea = this.sea.sampler(0.9);

      // Captains decide on last tick's picture - like a player does.
      let targets = this.targetBoxes();
      for (const [id, cap] of this.captains) {
         const ship = this.ships.get(id);
         if (!ship || !ship.alive) continue;
         cap.update(SIM_DT, { wind, target: this.targetFor(ship), ownMatrix: ship.heelerMatrix, targets });
      }

      for (const sh of this.ships.values()) sh.step(SIM_DT, wind, sea);

      // Players' broadsides, on this tick's poses.
      targets = this.targetBoxes();
      for (const sh of this.ships.values()) {
         if (!sh.fireRequests.length) continue;
         for (const side of sh.fireRequests) sh.orderFire(side, sh.gunnery, sh.heelerMatrix, targets);
         sh.fireRequests.length = 0;
      }

      // Guns go off, balls fly, some of them strike.
      for (const sh of this.ships.values()) {
         if (!sh.armed) continue;
         sh.battery.update(SIM_DT, {
            seaHeight: gunSea,
            targets,
            ownMatrix: sh.heelerMatrix,
            onShots: (shots) =>
               this.events.push({
                  kind: "shots",
                  shipId: sh.id,
                  shots: shots.map((b) => ({
                     origin: { ...b.origin },
                     vel: { ...b.vel },
                     ammo: b.ammo,
                     lb: b.lb,
                     drag: b.drag,
                  })),
               }),
            onHit: (hit) => {
               const target = this.ships.get(hit.target.id);
               if (!target) return;
               const ev = target.takeHit(hit, sh.id);
               if (ev) this.events.push(ev);
            },
         });
      }

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
         for (const ev of sh.drainEvents()) this.events.push(ev);
      }
   }

   /** Every hull that can be hit this tick. */
   targetBoxes(): TargetBox[] {
      const out: TargetBox[] = [];
      for (const sh of this.ships.values()) {
         const box = sh.targetBox();
         if (box) out.push(box);
      }
      return out;
   }

   /** Nearest fighting ship of another team, or null. */
   targetFor(ship: ServerShip): ServerShip | null {
      let best: ServerShip | null = null;
      let bestD = Infinity;
      for (const other of this.ships.values()) {
         if (other === ship || other.team === ship.team) continue;
         if (!other.alive || other.dmg.sunk || other.dmg.struck || !other.pose) continue;
         const d = Math.hypot(other.pos.x - ship.pos.x, other.pos.z - ship.pos.z);
         if (d < bestD) {
            bestD = d;
            best = other;
         }
      }
      return best;
   }

   alive(): ServerShip[] {
      return [...this.ships.values()].filter((s) => s.alive);
   }

   /** Ships of a team still able to fight. */
   fighting(team: string): ServerShip[] {
      return this.alive().filter((s) => s.team === team && !s.dmg.sunk && !s.dmg.struck);
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
