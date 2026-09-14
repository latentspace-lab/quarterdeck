// crew.ts - Crew model.
//
// A ship of this era is nothing without her men: the broadside is only as
// fast as its crew, the sails are only as good as the topsmen, and the pumps
// only run while someone is at them. Crew is not decoration — it drives the
// three core systems.
//
// Casualties: the great killer on board was not the ball itself, but the
// wooden splinters it tore from the hull — and at close range, grape shot.
// Wounded vastly outnumber the dead; they are removed from action because
// they go below to the surgeon.
//
// Randomness: every draw runs through the injected generator (opts.rng).
// Without a generator the class falls back to Math.random - that is the
// single-player path and is deliberately allowed, so a forgotten parameter
// does not break the game. The server and tests always pass a seed.

import { clamp } from "./utils.ts";
import { systemRng, type Rng } from "./rng.ts";
import type { Vessel } from "./vessels.ts";

export interface RoleDef {
   id: string;
   name: string;
   short: string;
   share: number;
}

export const ROLES: RoleDef[] = [
   { id: "officer", name: "Officers & Helmsmen", short: "Officers", share: 0.07 },
   { id: "gun", name: "Gunnery Crew", short: "Guns", share: 0.49 },
   { id: "top", name: "Topmen", short: "Topmen", share: 0.22 },
   { id: "marine", name: "Marines", short: "Marines", share: 0.11 },
   { id: "carpenter", name: "Carpenters & Pumps", short: "Carpenters", share: 0.06 },
   { id: "powder", name: "Powder Monkeys", short: "Powder Monkeys", share: 0.05 },
];

/** Where a role is stationed - this decides who gets hit. */
export type Where = "hull" | "deck" | "rigging" | "below";

// hull    = at the hull (splinters from the struck section)
// deck    = on open deck (grape, musketry)
// rigging = aloft in the rigging (chain shot)
// below   = below deck (relatively safe)
const EXPOSURE: Record<string, Record<Where, number>> = {
   officer: { hull: 0.6, deck: 1.4, rigging: 0.2, below: 0.3 },
   gun: { hull: 1.8, deck: 0.9, rigging: 0.1, below: 0.5 },
   top: { hull: 0.4, deck: 1.1, rigging: 2.6, below: 0.2 },
   marine: { hull: 0.5, deck: 1.6, rigging: 0.5, below: 0.2 },
   carpenter: { hull: 0.7, deck: 0.4, rigging: 0.1, below: 1.4 },
   powder: { hull: 0.9, deck: 0.5, rigging: 0.1, below: 1.0 },
};

export interface RoleState {
   start: number;
   fit: number;
   wounded: number;
   dead: number;
}

export interface CasualtyResult {
   hurt: number;
   killed: number;
   worst: string | null;
}

export interface CrewEvent {
   type: "casualties";
   n: number;
   hurt: number;
   killed: number;
   worst: string | null;
}

export interface CrewOptions {
   isPlayer?: boolean;
   rng?: Rng;
}

export class Crew {
   total: number;
   roles: Record<string, RoleState> = {};
   isPlayer: boolean;
   /** Shock: a fallen mast, a ram strike, or grounding — recovers slowly. */
   shaken = 0;
   private rng: Rng;
   private _events: CrewEvent[] = [];
   private _healTimer = 0;

   constructor(vessel: Vessel, opts: CrewOptions = {}) {
      this.total = Math.max(vessel.crew || 4, 1);
      this.rng = opts.rng ?? systemRng;
      let assigned = 0;
      for (let i = 0; i < ROLES.length; i++) {
         const r = ROLES[i];
         let n = Math.round(this.total * r.share);
         if (i === ROLES.length - 1) n = this.total - assigned; // remainder
         n = Math.max(n, 0);
         assigned += n;
         this.roles[r.id] = { start: n, fit: n, wounded: 0, dead: 0 };
      }
      this.isPlayer = !!opts.isPlayer;
   }

   /** Set the randomness source after the fact (e.g. when taking over a room). */
   setRng(rng: Rng): void {
      this.rng = rng;
   }

   get fit(): number {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].fit;
      return n;
   }
   get wounded(): number {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].wounded;
      return n;
   }
   get dead(): number {
      let n = 0;
      for (const id in this.roles) n += this.roles[id].dead;
      return n;
   }
   get losses(): number {
      return this.wounded + this.dead;
   }

   fraction(id: string): number {
      const r = this.roles[id];
      return r && r.start > 0 ? r.fit / r.start : 1;
   }

   drainEvents(): CrewEvent[] {
      const e = this._events;
      this._events = [];
      return e;
   }

   // ------------------------------------------------------------------
   // Casualties
   // n      = number of men hit
   // where  = "hull" | "deck" | "rigging" | "below"
   // Returns: { hurt, killed, worst } — worst = role most affected
   // ------------------------------------------------------------------
   hit(n: number, where: Where = "hull"): CasualtyResult {
      n = Math.max(0, Math.round(n));
      if (!n) return { hurt: 0, killed: 0, worst: null };

      // Weights from where they are stationed and the crew still on hand
      const ids: string[] = [];
      const w: number[] = [];
      let sum = 0;
      for (const r of ROLES) {
         const f = this.roles[r.id].fit;
         if (f <= 0) continue;
         const e = (EXPOSURE[r.id] && EXPOSURE[r.id][where]) || 0.5;
         const v = f * e;
         ids.push(r.id);
         w.push(v);
         sum += v;
      }
      if (sum <= 0) return { hurt: 0, killed: 0, worst: null };

      let hurt = 0;
      let killed = 0;
      const perRole: Record<string, number> = {};
      for (let k = 0; k < n; k++) {
         // Draw a role
         let x = this.rng() * sum;
         let pick = ids[0];
         for (let i = 0; i < ids.length; i++) {
            x -= w[i];
            if (x <= 0) {
               pick = ids[i];
               break;
            }
         }
         const r = this.roles[pick];
         if (r.fit <= 0) continue;
         r.fit--;
         // About one third of hits were fatal; the rest went to the surgeon
         if (this.rng() < 0.34) {
            r.dead++;
            killed++;
         } else {
            r.wounded++;
            hurt++;
         }
         perRole[pick] = (perRole[pick] || 0) + 1;
      }
      let worst: string | null = null;
      let most = 0;
      for (const id in perRole) {
         if (perRole[id] > most) {
            most = perRole[id];
            worst = id;
         }
      }
      if (hurt + killed > 0) {
         this._events.push({ type: "casualties", n: hurt + killed, hurt, killed, worst });
      }
      return { hurt, killed, worst };
   }

   // ------------------------------------------------------------------
   // Effects
   // ------------------------------------------------------------------
   // How many guns can still be served, and how fast?
   // Below about 60% manning, guns get combined: fewer guns, but the
   // remaining ones stay reasonably fast.
   gunnery(): { served: number; rate: number } {
      const f = this.fraction("gun");
      const powder = this.fraction("powder");
      const served = clamp(f < 0.6 ? f / 0.6 : 1, 0.12, 1);
      // Reload time: missing men and missing powder supply slow it down
      const rate = clamp(0.45 + 0.4 * Math.min(f / 0.6, 1) + 0.15 * powder, 0.35, 1);
      return { served, rate };
   }
   /** Sail handling: setting and reefing by the topmen */
   sailHandling(): number {
      return clamp(0.25 + 0.75 * this.fraction("top"), 0.2, 1);
   }
   /** Pumping and stopping leaks */
   pumping(): number {
      return clamp(0.2 + 0.8 * this.fraction("carpenter"), 0.15, 1);
   }
   /** Helm and chain of command */
   command(): number {
      return clamp(0.4 + 0.6 * this.fraction("officer"), 0.35, 1);
   }
   /** Combat morale: collapses when casualties and loss of leadership combine */
   morale(): number {
      const loss = 1 - this.fit / this.total;
      return clamp(
         1 - loss * 1.5 - (1 - this.fraction("officer")) * 0.4 - this.shaken * 0.45,
         0,
         1,
      );
   }
   /** Shock from a severe event */
   shock(a: number): void {
      this.shaken = clamp(this.shaken + a, 0, 1);
   }

   /** Recovery: lightly wounded return to the guns after battle */
   update(dt: number): void {
      if (this.shaken > 0) this.shaken = Math.max(0, this.shaken - dt * 0.012);
      this._healTimer += dt;
      if (this._healTimer < 20) return;
      this._healTimer = 0;
      for (const r of ROLES) {
         const s = this.roles[r.id];
         if (s.wounded > 0 && this.rng() < 0.5) {
            s.wounded--;
            s.fit++;
         }
      }
   }

   status() {
      const out = {
         total: this.total,
         fit: this.fit,
         wounded: this.wounded,
         dead: this.dead,
         roles: [] as Array<
            RoleState & { id: string; name: string; short: string; frac: number }
         >,
         morale: 0,
      };
      for (const r of ROLES) {
         const s = this.roles[r.id];
         if (s.start <= 0) continue;
         out.roles.push({
            id: r.id,
            name: r.name,
            short: r.short,
            start: s.start,
            fit: s.fit,
            wounded: s.wounded,
            dead: s.dead,
            frac: s.start ? s.fit / s.start : 1,
         });
      }
      out.morale = this.morale();
      return out;
   }
}
