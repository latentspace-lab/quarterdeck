// damage.js - Strukturmodell eines Schiffs: was kaputtgeht und was das kostet.
//
// Das Modell ist absichtlich nach Baugruppen getrennt, weil genau daraus die
// taktischen Entscheidungen entstehen, die eine Seeschlacht dieser Zeit
// ausmachten:
//
//   Rumpf   -> Franzosen schossen auf den Rumpf? Nein, umgekehrt: die Royal
//              Navy schoss auf den Rumpf (Schiff versenken / Bedienungen
//              ausschalten), die Franzosen bevorzugt in die Takelage
//              (Gegner manoevrierunfaehig machen und entkommen).
//   Masten  -> gehen ueber Bord, nehmen ihre Segelflaeche mit und schleppen
//              als Wrack laengsseit, bis man sie kappt.
//   Ruder   -> ohne Ruder keine Kurskontrolle.
//   Batterie-> ausgeschlagene Rohre verkleinern die eigene Breitseite.
//   Leck    -> Wasser im Schiff kostet Fahrt, legt das Schiff auf die Seite
//              und versenkt es am Ende.
//
// Einheiten: Schaeden sind normiert (0 = heil, 1 = zerstoert).

import { clamp, lerp } from "./utils.js";

export const SIDES = ["PORT", "STBD"];
export const SECTIONS = ["BOW", "MID", "QUARTER"];
export const MASTS = ["fore", "main", "mizzen"];

// Munitionsarten: wie stark wirken sie auf welche Baugruppe?
export const AMMO = {
   ball: {
      id: "ball",
      name: "Vollkugel",
      short: "Kugel",
      desc: "Durchschlaegt die Bordwand, schlaegt Rohre aus, schiesst Lecks.",
      hull: 1.0, rig: 0.25, gun: 1.0, crew: 0.50,
      elevation: 1.0,      // Grad ueber der Waagerechten
      spreadDeg: 0.9,
      pellets: 1,
      rangeFactor: 1.0,
      v0: 330,             // m/s Muendungsgeschwindigkeit
      drag: 0.22,          // Luftwiderstand (1/s im Nenner)
   },
   chain: {
      id: "chain",
      name: "Kettenkugel",
      short: "Kette",
      desc: "Zwei verbundene Halbkugeln - maeht Takelage und Segel nieder.",
      hull: 0.18, rig: 1.4, gun: 0.25, crew: 0.30,
      elevation: 2.2,      // hoch gerichtet, in die Takelage
      spreadDeg: 2.4,
      pellets: 1,
      rangeFactor: 0.62,   // taumelt, verliert schnell Energie
      v0: 250,
      drag: 0.55,
   },
   grape: {
      id: "grape",
      name: "Kartaetsche",
      short: "Kartätsche",
      desc: "Schwarm kleiner Kugeln - fegt das Deck, ohne den Rumpf zu oeffnen.",
      hull: 0.12, rig: 0.40, gun: 1.7, crew: 0.35,  // je Schrotkugel!
      elevation: 1.1,
      spreadDeg: 5.5,
      pellets: 9,
      rangeFactor: 0.40,   // nur auf Pistolenschussweite wirksam
      v0: 280,
      drag: 0.85,
   },
};
export const AMMO_ORDER = ["ball", "chain", "grape"];

// Sektion aus der Laengsposition (0 = Bug, 1 = Spiegel)
export function sectionAt(s) {
   if (s < 0.33) return "BOW";
   if (s < 0.70) return "MID";
   return "QUARTER";
}

export class DamageModel {
   constructor(vessel, opts = {}) {
      this.vessel = vessel;
      const st = vessel.structure || {};
      this.scantling = st.scantling ?? 1;        // Staerke der Bordwand
      this.mastStrength = st.mastStrength ?? 1;  // Staerke der Rundhoelzer
      this.reserve = st.reserve ?? 1;            // Reserveauftrieb (Zeit bis Sinken)
      this.isPlayer = !!opts.isPlayer;

      this.hull = {};
      for (const side of SIDES) {
         for (const sec of SECTIONS) this.hull[side + "_" + sec] = 1;
      }
      this.holes = [];          // { side, sec, below, size }
      this.flooding = 0;        // 0..1, 1 = gesunken
      this.masts = {};
      for (const m of MASTS) this.masts[m] = { integrity: 1, state: "sound", stress: 0 };
      this.rudder = 1;
      this.guns = { PORT: 1, STBD: 1 };   // Anteil einsatzfaehiger Rohre
      this.rigging = 1;                   // stehendes/laufendes Gut
      this.sails = 1;                     // Tuchzustand
      this.afire = 0;
      this.struck = false;
      this.sunk = false;
      this.dead = false;
      this.wreckDrag = 0;                 // von aussen gesetzt (schleppendes Wrack)
      this.log = [];
      this._events = [];
   }

   // ------------------------------------------------------------ Abfragen
   // Mittlerer Zustand aller sechs Rumpfabschnitte (fuer die Anzeige)
   hullAverage() {
      let s = 0, n = 0;
      for (const k in this.hull) { s += this.hull[k]; n++; }
      return n ? s / n : 1;
   }
   // Kampfkraft des Rumpfs. Bezugsgroesse ist eine komplett zerschossene
   // Breitseite (drei Abschnitte), nicht der ganze Rumpf - ein Schiff ist
   // erledigt, wenn EINE Seite aufgerissen ist, nicht erst wenn beide es sind.
   integrity() {
      let dmg = 0;
      for (const k in this.hull) dmg += 1 - this.hull[k];
      return clamp(1 - dmg / 3, 0, 1);
   }
   mastsStanding() {
      return MASTS.filter((m) => this.masts[m].state !== "gone").length;
   }
   // Anteil der Segelkraft, den das Schiff noch aufbringt.
   // Die Masten tragen unterschiedlich viel: Gross > Fock > Besan.
   driveFactor() {
      const share = { fore: 0.36, main: 0.44, mizzen: 0.20 };
      let d = 0;
      for (const m of MASTS) {
         const st = this.masts[m];
         if (st.state === "gone") continue;
         d += share[m] * (st.state === "wounded" ? 0.55 : 1) * lerp(0.55, 1, st.integrity);
      }
      return clamp(d * lerp(0.62, 1, this.sails) * lerp(0.75, 1, this.rigging), 0, 1);
   }
   rudderFactor() { return clamp(lerp(0.10, 1, this.rudder), 0.10, 1); }
   // Wasser im Schiff: traeger, tiefer, langsamer
   floodSpeedFactor() { return clamp(1 - 0.55 * this.flooding, 0.25, 1); }
   floodHeel() { return this.flooding * 14; }        // Grad Schlagseite
   gunFraction(side) { return clamp(this.guns[side], 0, 1); }
   beaten() {
      return this.integrity() < 0.32 || this.mastsStanding() <= 1 || this.flooding > 0.5;
   }
   drainEvents() { const e = this._events; this._events = []; return e; }
   _event(type, data) { this._events.push({ type, ...data }); }

   // ------------------------------------------------------------ Treffer
   // hit: { side, s (0..1 Bug->Heck), y (Hoehe ueber Wasserlinie, m),
   //        ammo (AMMO-Eintrag), lb (Kugelgewicht), range01 (0 nah .. 1 weit),
   //        freeboard (m) }
   // Rueckgabe beschreibt, was sichtbar passieren soll (Splitter, Mastbruch ...)
   applyHit(hit) {
      if (this.sunk) return null;
      const a = hit.ammo || AMMO.ball;
      const sec = sectionAt(clamp(hit.s ?? 0.5, 0, 1));
      const side = hit.side === "PORT" ? "PORT" : "STBD";
      const lb = hit.lb ?? 18;
      const FB = hit.freeboard || 4;

      // Energie faellt mit der Entfernung; Kette und Kartaetsche viel schneller
      // Wirkung faellt mit der Entfernung. Die Ballistik begrenzt die
      // Reichweite bereits; hier geht es nur noch um die Restwucht.
      const reach = clamp(1 - (hit.range01 ?? 0) * 0.60 / Math.max(a.rangeFactor, 0.30), 0.10, 1);
      const power = (lb / 18) * reach;

      const res = {
         section: sec, side, y: hit.y ?? FB * 0.5, s: hit.s ?? 0.5,
         splinters: 0, holed: false, below: false,
         mastBroken: null, rudderHit: false, gunsLost: 0, sailTorn: 0, fire: false,
         // Wen es an Bord trifft - der Aufrufer bucht es auf die Mannschaft
         crew: { n: 0, where: "bord" },
      };

      // --- Mannschaftsverluste --------------------------------------------
      // Nicht die Kugel toetet, sondern der Splitterhagel, den sie aus der
      // Bordwand reisst - und auf kurze Distanz die Kartaetsche.
      const isRigHit = (hit.y ?? 0) > FB * 1.25;
      res.crew.n = Math.round(power * a.crew * (1.2 + Math.random() * 2.2));
      res.crew.where = isRigHit ? "rigg" : (a.id === "grape" ? "deck" : "bord");

      // --- Rumpf ---------------------------------------------------------
      if (!isRigHit) {
         const dmg = power * a.hull * 0.055 / this.scantling;
         const key = side + "_" + sec;
         this.hull[key] = clamp(this.hull[key] - dmg, 0, 1);
         res.splinters = Math.round(clamp(dmg * 190 * a.hull, 2, 26));

         if (a.hull > 0.5 && dmg > 0.012) {
            res.holed = true;
            // "zwischen Wind und Wasser": Treffer knapp ueber der Wasserlinie
            // reissen beim Ueberholen des Schiffs unter Wasser - das sind die
            // gefaehrlichen. Tiefe Treffer sind seltener, aber schlimm.
            const low = (hit.y ?? FB) < FB * 0.42;
            if (low && Math.random() < 0.55) {
               res.below = true;
               const size = dmg * (0.6 + Math.random() * 0.8);
               this.holes.push({ side, sec, below: true, size });
               this._event("holed", { side, sec, size });
            } else {
               this.holes.push({ side, sec, below: false, size: dmg });
            }
         }

         // Rohre ausgeschlagen
         if (a.gun > 0 && sec !== "QUARTER") {
            const loss = power * a.gun * 0.045 * (0.5 + Math.random());
            const before = this.guns[side];
            this.guns[side] = clamp(this.guns[side] - loss, 0, 1);
            res.gunsLost = before - this.guns[side];
         }
         // Ruder sitzt achtern
         if (sec === "QUARTER" && Math.random() < 0.16 * power * a.hull) {
            this.rudder = clamp(this.rudder - (0.25 + Math.random() * 0.4), 0, 1);
            res.rudderHit = true;
            this._event("rudder", { rudder: this.rudder });
         }
         // Brand
         if (Math.random() < 0.025 * power * (a.id === "ball" ? 1 : 0.4)) {
            this.afire = clamp(this.afire + 0.18, 0, 1);
            res.fire = true;
         }
      }

      // --- Takelage ------------------------------------------------------
      if (a.rig > 0) {
         const rigDmg = power * a.rig * 0.030;
         this.rigging = clamp(this.rigging - rigDmg * 0.7, 0, 1);
         this.sails = clamp(this.sails - rigDmg * 0.9, 0, 1);
         res.sailTorn = rigDmg;

         // Welcher Mast? Kettenkugel geht bevorzugt in den grossen Mast.
         const target = isRigHit || a.rig > 1
            ? this._mastFor(hit.s ?? 0.5)
            : null;
         if (target) {
            const m = this.masts[target];
            if (m.state !== "gone") {
               m.integrity = clamp(m.integrity - rigDmg * 1.30 / this.mastStrength, 0, 1);
               if (m.integrity <= 0) {
                  res.mastBroken = this._breakMast(target, "shot");
               } else if (m.integrity < 0.45 && m.state === "sound") {
                  m.state = "wounded";
                  this._event("mastWounded", { mast: target });
               }
            }
         }
      }
      return res;
   }

   _mastFor(s) {
      // Laengsposition -> naechstgelegener Mast (Fock vorn, Besan achtern)
      if (s < 0.38) return "fore";
      if (s < 0.72) return "main";
      return "mizzen";
   }

   // Mast geht ueber Bord. Rueckgabe sagt dem Aufrufer, was er wegbrechen soll.
   _breakMast(key, cause) {
      const m = this.masts[key];
      if (m.state === "gone") return null;
      m.state = "gone";
      m.integrity = 0;
      // Ein fallender Mast reisst Wanten und Stage mit
      this.rigging = clamp(this.rigging - 0.22, 0, 1);
      this.sails = clamp(this.sails - 0.12, 0, 1);
      this._event("mastLost", { mast: key, cause });
      this.log.push({ t: "mast", mast: key, cause });
      return { mast: key, cause };
   }

   // Von aussen: Mast durch Ueberlastung oder Kollision brechen lassen
   breakMast(key, cause = "force") { return this._breakMast(key, cause); }

   // --------------------------------------------------------- Rammstoss
   // Kollision: Energie aus Masse und Annaeherungsgeschwindigkeit.
   applyRam({ closingKts, otherTons, ownTons, side, s }) {
      const v = Math.abs(closingKts) * 0.514444;
      // spezifische Energie, normiert auf "eigene Masse"
      const e = 0.5 * v * v * clamp(otherTons / Math.max(ownTons, 1), 0.15, 4) / 120;
      const sec = sectionAt(clamp(s ?? 0.5, 0, 1));
      const key = (side === "PORT" ? "PORT" : "STBD") + "_" + sec;
      const dmg = clamp(e / this.scantling, 0, 0.9);
      this.hull[key] = clamp(this.hull[key] - dmg, 0, 1);
      const res = { section: sec, side, splinters: Math.round(clamp(dmg * 120, 3, 40)), mastBroken: null, below: false };
      if (dmg > 0.10 && Math.random() < 0.7) {
         this.holes.push({ side, sec, below: true, size: dmg * 0.8 });
         res.below = true;
         this._event("holed", { side, sec, size: dmg * 0.8 });
      }
      // Ein harter Stoss wirft Stengen ueber Bord
      if (dmg > 0.22) {
         const standing = MASTS.filter((k) => this.masts[k].state !== "gone");
         if (standing.length && Math.random() < 0.55) {
            res.mastBroken = this._breakMast(standing[(Math.random() * standing.length) | 0], "ram");
         }
      }
      this._event("ram", { dmg });
      return res;
   }

   // --------------------------------------------------------- Grundberuehrung
   applyGrounding({ speedKts, draft, depth }) {
      const over = clamp((draft - depth) / Math.max(draft, 0.5), 0, 1);
      const dmg = clamp(over * (0.02 + speedKts * 0.020), 0, 0.55);
      for (const sec of ["BOW", "MID"]) {
         for (const side of SIDES) {
            this.hull[side + "_" + sec] = clamp(this.hull[side + "_" + sec] - dmg * 0.5, 0, 1);
         }
      }
      if (dmg > 0.03) {
         this.holes.push({ side: "PORT", sec: "BOW", below: true, size: dmg });
         this.holes.push({ side: "STBD", sec: "BOW", below: true, size: dmg });
         this._event("aground", { dmg });
      }
      return dmg;
   }

   // --------------------------------------------------- Ueberlastung im Sturm
   // Zu viel Tuch bei zu viel Wind: die Stengen gehen ueber Bord. Genau dafuer
   // gibt es die Reffen-Tasten.
   stressRig(dt, { windKts, sailSet, twa }) {
      // Staudruck ~ v^2; am Wind steht das Rigg schraeger und leidet mehr
      const upwind = 1 + 0.45 * Math.cos(clamp(Math.abs(twa), 0, 180) * Math.PI / 180);
      const stress = Math.pow(clamp(windKts, 0, 90) / 34, 2) * clamp(sailSet, 0, 1) * upwind;
      let broke = null;
      for (const key of MASTS) {
         const m = this.masts[key];
         m.stress = stress;
         if (m.state === "gone") continue;
         if (stress > 1) {
            // geschwaechte Masten geben zuerst nach
            const weak = lerp(1.9, 0.7, m.integrity);
            m.integrity = clamp(m.integrity - (stress - 1) * 0.030 * weak * dt / this.mastStrength, 0, 1);
            if (m.integrity <= 0 && !broke) broke = this._breakMast(key, "overpress");
            else if (m.integrity < 0.45 && m.state === "sound") {
               m.state = "wounded";
               this._event("mastWounded", { mast: key });
            }
         }
      }
      return broke;
   }

   // ------------------------------------------------------------- Fortlauf
   update(dt, ctx = {}) {
      if (this.sunk) return;

      // Wassereinbruch: offene Lecks unter Wasser fuellen das Schiff.
      // Die Pumpen halten kleine Lecks in Schach, grosse nicht.
      let inflow = 0;
      for (const h of this.holes) if (h.below) inflow += h.size;
      const heelExtra = clamp((ctx.heel ?? 0) / 40, 0, 1) * 0.4;
      // Die Pumpen laufen nur, solange Leute daran stehen
      const pumps = (this.isPlayer ? 0.010 : 0.008) * clamp(ctx.pump ?? 1, 0, 1.3);
      const rate = (inflow * 0.032 * (1 + heelExtra)) / Math.max(this.reserve, 0.2);
      this.flooding = clamp(this.flooding + (rate - pumps) * dt, 0, 1);
      if (this.flooding >= 1 && !this.sunk) {
         this.sunk = true;
         this._event("sunk", {});
      }

      // Brand: greift um sich, die Wache bekaempft ihn
      if (this.afire > 0) {
         this.afire = clamp(this.afire + (this.afire * 0.055 - 0.035) * dt, 0, 1);
         if (this.afire > 0.05) {
            const d = this.afire * 0.02 * dt;
            this.rigging = clamp(this.rigging - d, 0, 1);
            this.sails = clamp(this.sails - d * 1.5, 0, 1);
            for (const k in this.hull) this.hull[k] = clamp(this.hull[k] - d * 0.35, 0, 1);
         }
         if (this.afire >= 0.98) { this.sunk = true; this._event("exploded", {}); }
      }

      // Flagge streichen: ein geschlagenes Schiff kaempft nicht bis zum Untergang
      if (!this.struck && !this.isPlayer && this.beaten()) {
         this.struck = true;
         this._event("struck", {});
      }
   }

   status() {
      return {
         hull: this.integrity(),
         hullAvg: this.hullAverage(),
         sections: { ...this.hull },
         hullBySide: {
            PORT: (this.hull.PORT_BOW + this.hull.PORT_MID + this.hull.PORT_QUARTER) / 3,
            STBD: (this.hull.STBD_BOW + this.hull.STBD_MID + this.hull.STBD_QUARTER) / 3,
         },
         masts: { ...this.masts },
         mastsStanding: this.mastsStanding(),
         rudder: this.rudder,
         guns: { ...this.guns },
         rigging: this.rigging,
         sails: this.sails,
         flooding: this.flooding,
         afire: this.afire,
         struck: this.struck,
         sunk: this.sunk,
         drive: this.driveFactor(),
         holesBelow: this.holes.filter((h) => h.below).length,
      };
   }
}

export default { DamageModel, AMMO, AMMO_ORDER, SECTIONS, MASTS, SIDES, sectionAt };
