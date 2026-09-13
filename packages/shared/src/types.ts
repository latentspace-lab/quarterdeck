// types.ts - das Protokoll zwischen Client und Server.
//
// Phase 0 verschickt noch nichts. Die Typen stehen trotzdem jetzt schon fest,
// weil sie die Schnittstelle definieren, gegen die der Rest der Phase 0
// geschnitten wird: was hier drin steht, muss der Server besitzen und der
// Client nachsimulieren koennen.

import type { Tack } from "./physics.ts";
import type { Side } from "./damage.ts";

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
   isCapsized: boolean;
   alive: boolean;

   // --- Schadenszustand ---
   hullIntegrity: number;
   mastsStanding: number;
   flooding: number;
   afire: number;
   struck: boolean;
   sunk: boolean;

   // --- Batterie ---
   reloadPort: number;
   reloadStbd: number;
   ammo: string;

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
