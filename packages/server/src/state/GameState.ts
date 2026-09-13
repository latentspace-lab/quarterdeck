// GameState.ts - the synchronised room state.
//
// Colyseus encodes only the fields that changed since the last patch, so a
// ship sailing straight costs a handful of bytes per tick and a ship at anchor
// costs nothing.
//
// Declared with the schema()/t.* builders rather than @type decorators: the
// test suite runs this file through Node's type stripping, which does not
// execute decorators, and defineTypes() is deprecated in schema v5.

import { schema, t, type SchemaType } from "@colyseus/schema";
import type { ShipState, SeaSync } from "@segel/shared";

export const ShipSchema = schema(
   {
      id: t.string().default(""),
      vesselId: t.string().default(""),
      name: t.string().default(""),
      /** true for AI ships; clients can label them */
      ai: t.boolean().default(false),
      /** the controlling client is away */
      disconnected: t.boolean().default(false),

      x: t.float32().default(0),
      z: t.float32().default(0),
      heading: t.float32().default(0),
      speed: t.float32().default(0),
      heel: t.float32().default(0),
      sailSet: t.float32().default(1),
      rudder: t.float32().default(0),
      twa: t.float32().default(0),
      tack: t.string().default("PORT"),
      luffing: t.boolean().default(false),
      isCapsized: t.boolean().default(false),
      alive: t.boolean().default(true),

      hullIntegrity: t.float32().default(1),
      mastsStanding: t.uint8().default(3),
      flooding: t.float32().default(0),
      afire: t.float32().default(0),
      struck: t.boolean().default(false),
      sunk: t.boolean().default(false),

      reloadPort: t.float32().default(0),
      reloadStbd: t.float32().default(0),
      ammo: t.string().default("ball"),

      // Server-side inputs to BoatDynamics.step(): the client re-simulates
      // from an acknowledged state, so they travel with it.
      driveMul: t.float32().default(1),
      rudderMul: t.float32().default(1),
      dragMul: t.float32().default(1),
      turnBias: t.float32().default(0),
      heelBias: t.float32().default(0),
      stopped: t.boolean().default(false),
      wreckDrag: t.float32().default(0),
      /** last InputCommand the server applied - the prediction ack */
      lastSeq: t.uint32().default(0),

      /** Copy a ShipState in. Assigning an unchanged value does not mark the field dirty. */
      sync(s: ShipState): void {
         this.x = s.x; this.z = s.z; this.heading = s.heading; this.speed = s.speed; this.heel = s.heel;
         this.sailSet = s.sailSet; this.rudder = s.rudder; this.twa = s.twa; this.tack = s.tack;
         this.luffing = s.luffing; this.isCapsized = s.isCapsized; this.alive = s.alive;
         this.hullIntegrity = s.hullIntegrity; this.mastsStanding = s.mastsStanding;
         this.flooding = s.flooding; this.afire = s.afire; this.struck = s.struck; this.sunk = s.sunk;
         this.reloadPort = s.reloadPort; this.reloadStbd = s.reloadStbd; this.ammo = s.ammo;
         this.driveMul = s.driveMul; this.rudderMul = s.rudderMul; this.dragMul = s.dragMul;
         this.turnBias = s.turnBias; this.heelBias = s.heelBias; this.stopped = s.stopped;
         this.wreckDrag = s.wreckDrag; this.lastSeq = s.lastSeq;
      },
   },
   "ShipSchema",
);
export type ShipSchema = SchemaType<typeof ShipSchema>;

export const GameState = schema(
   {
      tick: t.uint32().default(0),
      windDir: t.float32().default(0),
      windSpeed: t.float32().default(0),
      /** The sea is NOT derivable from the clock - see SeaSync */
      seaWind: t.float32().default(0),
      phaseT: t.float32().default(0),
      terrainSeed: t.uint32().default(0),
      ships: t.map(ShipSchema),

      syncSea(s: SeaSync): void {
         this.seaWind = s.seaWind;
         this.phaseT = s.phaseT;
      },
   },
   "GameState",
);
export type GameState = SchemaType<typeof GameState>;
