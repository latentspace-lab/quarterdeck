// ServerShip.ts - a ship as the server sees it.
//
// Dynamics, damage, crew, guns and pose - and not a single Three.js object.
// Where the client's Ship class turns a damage result into splinters and a
// falling mast mesh, this class only books the consequences that change the
// game: casualties, wreck drag, flooding, events for the clients.

import { Matrix4 } from "three/src/math/Matrix4.js";
import {
   BoatDynamics,
   DamageModel,
   Crew,
   shipPose,
   poseMatrix,
   swampStep,
   freeboardOf,
   rigTopOf,
   rigHalfWidthOf,
   deriveRng,
   getVessel,
   clamp,
   lerp,
   AMMO,
   type Vessel,
   type Rng,
   type Side,
   type InputCommand,
   type ShipState,
   type ServerEvent,
   type HitEvent,
   type Pose,
   type SeaHeightFn,
   type WindSample,
   type MastKey,
   type CollidableShip,
   type RamInput,
   type SwampState,
   type TargetBox,
   type ProjectileHit,
} from "@segel/shared";
import { ServerBattery } from "./ServerBattery.ts";

export interface ServerShipOptions {
   x?: number;
   z?: number;
   heading?: number;
   speed?: number;
   /** AI-controlled ships strike their colours when beaten; human ships do not. */
   ai?: boolean;
   name?: string;
   /** Ships fire on ships of another team. Humans default to "blue", AI to "red". */
   team?: string;
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
   readonly team: string;
   readonly rng: Rng;
   readonly dyn: BoatDynamics;
   readonly dmg: DamageModel;
   readonly crew: Crew;
   readonly battery: ServerBattery;
   /** Bulwark height above the waterline (m) */
   readonly freeboard: number;
   /** Human gunnery; captains pass their own skill */
   gunnery = 1.0;

   alive = true;
   sinkTimer = 0;
   groundedFor = 0;
   _ramCooldown = 0;
   lastHitAt = -99;
   /** Last InputCommand applied - the prediction ack for the owning client */
   lastSeq = 0;
   /** 0..1 - resistance from masts dragging alongside */
   wreckDrag = 0;
   /** Recoil heel impulse (deg), fed by the battery */
   recoilRoll = 0;
   /** Fallen masts still hanging in the rigging alongside */
   readonly wreckage = new Set<MastKey>();
   /** Where the hull sits on the sea after the last step; null while sinking */
   pose: Pose | null = null;
   /** World matrix of the heeler frame for this pose - what the hit test uses */
   readonly heelerMatrix = new Matrix4();
   /** The controlling client is away; the ship holds rudder and sail */
   disconnected = false;
   /** Broadsides ordered by the client, resolved by the simulation this tick */
   fireRequests: Side[] = [];

   private readonly swamp: SwampState = { swampT: 0, railClear: 0 };
   /** Everything the clients need to hear about this ship, in order */
   private events: ServerEvent[] = [];

   constructor(id: string, vesselId: string, seed: number, opts: ServerShipOptions = {}) {
      this.id = id;
      this.vesselId = vesselId;
      this.vessel = getVessel(vesselId);
      this.name = opts.name ?? this.vessel.name;
      this.ai = !!opts.ai;
      this.team = opts.team ?? (this.ai ? "red" : "blue");
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
      this.battery = new ServerBattery(id, this.vessel, this.rng);
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
   get armed(): boolean {
      return this.battery.enabled;
   }

   applyInput(cmd: InputCommand): void {
      this.dyn.setRudder(cmd.rudder);
      if (cmd.sailSet !== undefined && this.vessel.rig === "square") {
         this.dyn.sailSet = clamp(cmd.sailSet, 0.25, 1);
      }
      if (cmd.cutWreck) this.cutAwayWreckage();
      if (cmd.ammo !== undefined && AMMO[cmd.ammo]) this.battery.setAmmo(cmd.ammo);
      if (cmd.fire === "BOTH") this.fireRequests.push("PORT", "STBD");
      else if (cmd.fire === "PORT" || cmd.fire === "STBD") this.fireRequests.push(cmd.fire);
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

      // --- Consequences on the dynamics and the guns ------------------------
      this.wreckDrag = 0;
      for (const m of this.wreckage) this.wreckDrag += wreckLoadFor(this.vessel, m);
      this.wreckDrag = clamp(this.wreckDrag, 0, 1);
      dyn.driveMul = D.driveFactor() * (0.55 + 0.45 * this.crew.sailHandling());
      dyn.rudderMul = D.rudderFactor() * (1 - 0.35 * this.wreckDrag) * this.crew.command();
      dyn.dragMul = 1 + 1.8 * this.wreckDrag + 0.7 * D.flooding;
      // A wreck on one side pulls the ship that way all the time.
      dyn.turnBias = this.wreckDrag * 7 * (dyn.twaSigned > 0 ? -1 : 1);
      dyn.heelBias = D.floodHeel();
      const gun = this.crew.gunnery();
      this.battery.effectiveness.PORT = D.gunFraction("PORT") * gun.served;
      this.battery.effectiveness.STBD = D.gunFraction("STBD") * gun.served;
      if (this.vessel.guns) this.battery.reloadTime = this.vessel.guns.reload / Math.max(gun.rate, 0.2);

      // --- Sail --------------------------------------------------------------
      dyn.step(dt, wind, null);
      this.lastHitAt += dt;

      // --- Sinking -----------------------------------------------------------
      if (D.sunk) {
         this.sinkTimer += dt;
         this.pose = null;
         if (this.sinkTimer > 16) this.alive = false;
         return;
      }

      // --- Pose, hit matrix, water over the rail ---------------------------
      const kick = this.battery.rollKick * this.battery.rollKickSide;
      this.recoilRoll = lerp(this.recoilRoll, kick, clamp(dt * 9, 0, 1));
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
      poseMatrix(dyn.pos, this.pose, this.heelerMatrix);
      swampStep(this.swamp, dt, this.pose, this.freeboard, this.vessel.hull.beam / 2,
         { dmg: D, crew: this.crew }, this.rng);
      this.collectEvents();
   }

   /** Hit box for the shared ballistics; null while the ship cannot be hit (sinking). */
   targetBox(): TargetBox | null {
      if (!this.alive || !this.pose) return null;
      const square = this.vessel.rig === "square";
      return {
         id: this.id,
         matrixWorld: this.heelerMatrix,
         LOA: this.vessel.hull.loa,
         BEAM: this.vessel.hull.beam,
         DRAFT: this.vessel.hull.draft,
         FB: this.freeboard,
         rigTop: square && this.dmg.mastsStanding() > 0 ? rigTopOf(this.vessel) : 0,
         rigHalfWidth: square ? rigHalfWidthOf(this.vessel) : this.vessel.hull.beam,
      };
   }

   /** Give the order for a broadside. Queues the salvo event; true if the guns will fire. */
   orderFire(side: Side, gunnery: number, ownMatrix: Matrix4, targets: Iterable<TargetBox>): boolean {
      if (!this.alive || this.dmg.sunk || this.dyn.isCapsized) return false;
      const salvo = this.battery.fire(side, gunnery, ownMatrix, targets);
      if (!salvo) return false;
      this.events.push({ kind: "salvo", shipId: this.id, side, ammo: this.battery.ammo, count: salvo.length });
      return true;
   }

   /** A projectile struck this ship. Books the damage and returns the event for the clients. */
   takeHit(hit: ProjectileHit, from: string): HitEvent | null {
      if (!this.alive) return null;
      const res = this.dmg.applyHit({
         side: hit.side,
         s: hit.s,
         y: hit.y,
         ammo: hit.ammo,
         lb: hit.lb,
         range01: hit.range01,
         freeboard: this.freeboard,
      });
      if (!res) return null;
      let casualties = 0;
      if (res.crew && res.crew.n > 0) {
         const c = this.crew.hit(res.crew.n, res.crew.where);
         casualties = c.hurt + c.killed;
      }
      this.lastHitAt = 0;
      this.collectEvents();
      return {
         kind: "hit",
         shipId: this.id,
         from,
         side: hit.side,
         s: hit.s,
         y: hit.y,
         inRig: hit.inRig,
         world: { x: hit.world.x, y: hit.world.y, z: hit.world.z },
         dir: { x: hit.dir.x, y: hit.dir.y, z: hit.dir.z },
         ammo: hit.ammo.id,
         lb: hit.lb,
         range01: hit.range01,
         splinters: res.splinters,
         holed: res.holed,
         below: res.below,
         mastBroken: res.mastBroken ? res.mastBroken.mast : null,
         casualties,
      };
   }

   /**
    * Move damage-model events into the ship's queue and book what the client's
    * Ship class books visually: a falling mast takes the topmen in its shrouds
    * with it and sweeps the deck, and it stays alongside as wreckage.
    */
   private collectEvents(): void {
      for (const ev of this.dmg.drainEvents()) {
         if (ev.type === "mastLost") this.mastLost(ev.mast as MastKey);
         this.events.push({ kind: "ship", ...ev, shipId: this.id });
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
      this.events.push({ kind: "ship", type: "cutAway", shipId: this.id, n });
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

   drainEvents(): ServerEvent[] {
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
         reloadPort: this.battery.reload.PORT,
         reloadStbd: this.battery.reload.STBD,
         ammo: this.battery.ammo,
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
