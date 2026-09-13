// headless.ts - Simulation ohne Browser.
//
// Phase 0 liefert noch keinen Netzwerkserver; Colyseus kommt in Phase 1. Was
// dieses Paket JETZT schon leistet, ist der Beweis, auf dem die ganze Phase 1
// aufbaut: @segel/shared laeuft in Node, ohne DOM, ohne WebGL, ohne
// Three.js-Renderer - und liefert bei gleichem Seed und gleichen Eingaben
// exakt denselben Zustand.
//
// Aufruf:  npm run server

import {
   BoatDynamics,
   Wind,
   SeaState,
   SIM_DT,
   SIM_HZ,
   World,
   setActiveWorld,
   getVessel,
   makeRng,
   deriveRng,
   DamageModel,
   Crew,
   type InputCommand,
   type ShipState,
   type WorldParams,
   type WorldSnapshot,
} from "@segel/shared";

/**
 * Ein Schiff, wie der Server es fuehrt: Fahrdynamik, Schaden, Mannschaft -
 * und kein einziges Three.js-Objekt.
 */
export class HeadlessShip {
   readonly id: string;
   readonly vesselId: string;
   readonly dyn: BoatDynamics;
   readonly dmg: DamageModel;
   readonly crew: Crew;
   lastSeq = 0;

   constructor(id: string, vesselId: string, seed: number, x = 0, z = 0, heading = 0) {
      this.id = id;
      this.vesselId = vesselId;
      const vessel = getVessel(vesselId);
      this.dyn = new BoatDynamics({ vessel, heading, x, z });
      this.dmg = new DamageModel(vessel, { rng: deriveRng(seed, id + ":damage") });
      this.crew = new Crew(vessel, { rng: deriveRng(seed, id + ":crew") });
   }

   applyInput(cmd: InputCommand): void {
      this.dyn.setRudder(cmd.rudder);
      if (cmd.sailSet !== undefined) this.dyn.sailSet = cmd.sailSet;
      this.lastSeq = cmd.seq;
   }

   step(dt: number, wind: { dir: number; speedKts: number }): void {
      this.dyn.driveMul = this.dmg.driveFactor();
      this.dyn.rudderMul = this.dmg.rudderFactor();
      this.dyn.dragMul = 1 + 0.7 * this.dmg.flooding;
      this.dyn.heelBias = this.dmg.floodHeel();
      this.dyn.step(dt, wind);
      this.dmg.update(dt, { heel: this.dyn.heel, pump: this.crew.pumping() });
      this.crew.update(dt);
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
         alive: !this.dmg.sunk,
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
         wreckDrag: 0,
         lastSeq: this.lastSeq,
      };
   }
}

/** Ein Raum: eine Welt, ein Wind, ein Seegang, n Schiffe, feste Tickrate. */
export class HeadlessRoom {
   readonly params: WorldParams;
   readonly world: World;
   readonly wind: Wind;
   readonly sea: SeaState;
   readonly ships = new Map<string, HeadlessShip>();
   tick = 0;
   t = 0;

   constructor(params: WorldParams) {
      this.params = params;
      this.world = new World(params.terrainSeed);
      setActiveWorld(this.world);
      this.wind = new Wind({
         dir: params.windBaseDir,
         speed: params.windBaseSpeed,
         variability: params.windVariability,
      });
      this.sea = new SeaState(params.windBaseSpeed);
   }

   add(id: string, vesselId: string, x = 0, z = 0, heading = 0): HeadlessShip {
      const s = new HeadlessShip(id, vesselId, this.params.rngSeed, x, z, heading);
      this.ships.set(id, s);
      return s;
   }

   /** Genau ein Simulationsschritt. Immer SIM_DT - nie etwas anderes. */
   step(inputs: InputCommand[] = [], forId?: string): void {
      if (forId) {
         const sh = this.ships.get(forId);
         if (sh) for (const cmd of inputs) sh.applyInput(cmd);
      }
      this.t += SIM_DT;
      this.tick++;
      this.wind.update(SIM_DT, this.t);
      this.sea.step(SIM_DT, this.wind.speed, this.wind.dir);
      const w = { dir: this.wind.dir, speedKts: this.wind.speed };
      for (const sh of this.ships.values()) sh.step(SIM_DT, w);
   }

   snapshot(): WorldSnapshot {
      return {
         tick: this.tick,
         sea: this.sea.toSync(),
         ships: [...this.ships.values()].map((s) => s.toState()),
      };
   }
}

export const DEFAULT_PARAMS: WorldParams = {
   windBaseDir: 20,
   windBaseSpeed: 16,
   windVariability: 1,
   terrainSeed: 1337,
   rngSeed: 4242,
   tickRate: SIM_HZ,
};

// --- Selbsttest beim direkten Aufruf ---------------------------------------
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   room.add("a", "lydia", 0, 0, 110);
   room.add("b", "amelie", 420, 120, 270);

   const rng = makeRng(DEFAULT_PARAMS.rngSeed);
   const t0 = Date.now();
   const TICKS = SIM_HZ * 120; // zwei Minuten Spielzeit
   for (let i = 0; i < TICKS; i++) {
      room.step([{ seq: i, rudder: Math.sin(i * 0.004) * 0.12 }], "a");
      if (rng() < 0.002) room.ships.get("b")!.dmg.applyHit({ side: "PORT", s: 0.5, y: 3 });
   }
   const ms = Date.now() - t0;
   const snap = room.snapshot();
   console.log(`@segel/shared headless: ${TICKS} Ticks (${TICKS / SIM_HZ}s Spielzeit) in ${ms} ms`);
   console.log(`  Welt ${room.world.seed}: ${room.world.islands.length} Inseln, ${room.world.reefs.length} Riffe`);
   console.log(`  Seegang ${room.sea.seaWind.toFixed(2)} kn, Phase ${room.sea.phaseT.toFixed(2)} s`);
   for (const s of snap.ships) {
      console.log(
         `  ${s.id} (${s.vesselId}): ${s.speed.toFixed(2)} kn, Kurs ${s.heading.toFixed(1)}°, ` +
            `Rumpf ${(s.hullIntegrity * 100).toFixed(0)} %, Masten ${s.mastsStanding}`,
      );
   }
}
