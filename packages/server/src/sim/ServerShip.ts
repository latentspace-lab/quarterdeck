// ServerShip.ts - a ship as the server sees it.
//
// Dynamics, damage, crew and pose - and not a single Three.js object. Where
// the client's Ship class turns a damage result into splinters and a falling
// mast mesh, this class only books the consequences that change the game:
// casualties, wreck drag, flooding, events for the clients.

import {
   BoatDynamics,
   DamageModel,
   Crew,
   shipPose,
   swampStep,
   freeboardOf,
   deriveRng,
   getVessel,
   clamp,
   type Vessel,
   type Rng,
   type InputCommand,
   type ShipState,
   type ShipEvent,
   type Pose,
   type SeaHeightFn,
   type WindSample,
   type MastKey,
   type CollidableShip,
   type RamInput,
   type SwampState,
} from "@segel/shared";

export interface ServerShipOptions {
   x?: number;
   z?: number;
   heading?: number;
   speed?: number;
   /** AI-controlled ships strike their colours when beaten; human ships do not. */
   ai?: boolean;
   name?: string;
}

/**
 * Wreck drag substitute.
 *
 * The client derives drag from its rigid-body tether simulation
 * (DebrisField.tetherLoad): per piece `clamp(0.35 + 0.65 * pull) *
 * clamp(mass / 9000, 0.15, 1)`. The server has no debris bodies, so it uses
 * the same shape with the tether pull taken at its typical value (0.5) and a
 * mast mass estimated from displacement. Tuned to land in the same range as
 * the client for the vessels in the catalogue.
 */
const MAST_MASS_SHARE: Record<MastKey, number> = { fore: 0.85, main: 1.0, mizzen: 0.55 };
export function wreckLoadFor(vessel: Vessel, mast: MastKey): number {
   const tons = vessel.hull.displacement || 100;
   const massKg = clamp(tons * 9, 500, 14000) * MAST_MASS_SHARE[mast];
   return (0.35 + 0.65 * 0.5) * clamp(massKg / 9000, 0.15, 1);
}

export class ServerShip implements CollidableShip {
   readonly id: string;
   readonly vesselId: string;
   readonly vessel: Vessel;
   readonly name: string;
   readonly ai: boolean;
   readonly rng: Rng;
   readonly dyn: BoatDynamics;
   readonly dmg: DamageModel;
   readonly crew: Crew;
   /** Bulwark height above the waterline (m) */
   readonly freeboard: number;

   alive = true;
   sinkTimer = 0;
   groundedFor = 0;
   _ramCooldown = 0;
   /** Last InputCommand applied - the prediction ack for the owning client */
   lastSeq = 0;
   /** 0..1 - resistance from masts dragging alongside */
   wreckDrag = 0;
   /** Recoil heel impulse (deg); the battery feeds this in PR B */
   recoilRoll = 0;
   /** Fallen masts still hanging in the rigging alongside */
   readonly wreckage = new Set<MastKey>();
   /** Where the hull sits on the sea after the last step; null while sinking */
   pose: Pose | null = null;
   /** The controlling client is away; the ship holds rudder and sail */
   disconnected = false;

   private readonly swamp: SwampState = { swampT: 0, railClear: 0 };
   private events: ShipEvent[] = [];

   constructor(id: string, vesselId: string, seed: number, opts: ServerShipOptions = {}) {
      this.id = id;
      this.vesselId = vesselId;
      this.vessel = getVessel(vesselId);
      this.name = opts.name ?? this.vessel.name;
      this.ai = !!opts.ai;
      this.rng = deriveRng(seed, id);
      this.dyn = new BoatDynamics({
         vessel: this.vessel,
         heading: opts.heading ?? 0,
         x: opts.x ?? 0,
         z: opts.z ?? 0,
      });
      this.dyn.speed = opts.speed ?? 0;
      this.dyn.groundHeading = this.dyn.heading;
      this.dmg = new DamageModel(this.vessel, { isPlayer: !this.ai, rng: this.rng });
      this.crew = new Crew(this.vessel, { isPlayer: !this.ai, rng: this.rng });
      // Same rule as the client's Ship: warships measure to the bulwark, the
      // yacht has none.
      this.freeboard =
         this.vessel.rig === "square" ? freeboardOf(this.vessel.hull) : this.vessel.hull.draft * 0.55;
      this.swamp.railClear = this.freeboard;
   }

   get pos() {
      return this.dyn.pos;
   }
   get tons(): number {
      return this.vessel.hull.displacement || 100;
   }
   get railClear(): number {
      return this.swamp.railClear;
   }

   applyInput(cmd: InputCommand): void {
      this.dyn.setRudder(cmd.rudder);
      if (cmd.sailSet !== undefined && this.vessel.rig === "square") {
         this.dyn.sailSet = clamp(cmd.sailSet, 0.25, 1);
      }
      if (cmd.cutWreck) this.cutAwayWreckage();
      this.lastSeq = cmd.seq;
   }

   /** One fixed step. `sea` samples the full-scale surface (shipPose convention). */
   step(dt: number, wind: WindSample, sea: SeaHeightFn): void {
      if (!this.alive) return;
      const D = this.dmg;
      const dyn = this.dyn;

      // --- Damage over time ------------------------------------------------
      D.update(dt, { heel: dyn.heel, pump: this.crew.pumping() });
      if (this.vessel.rig === "square") {
         D.stressRig(dt, { windKts: wind.speedKts, sailSet: dyn.sailSet, twa: dyn.twa });
      }
      // A bled-out crew does not fight on.
      if (this.ai && !D.struck && this.crew.morale() < 0.12 && this.crew.losses > 8) {
         D.struck = true;
         D._event("struck", {});
      }
      this.collectEvents();

      // --- Consequences on the dynamics ------------------------------------
      this.wreckDrag = 0;
      for (const m of this.wreckage) this.wreckDrag += wreckLoadFor(this.vessel, m);
      this.wreckDrag = clamp(this.wreckDrag, 0, 1);
      dyn.driveMul = D.driveFactor() * (0.55 + 0.45 * this.crew.sailHandling());
      dyn.rudderMul = D.rudderFactor() * (1 - 0.35 * this.wreckDrag) * this.crew.command();
      dyn.dragMul = 1 + 1.8 * this.wreckDrag + 0.7 * D.flooding;
      // A wreck on one side pulls the ship that way all the time.
      dyn.turnBias = this.wreckDrag * 7 * (dyn.twaSigned > 0 ? -1 : 1);
      dyn.heelBias = D.floodHeel();

      // --- Sail --------------------------------------------------------------
      dyn.step(dt, wind, null);

      // --- Sinking -----------------------------------------------------------
      if (D.sunk) {
         this.sinkTimer += dt;
         this.pose = null;
         if (this.sinkTimer > 16) this.alive = false;
         return;
      }

      // --- Pose and water over the rail --------------------------------------
      this.recoilRoll += (0 - this.recoilRoll) * clamp(dt * 9, 0, 1);
      this.pose = shipPose(
         {
            pos: dyn.pos,
            heading: dyn.heading,
            heel: dyn.heel,
            twaSigned: dyn.twaSigned,
            flooding: D.flooding,
            recoilRoll: this.recoilRoll,
            hull: this.vessel.hull,
         },
         sea,
      );
      swampStep(this.swamp, dt, this.pose, this.freeboard, this.vessel.hull.beam / 2,
         { dmg: D, crew: this.crew }, this.rng);
      this.collectEvents();
   }

   /**
    * Move damage-model events into the ship's queue and book what the client's
    * Ship class books visually: a falling mast takes the topmen in its shrouds
    * with it and sweeps the deck, and it stays alongside as wreckage.
    */
   private collectEvents(): void {
      for (const ev of this.dmg.drainEvents()) {
         if (ev.type === "mastLost") this.mastLost(ev.mast as MastKey);
         this.events.push({ ...ev, shipId: this.id });
      }
   }

   private mastLost(key: MastKey): void {
      if (this.wreckage.has(key)) return;
      this.wreckage.add(key);
      const aloft = Math.round(this.crew.total * (0.008 + this.rng() * 0.014));
      if (aloft > 0) this.crew.hit(aloft, "rigg");
      const onDeck = Math.round(this.crew.total * (0.003 + this.rng() * 0.007));
      if (onDeck > 0) this.crew.hit(onDeck, "deck");
      this.crew.shock(0.3);
   }

   /** Axes to the shrouds: the wreck goes, the ship is free again. */
   cutAwayWreckage(): number {
      const n = this.wreckage.size;
      if (n === 0) return 0;
      this.wreckage.clear();
      this.events.push({ type: "cutAway", shipId: this.id, n });
      return n;
   }

   // --- Collision and grounding (called by collide.step / groundStep) ----------
   takeRam(info: RamInput) {
      const res = this.dmg.applyRam(info);
      // A collision throws half the watch off their feet.
      const n = Math.round(this.crew.total * clamp(Math.abs(info.closingKts || 0) * 0.0016, 0, 0.05));
      if (n > 0) this.crew.hit(n, "deck");
      this.crew.shock(0.22);
      return res;
   }

   takeGrounding(info: { speedKts: number; draft: number; depth: number }): number {
      const d = this.dmg.applyGrounding(info);
      if (d > 0.04) {
         const n = Math.round(this.crew.total * clamp(d * 0.12, 0, 0.04));
         if (n > 0) this.crew.hit(n, "deck");
         this.crew.shock(0.18);
      }
      return d;
   }

   drainEvents(): ShipEvent[] {
      const e = this.events;
      this.events = [];
      return e;
   }

   toState(): ShipState {
      const d = this.dyn;
      return {
         id: this.id,
         vesselId: this.vesselId,
         x: d.pos.x,
         z: d.pos.z,
         heading: d.heading,
         speed: d.speed,
         heel: d.heel,
         sailSet: d.sailSet,
         rudder: d.rudder,
         twa: d.twaSigned,
         tack: d.tack,
         luffing: d.luffing,
         isCapsized: d.isCapsized,
         alive: this.alive,
         hullIntegrity: this.dmg.integrity(),
         mastsStanding: this.dmg.mastsStanding(),
         flooding: this.dmg.flooding,
         afire: this.dmg.afire,
         struck: this.dmg.struck,
         sunk: this.dmg.sunk,
         reloadPort: 0,
         reloadStbd: 0,
         ammo: "ball",
         driveMul: d.driveMul,
         rudderMul: d.rudderMul,
         dragMul: d.dragMul,
         turnBias: d.turnBias,
         heelBias: d.heelBias,
         stopped: d.stopped,
         wreckDrag: this.wreckDrag,
         lastSeq: this.lastSeq,
      };
   }
}
