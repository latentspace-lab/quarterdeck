// crew.js - die Besatzung.
//
// Ein Schiff dieser Zeit ist nichts ohne seine Leute: die Breitseite ist so
// schnell wie ihre Bedienungen, die Segel so gut wie die Toppsgasten, und die
// Pumpen laufen nur, solange jemand daran steht. Deshalb ist die Mannschaft
// hier kein Zahlenschmuck, sondern haengt an allen drei Systemen.
//
// Verluste: Der grosse Toeter an Bord war nicht die Kugel selbst, sondern der
// Holzsplitterhagel, den sie aus der Bordwand schlug - und auf kurze Distanz
// die Kartaetsche. Getroffene sind ueberwiegend VERWUNDET, nicht tot; sie
// fallen trotzdem aus, weil sie unter Deck zum Wundarzt gehen.

import { clamp } from "./utils.js";

export const ROLES = [
   { id: "officer",   name: "Offiziere & Rudergänger", short: "Offiziere",  share: 0.07 },
   { id: "gun",       name: "Geschützbedienungen",     short: "Geschütze",  share: 0.49 },
   { id: "top",       name: "Toppsgasten",             short: "Toppsgasten", share: 0.22 },
   { id: "marine",    name: "Seesoldaten",             short: "Seesoldaten", share: 0.11 },
   { id: "carpenter", name: "Zimmerleute & Pumpen",    share: 0.06, short: "Zimmerleute" },
   { id: "powder",    name: "Pulverjungen",            short: "Pulverjungen", share: 0.05 },
];

// Wo halten sich die Rollen auf? Davon haengt ab, wen ein Treffer erwischt.
// bord  = an der Bordwand (Splitter aus dem getroffenen Rumpfabschnitt)
// deck  = offenes Deck (Kartaetsche, Musketenfeuer)
// rigg  = oben in der Takelage (Kettenkugel)
// unten = unter Deck (relativ sicher)
const EXPOSURE = {
   officer:   { bord: 0.6, deck: 1.4, rigg: 0.2, unten: 0.3 },
   gun:       { bord: 1.8, deck: 0.9, rigg: 0.1, unten: 0.5 },
   top:       { bord: 0.4, deck: 1.1, rigg: 2.6, unten: 0.2 },
   marine:    { bord: 0.5, deck: 1.6, rigg: 0.5, unten: 0.2 },
   carpenter: { bord: 0.7, deck: 0.4, rigg: 0.1, unten: 1.4 },
   powder:    { bord: 0.9, deck: 0.5, rigg: 0.1, unten: 1.0 },
};

export class Crew {
   constructor(vessel, opts = {}) {
      this.total = Math.max(vessel.crew || 4, 1);
      this.roles = {};
      let assigned = 0;
      for (let i = 0; i < ROLES.length; i++) {
         const r = ROLES[i];
         let n = Math.round(this.total * r.share);
         if (i === ROLES.length - 1) n = this.total - assigned; // Rest
         n = Math.max(n, 0);
         assigned += n;
         this.roles[r.id] = { start: n, fit: n, wounded: 0, dead: 0 };
      }
      this.isPlayer = !!opts.isPlayer;
      this._events = [];
      this._healTimer = 0;
      // Schock: ein gefallener Mast, ein Rammstoss oder eine Grundberuehrung
      // sitzt der Mannschaft in den Knochen und klingt erst langsam ab.
      this.shaken = 0;
   }

   get fit() {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].fit;
      return n;
   }
   get wounded() {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].wounded;
      return n;
   }
   get dead() {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].dead;
      return n;
   }
   get losses() { return this.wounded + this.dead; }

   fraction(id) {
      const r = this.roles[id];
      return r && r.start > 0 ? r.fit / r.start : 1;
   }

   drainEvents() { const e = this._events; this._events = []; return e; }

   // ------------------------------------------------------------------
   // Verluste
   // n      = Zahl der Getroffenen
   // where  = "bord" | "deck" | "rigg" | "unten"
   // Rueckgabe: { hurt, killed, worst } - worst = am staerksten betroffene Rolle
   // ------------------------------------------------------------------
   hit(n, where = "bord") {
      n = Math.max(0, Math.round(n));
      if (!n) return { hurt: 0, killed: 0, worst: null };

      // Gewichte aus Aufenthaltsort und noch vorhandener Mannschaft
      const ids = [], w = [];
      let sum = 0;
      for (const r of ROLES) {
         const f = this.roles[r.id].fit;
         if (f <= 0) continue;
         const e = (EXPOSURE[r.id] && EXPOSURE[r.id][where]) || 0.5;
         const v = f * e;
         ids.push(r.id); w.push(v); sum += v;
      }
      if (sum <= 0) return { hurt: 0, killed: 0, worst: null };

      let hurt = 0, killed = 0;
      const perRole = {};
      for (let k = 0; k < n; k++) {
         // Rolle ziehen
         let x = Math.random() * sum, pick = ids[0];
         for (let i = 0; i < ids.length; i++) { x -= w[i]; if (x <= 0) { pick = ids[i]; break; } }
         const r = this.roles[pick];
         if (r.fit <= 0) continue;
         r.fit--;
         // Rund ein Drittel der Treffer war toedlich, der Rest kam zum Wundarzt
         if (Math.random() < 0.34) { r.dead++; killed++; } else { r.wounded++; hurt++; }
         perRole[pick] = (perRole[pick] || 0) + 1;
      }
      let worst = null, most = 0;
      for (const id in perRole) if (perRole[id] > most) { most = perRole[id]; worst = id; }
      if (hurt + killed > 0) this._events.push({ type: "casualties", n: hurt + killed, hurt, killed, worst });
      return { hurt, killed, worst };
   }

   // ------------------------------------------------------------------
   // Auswirkungen
   // ------------------------------------------------------------------
   // Wie viele Rohre lassen sich noch bedienen, und wie schnell?
   // Unter etwa 60 % Bedienung werden Rohre zusammengelegt: weniger Rohre,
   // dafuer bleiben die uebrigen halbwegs schnell.
   gunnery() {
      const f = this.fraction("gun");
      const powder = this.fraction("powder");
      const served = clamp(f < 0.6 ? f / 0.6 : 1, 0.12, 1);
      // Nachladezeit: fehlende Leute und fehlender Pulvernachschub bremsen
      const rate = clamp(0.45 + 0.40 * Math.min(f / 0.6, 1) + 0.15 * powder, 0.35, 1);
      return { served, rate };
   }
   // Segelmanoever: Toppsgasten setzen und reffen
   sailHandling() { return clamp(0.25 + 0.75 * this.fraction("top"), 0.2, 1); }
   // Pumpen und Lecks stopfen
   pumping() { return clamp(0.20 + 0.80 * this.fraction("carpenter"), 0.15, 1); }
   // Ruder und Befehlskette
   command() { return clamp(0.40 + 0.60 * this.fraction("officer"), 0.35, 1); }
   // Kampfmoral: stuerzt ab, wenn Verluste und Fuehrungsverlust zusammenkommen
   morale() {
      const loss = 1 - this.fit / this.total;
      return clamp(1 - loss * 1.5 - (1 - this.fraction("officer")) * 0.4
                     - this.shaken * 0.45, 0, 1);
   }
   // Erschuetterung durch ein schweres Ereignis
   shock(a) { this.shaken = clamp(this.shaken + a, 0, 1); }

   // Nach dem Gefecht kommen leicht Verwundete zurueck an die Geschuetze
   update(dt) {
      if (this.shaken > 0) this.shaken = Math.max(0, this.shaken - dt * 0.012);
      this._healTimer += dt;
      if (this._healTimer < 20) return;
      this._healTimer = 0;
      for (const r of ROLES) {
         const s = this.roles[r.id];
         if (s.wounded > 0 && Math.random() < 0.5) { s.wounded--; s.fit++; }
      }
   }

   status() {
      const out = { total: this.total, fit: this.fit, wounded: this.wounded, dead: this.dead, roles: [] };
      for (const r of ROLES) {
         const s = this.roles[r.id];
         if (s.start <= 0) continue;
         out.roles.push({
            id: r.id, name: r.name, short: r.short,
            start: s.start, fit: s.fit, wounded: s.wounded, dead: s.dead,
            frac: s.start ? s.fit / s.start : 1,
         });
      }
      out.morale = this.morale();
      return out;
   }
}

export default { Crew, ROLES };
