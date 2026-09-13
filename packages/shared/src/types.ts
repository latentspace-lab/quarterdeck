// types.ts - das Protokoll zwischen Client und Server.
//
// Phase 0 verschickt noch nichts. Die Typen stehen trotzdem jetzt schon fest,
// weil sie die Schnittstelle definieren, gegen die der Rest der Phase 0
// geschnitten wird: was hier drin steht, muss der Server besitzen und der
// Client nachsimulieren koennen.

import type { Tack } from "./physics.ts";
import type { Side } from "./damage.ts";
import type { XYZ } from "./ballistics.ts";

/**
 * Zustand eines Schiffs, wie ihn der Server je Tick veroeffentlicht.
 *
 * Die Felder driveMul..wreckDrag sind keine Anzeigewerte: sie sind die
 * Eingaben, mit denen BoatDynamics.step() gerechnet hat. Der Client muss von
 * einem bestaetigten Snapshot aus NACH-simulieren, also gehoeren sie dazu.
 */
export interface ShipState {
   id: string;
   vesselId: string;

   // --- Fahrzustand ---
   x: number;
   z: number;
   heading: number;
   speed: number;
   heel: number;
   sailSet: number;
   rudder: number;
   twa: number;
   tack: Tack;
   luffing: boolean;
   /** leeway angle (deg) - part of the dynamics state the client re-simulates from */
   leeway: number;
   isCapsized: boolean;
   alive: boolean;

   // --- Schadenszustand ---
   hullIntegrity: number;
   mastsStanding: number;
   flooding: number;
   afire: number;
   struck: boolean;
   sunk: boolean;

   // --- Damage detail (for the HUD plan and the remote models; changes rarely) ---
   hullPortBow: number;
   hullPortMid: number;
   hullPortQuarter: number;
   hullStbdBow: number;
   hullStbdMid: number;
   hullStbdQuarter: number;
   rigging: number;
   sails: number;
   rudderState: number;
   gunsPort: number;
   gunsStbd: number;
   /** mast integrity 0..1 */
   mastFore: number;
   mastMain: number;
   mastMizzen: number;
   /** 0 sound, 1 wounded, 2 gone */
   mastForeState: number;
   mastMainState: number;
   mastMizzenState: number;

   // --- Batterie ---
   reloadPort: number;
   reloadStbd: number;
   /** seconds a full reload takes (crew-dependent) */
   reloadTime: number;
   ammo: string;
   /** guns per side */
   guns: number;

   // --- Server-seitige Eingaben in BoatDynamics.step() ---
   driveMul: number;
   rudderMul: number;
   dragMul: number;
   turnBias: number;
   heelBias: number;
   stopped: boolean;
   wreckDrag: number;

   /** Letztes vom Server angewandtes InputCommand (Bestaetigung der Vorhersage) */
   lastSeq: number;
}

/**
 * Der Wasserzustand. Beides wird integriert und laesst sich nicht aus der
 * Tickzahl allein ausrechnen - deshalb gehoert es in den Snapshot.
 */
export interface SeaSync {
   /** nachlaufender Seegang (kn), server-integriert */
   seaWind: number;
   /** aufsummierte Wellenphase (s), server-integriert */
   phaseT: number;
}

/** Ein Eingabekommando des Clients fuer genau einen Tick. */
export interface InputCommand {
   seq: number;
   /** -1..1 */
   rudder: number;
   /** 0.25..1 (nur Rahsegler) */
   sailSet?: number;
   fire?: Side | "BOTH";
   ammo?: string;
   cutWreck?: boolean;
}

/** Was einen Raum beim Betreten vollstaendig beschreibt. */
export interface WorldParams {
   windBaseDir: number;
   windBaseSpeed: number;
   windVariability: number;
   terrainSeed: number;
   rngSeed: number;
   tickRate: number;
}

/** Vollstaendiger Snapshot eines Ticks. */
export interface WorldSnapshot {
   tick: number;
   sea: SeaSync;
   ships: ShipState[];
}

// ---------------------------------------------------------------------------
// Room protocol (Phase 1)
//
// State flows through the Colyseus schema (GameState in the server package);
// everything that is an occurrence rather than a value goes through the
// messages below.
// ---------------------------------------------------------------------------

/** Message names on the wire. */
export const MSG = {
   /** client -> server: one InputCommand */
   input: "input",
   /** server -> client, once after joining */
   welcome: "welcome",
   /** server -> all clients: a ServerEvent */
   event: "event",
} as const;

/** What the first client passes when creating a room. Anything omitted is seeded. */
export interface RoomCreateOptions {
   terrainSeed?: number;
   rngSeed?: number;
   windBaseDir?: number;
   windBaseSpeed?: number;
   windVariability?: number;
   /** Vessel ids of AI-captained enemies spawned to windward at room creation. */
   enemies?: string[];
   /** Shown in the lobby list. */
   roomName?: string;
}

/** Room names as registered on the server. */
export const ROOMS = {
   /** 2..8 players, AI enemies optional, listed in the lobby */
   battle: "battle",
   /** one player against AI, private */
   practice: "practice",
} as const;

/** What a room publishes for the lobby list (Colyseus metadata). */
export interface RoomMeta {
   name: string;
   mode: "battle" | "practice";
   enemies: string[];
   windBaseDir: number;
   windBaseSpeed: number;
   createdAt: number;
}

/** What a client passes when joining. */
export interface JoinOptions {
   vesselId?: string;
   name?: string;
}

export interface WelcomeMessage {
   /** The ship this client controls; equals the Colyseus session id */
   shipId: string;
   params: WorldParams;
   tick: number;
}

/** Something that happened to one ship (mast lost, holed, sunk, struck, aground, swamped, cutAway ...). */
export interface ShipEvent {
   type: string;
   shipId: string;
   [key: string]: unknown;
}

/** Something that happened between ships. */
export type WorldEvent =
   | { type: "collision"; a: string; b: string; closing: number }
   | { type: "locked"; a: string; b: string };

/** A broadside was ordered: play the thunder and the flashes. */
export interface SalvoEvent {
   kind: "salvo";
   shipId: string;
   side: Side;
   ammo: string;
   /** guns that will fire */
   count: number;
}

/**
 * Projectiles that left their muzzles this tick, with the exact origin and
 * velocity the server integrates. Clients replay the flight with the same
 * stepProjectile() and draw the balls where the server has them - no local
 * spread, no local hit test.
 */
export interface ShotsEvent {
   kind: "shots";
   shipId: string;
   shots: Array<{ origin: XYZ; vel: XYZ; ammo: string; lb: number; drag: number }>;
}

/** A projectile struck a ship. Everything the client needs for the effects. */
export interface HitEvent {
   kind: "hit";
   /** the ship that was hit */
   shipId: string;
   /** the ship that fired */
   from: string;
   side: Side;
   /** 0 = bow .. 1 = stern */
   s: number;
   /** height above the waterline in the target's frame (m) */
   y: number;
   inRig: boolean;
   world: XYZ;
   dir: XYZ;
   ammo: string;
   lb: number;
   range01: number;
   splinters: number;
   holed: boolean;
   below: boolean;
   mastBroken: string | null;
   casualties: number;
}

export type ServerEvent =
   | ({ kind: "ship" } & ShipEvent)
   | ({ kind: "world" } & WorldEvent)
   | SalvoEvent
   | ShotsEvent
   | HitEvent;
