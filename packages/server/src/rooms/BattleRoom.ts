// BattleRoom.ts - a Colyseus room around one Simulation.
//
// The room owns nothing the simulation does not: it turns clients into ships,
// messages into InputCommands, the tick into schema patches and simulation
// events into broadcasts. Everything that decides the game lives in
// sim/Simulation.ts and is tested without a socket in sight.

import { Room, CloseCode, type Client } from "@colyseus/core";
import {
   SIM_DT,
   SIM_HZ,
   MSG,
   getVessel,
   type InputCommand,
   type JoinOptions,
   type RoomCreateOptions,
   type RoomMeta,
   type WelcomeMessage,
} from "@segel/shared";
import { Simulation } from "../sim/Simulation.ts";
import type { ServerShip } from "../sim/ServerShip.ts";
import { GameState, ShipSchema } from "../state/GameState.ts";
import { takeNext } from "./inputQueue.ts";

/** Steps one interval callback may run before we drop time instead of catching up. */
const MAX_STEPS_PER_INTERVAL = 3;
const STEP_EPS = 1e-9;
/** How long a dropped client's ship is held for them before it is removed. */
export const RECONNECT_SECONDS = 60;
export const DEFAULT_VESSEL = "lydia";

function seedFromClock(): number {
   return (Date.now() ^ (Math.random() * 0x7fffffff)) >>> 0;
}

export class BattleRoom extends Room<{ state: GameState }> {
   maxClients = 8;
   sim!: Simulation;
   /** Which kind of room this is, for the lobby metadata. */
   protected mode: RoomMeta["mode"] = "battle";

   /** Per-ship input queue, drained at the next tick. (`Room.inputs` is Colyseus' own.) */
   private inputQueues = new Map<string, InputCommand[]>();
   private acc = 0;

   onCreate(options: RoomCreateOptions = {}) {
      this.sim = new Simulation({
         terrainSeed: options.terrainSeed ?? seedFromClock(),
         rngSeed: options.rngSeed ?? seedFromClock(),
         windBaseDir: options.windBaseDir,
         windBaseSpeed: options.windBaseSpeed,
         windVariability: options.windVariability,
      });

      const state = new GameState();
      state.terrainSeed = this.sim.params.terrainSeed;
      this.setState(state);

      const enemies = Array.isArray(options.enemies)
         ? options.enemies.filter((v) => typeof v === "string" && isKnownVessel(v)).slice(0, 6)
         : [];
      for (const ship of this.sim.spawnEnemies(enemies)) {
         this.state.ships.set(ship.id, new ShipSchema({ id: ship.id, vesselId: ship.vesselId, name: ship.name, ai: true }));
      }
      this.syncState();

      // What the lobby shows about this room.
      const meta: RoomMeta = {
         name: roomName(options.roomName),
         mode: this.mode,
         enemies,
         windBaseDir: this.sim.params.windBaseDir,
         windBaseSpeed: this.sim.params.windBaseSpeed,
         createdAt: Date.now(),
      };
      this.setMetadata(meta);

      // Patches at the tick rate; the simulation is what changes the state,
      // so there is nothing to send more often than that.
      this.setPatchRate(1000 / SIM_HZ);

      this.onMessage(MSG.input, (client, cmd: InputCommand) => {
         if (!isInputCommand(cmd)) return;
         let q = this.inputQueues.get(client.sessionId);
         if (!q) this.inputQueues.set(client.sessionId, (q = []));
         q.push(cmd);
      });

      this.setSimulationInterval((dtMs) => this.advance(dtMs), 1000 / SIM_HZ);
   }

   /**
    * Timer callback. Node timers jitter, so the elapsed time is accumulated and
    * paid out in whole SIM_DT steps - the client loop does the same. The
    * simulation itself never sees anything but SIM_DT.
    */
   advance(dtMs: number): void {
      const elapsed = dtMs / 1000;
      this.acc += elapsed > 0 && elapsed < 1 ? elapsed : 0;
      let steps = Math.floor((this.acc + STEP_EPS) / SIM_DT);
      if (steps > MAX_STEPS_PER_INTERVAL) {
         this.acc -= (steps - MAX_STEPS_PER_INTERVAL) * SIM_DT;
         steps = MAX_STEPS_PER_INTERVAL;
      }
      this.acc = Math.max(0, this.acc - steps * SIM_DT);
      for (let i = 0; i < steps; i++) this.tickOnce();
   }

   /**
    * Exactly one simulation step plus its bookkeeping. Exposed for tests.
    * One input per ship per tick - see inputQueue.ts for why and for what
    * happens to a backlog.
    */
   tickOnce(): void {
      for (const [id, q] of this.inputQueues) {
         const cmd = takeNext(q);
         if (cmd) this.sim.applyInputs(id, [cmd]);
      }
      this.sim.step();
      this.afterStep();
      this.syncState();
      for (const ev of this.sim.drainEvents()) this.broadcast(MSG.event, ev);
   }

   /** Hook after the simulation stepped, before the state is published. */
   protected afterStep(): void {}

   private syncState(): void {
      const st = this.state;
      st.tick = this.sim.tick;
      st.windDir = this.sim.wind.dir;
      st.windSpeed = this.sim.wind.speed;
      st.syncSea(this.sim.sea.toSync());
      for (const ship of this.sim.ships.values()) {
         const s = st.ships.get(ship.id);
         if (s) {
            s.sync(ship.toState());
            s.disconnected = ship.disconnected;
         }
      }
   }

   /** Where the n-th player starts; regatta rooms override this. */
   protected spawnFor(index: number) {
      return this.sim.spawnPoint(index);
   }

   /** Extra welcome fields; regatta rooms add the course. */
   protected welcomeExtras(): Partial<WelcomeMessage> {
      return {};
   }

   /** Hook after a player's ship exists (regatta rooms start its race). */
   protected onShipAdded(_ship: ServerShip): void {}

   onJoin(client: Client, options: JoinOptions = {}) {
      const vesselId = validVessel(options.vesselId);
      const spawn = this.spawnFor(this.sim.ships.size);
      const ship = this.sim.add(client.sessionId, vesselId, {
         ...spawn,
         name: typeof options.name === "string" ? options.name.slice(0, 32) : undefined,
      });
      this.onShipAdded(ship);
      this.state.ships.set(ship.id, new ShipSchema({ id: ship.id, vesselId, name: ship.name, ai: false }));
      this.inputQueues.set(ship.id, []);
      this.syncState();

      const welcome: WelcomeMessage = {
         shipId: ship.id,
         params: this.sim.params,
         tick: this.sim.tick,
         mode: this.mode,
         ...this.welcomeExtras(),
      };
      client.send(MSG.welcome, welcome);
   }

   async onLeave(client: Client, code?: number) {
      const ship = this.sim.ships.get(client.sessionId);
      if (!ship) return;
      if (code === CloseCode.CONSENTED) {
         this.removeShip(client.sessionId);
         return;
      }
      // Hold the ship for a while: rudder amidships, sail as set. If the
      // client comes back it picks up where it left off.
      ship.disconnected = true;
      ship.dyn.setRudder(0);
      try {
         await this.allowReconnection(client, RECONNECT_SECONDS);
         ship.disconnected = false;
      } catch {
         this.removeShip(client.sessionId);
      }
   }

   protected removeShip(id: string): void {
      this.sim.remove(id);
      this.inputQueues.delete(id);
      this.state.ships.delete(id);
   }

   onDispose() {
      this.inputQueues.clear();
   }
}

const ROOM_NAMES = ["Trafalgar", "Cape St Vincent", "The Nile", "Camperdown", "Copenhagen", "The Saintes", "Ushant", "Quiberon Bay"];
function roomName(given: unknown): string {
   if (typeof given === "string" && given.trim()) return given.trim().slice(0, 32);
   return ROOM_NAMES[Math.floor(Math.random() * ROOM_NAMES.length)];
}

function isKnownVessel(id: string): boolean {
   try {
      return getVessel(id).id === id;
   } catch {
      return false;
   }
}

function validVessel(id: unknown): string {
   return typeof id === "string" && isKnownVessel(id) ? id : DEFAULT_VESSEL;
}

/** Boundary validation: clients are untrusted. */
function isInputCommand(m: unknown): m is InputCommand {
   if (!m || typeof m !== "object") return false;
   const c = m as Record<string, unknown>;
   if (!Number.isFinite(c.seq) || !Number.isFinite(c.rudder)) return false;
   if (c.sailSet !== undefined && !Number.isFinite(c.sailSet)) return false;
   if (c.cutWreck !== undefined && typeof c.cutWreck !== "boolean") return false;
   if (c.fire !== undefined && c.fire !== "PORT" && c.fire !== "STBD" && c.fire !== "BOTH") return false;
   if (c.ammo !== undefined && typeof c.ammo !== "string") return false;
   return true;
}

export { SIM_DT };
