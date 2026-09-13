// fleet.js - gegnerische Schiffe und ihre Kapitaene.
//
// Der Kapitaen kann nur, was der Spieler auch kann: er steuert das Ruder,
// setzt oder refft Segel und gibt Feuerbefehle. Er kann nicht gegen den Wind
// segeln und nicht schneller laufen, als die Polarkurve hergibt.
//
// Taktik: Die Royal Navy schoss auf den Rumpf (Schiff niederkaempfen), die
// franzoesische Marine bevorzugt in die Takelage (Gegner manoevrierunfaehig
// machen, dann abdrehen). Beide Doktrinen sind hier abgebildet und fuehren zu
// spuerbar verschiedenen Gefechten.

import { Ship } from "./ship.js";
import { getVessel } from "./vessels.js";
import { AMMO } from "./damage.js";
import { clamp, normDeg, diffDeg } from "./utils.js";

// Kurs, den das Schiff tatsaechlich anliegen kann: liegt der Wunschkurs in der
// No-Go-Zone, wird auf die naechste segelbare Kante gedreht.
export function sailableHeading(desired, windDir, noGo) {
   const twa = diffDeg(desired, windDir);       // = windDir - desired
   if (Math.abs(twa) >= noGo) return normDeg(desired);
   // naechste Kante: mit dem Wind von Steuerbord oder von Backbord
   const a = normDeg(windDir - noGo);
   const b = normDeg(windDir + noGo);
   return Math.abs(diffDeg(desired, a)) < Math.abs(diffDeg(desired, b)) ? a : b;
}

export class Captain {
   constructor(ship, opts = {}) {
      this.ship = ship;
      this.doctrine = opts.doctrine || "rig";     // "rig" | "hull"
      this.skill = clamp(opts.skill ?? 0.85, 0.3, 1.5);
      this.engage = opts.engage ?? 190;           // gewuenschte Kampfentfernung (m)
      this.aggression = opts.aggression ?? 1;
      this.name = opts.name || ship.name;
      this.state = "engage";
      // Zufallsquelle (Phase 0D): ohne Angabe erbt der Kapitaen den Strom
      // seines Schiffs. Damit ist ein KI-Gefecht bei gleichem Seed wiederholbar.
      this.rng = opts.rng || (ship && ship.rng) || Math.random;
      this._side = 1;         // preferred side to engage on (+1 = the +x/port side, -1 = starboard)
      this._sideTimer = 0;
      this._lastFire = 0;
   }

   // ctx: { wind, target (Ship), dt }
   update(dt, ctx) {
      const ship = this.ship;
      const dyn = ship.dyn;
      const D = ship.dmg;
      this._lastFire += dt;

      if (!ship.alive || D.sunk) return;

      // --- Flagge gestrichen: beidrehen und nicht mehr feuern -------------
      if (D.struck) {
         this.state = "struck";
         dyn.sailSet = 0.25;
         dyn.setRudder(0);
         return;
      }

      const target = ctx.target;
      if (!target || !target.alive) {
         dyn.sailSet = 1;
         dyn.setRudder(0);
         return;
      }

      const dx = target.pos.x - ship.pos.x;
      const dz = target.pos.z - ship.pos.z;
      const dist = Math.hypot(dx, dz);
      const bearing = normDeg(Math.atan2(dx, dz) * 180 / Math.PI);
      const rel = diffDeg(dyn.heading, bearing);   // + = Ziel an Steuerbord

      // --- Lage beurteilen -------------------------------------------------
      // Schwer angeschlagen: abdrehen und laufen, solange noch Masten stehen.
      const beaten = D.integrity() < 0.45 || D.mastsStanding() < 2 || D.flooding > 0.3;
      this.state = beaten && D.mastsStanding() >= 1 ? "flee" : "engage";

      // --- Gefechtsseite waehlen (nicht jede Sekunde wechseln) -------------
      this._sideTimer -= dt;
      if (this._sideTimer <= 0) {
         this._sideTimer = 12 + this.rng() * 8;
         // die Seite mit mehr einsatzfaehigen Rohren
         const p = D.gunFraction("PORT"), s = D.gunFraction("STBD");
         this._side = s > p + 0.12 ? 1 : p > s + 0.12 ? -1 : (rel >= 0 ? 1 : -1);
      }

      // --- Wunschkurs ------------------------------------------------------
      let desired;
      if (this.state === "flee") {
         // vor dem Wind weglaufen - der schnellste Kurs eines Rahseglers
         desired = normDeg(ctx.wind.dir + 180);
      } else if (dist > this.engage * 1.35) {
         // aufkommen, aber schraeg, damit die Breitseite gleich traegt
         desired = normDeg(bearing - this._side * 28);
      } else if (dist < this.engage * 0.5) {
         // zu dicht dran - abfallen, sonst wird man gerammt oder geentert
         desired = normDeg(bearing + this._side * 125);
      } else {
         // laengsseit bleiben: Gegner querab halten
         desired = normDeg(bearing - this._side * 90);
      }
      desired = sailableHeading(desired, ctx.wind.dir, ship.vessel.sail.noGo);

      // --- Ruder legen -----------------------------------------------------
      const err = diffDeg(dyn.heading, desired);
      dyn.setRudder(clamp(err / 22, -1, 1));

      // --- Segel setzen oder reffen ---------------------------------------
      // Ein guter Kapitaen refft rechtzeitig, statt seine Stengen zu verlieren.
      const w = ctx.wind.speedKts;
      let set = 1;
      if (w > 34) set = 0.35;
      else if (w > 28) set = 0.6;
      else if (w > 24) set = 0.8;
      if (this.state === "engage" && dist < this.engage * 0.8) set = Math.min(set, 0.75);
      dyn.sailSet = set;

      // --- Feuer ------------------------------------------------------------
      if (this.state === "struck") return;
      const side = rel >= 0 ? "PORT" : "STBD"; // a positive bearing is to port
      const absRel = Math.abs(rel);
      const inArc = absRel > 32 && absRel < 148;
      if (!inArc || !ship.battery.ready(side)) return;

      const ammo = this._chooseAmmo(dist, target);
      const spec = AMMO[ammo];
      const reach = ship.battery.maxRange * spec.rangeFactor * 1.1;
      if (dist > reach) return;

      ship.battery.setAmmo(ammo);
      const fired = ship.battery.fire(side, {
         windDir: ctx.wind.dir,
         windSpeed: ctx.wind.speedKts,
         gunnery: this.skill,
      });
      if (fired) this._lastFire = 0;
   }

   _chooseAmmo(dist, target) {
      const enemyMasts = target.dmg ? target.dmg.mastsStanding() : 3;
      if (this.doctrine === "rig") {
         // erst die Takelage zerschlagen, dann den Rumpf
         if (enemyMasts > 1 && dist < 300) return "chain";
         if (dist < 110) return "grape";
         return "ball";
      }
      // britische Doktrin: in den Rumpf, auf kurze Distanz Kartaetsche
      if (dist < 100) return "grape";
      return "ball";
   }
}

// ---------------------------------------------------------------------------
export class Fleet {
   constructor(opts = {}) {
      this.scene = opts.scene;
      this.debris = opts.debris || null;
      this.targets = opts.targets || (() => []);
      this.onHit = opts.onHit || null;
      this.sound = opts.sound !== false;
      this.ships = [];
      this.captains = [];
   }

   spawn(vesselId, o = {}) {
      const vessel = getVessel(vesselId);
      const ship = new Ship({
         vessel,
         scene: this.scene,
         debris: this.debris,
         targets: this.targets,
         onHit: this.onHit,
         sound: this.sound,
         isPlayer: false,
         name: o.name || vessel.name,
      });
      ship.place(o.x ?? 0, o.z ?? 0, o.heading ?? 0, o.speed ?? 0);
      const cap = new Captain(ship, o);
      this.ships.push(ship);
      this.captains.push(cap);
      return ship;
   }

   alive() { return this.ships.filter((s) => s.alive && !s.dmg.sunk); }
   fighting() { return this.ships.filter((s) => s.alive && !s.dmg.sunk && !s.dmg.struck); }

   update(dt, ctx) {
      for (let i = 0; i < this.ships.length; i++) {
         const s = this.ships[i];
         if (!s.alive) continue;
         this.captains[i].update(dt, ctx);
         s.update(dt, s._crewNear === undefined ? ctx : { ...ctx, crewLod: s._crewNear });
         s.battery.update(dt, ctx.gunCtx);
      }
   }

   drainEvents() {
      const all = [];
      for (const s of this.ships) for (const e of s.drainEvents()) all.push(e);
      return all;
   }

   clear() {
      for (const s of this.ships) s.dispose();
      this.ships.length = 0;
      this.captains.length = 0;
   }
}

// ---------------------------------------------------------------------------
// Gefechtslagen: was dem Spieler gegenuebersteht, haengt von seinem Schiff ab.
// ---------------------------------------------------------------------------
export const SCENARIOS = [
   {
      id: "single",
      title: "Einzelgefecht",
      desc: "Ein Gegner von vergleichbarer Staerke. Ehrlicher Schlagabtausch.",
      forces: {
         yacht: [], hotspur: ["hirondelle"], lydia: ["amelie"], sutherland: ["vengeur"],
      },
   },
   {
      id: "outnumbered",
      title: "Overwhelming Force",
      desc: "Two enemies. Keep them apart or they will take you in a crossfire.",
      forces: {
         yacht: [], hotspur: ["hirondelle", "hirondelle"],
         lydia: ["amelie", "hirondelle"], sutherland: ["vengeur", "amelie"],
      },
   },
   {
      id: "lineofbattle",
      title: "Gegen ein Linienschiff",
      desc: "Ein Vierundsiebziger. Auf Distanz bleiben, die Takelage zerschiessen, weglaufen.",
      forces: {
         yacht: [], hotspur: ["vengeur"], lydia: ["vengeur"], sutherland: ["vengeur", "amelie"],
      },
   },
];

export function scenarioFor(id) {
   return SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
}

export default { Fleet, Captain, SCENARIOS, scenarioFor, sailableHeading };
