// collide.js - Schiff gegen Schiff.
//
// Ein Rumpf wird als Kette von drei Kreisen laengs der Mittellinie genaehert
// (Bug, Mitte, Heck). Das ist fuer laengliche Koerper deutlich besser als ein
// einzelner Kreis und viel billiger als echte Polygonpruefung.
//
// Beim Stoss werden Impuls und Schaden aus der Annaeherungsgeschwindigkeit und
// den Verdraengungen berechnet. Bei geringer Geschwindigkeit verhaken sich die
// Schiffe im Tauwerk, statt abzuprallen - genau das war die Voraussetzung fuers
// Entern.

import { clamp, dirVec, normDeg, diffDeg } from "./utils.js";

const KNOT = 0.514444;

function circlesOf(ship, out) {
   const L = ship.vessel.hull.loa;
   const f = dirVec(ship.dyn.heading);
   const r = ship.vessel.hull.beam * 0.55;
   const p = ship.pos;
   for (let i = 0; i < 3; i++) {
      const d = (i - 1) * L * 0.32;
      out[i].x = p.x + f.x * d;
      out[i].z = p.z + f.z * d;
      out[i].r = r;
   }
   return out;
}

const _a = [{ x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }];
const _b = [{ x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }, { x: 0, z: 0, r: 0 }];

// Prueft ein Paar. Liefert null oder die Stossbeschreibung.
export function testPair(A, B) {
   const fast = Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z);
   const reach = (A.vessel.hull.loa + B.vessel.hull.loa) * 0.55;
   if (fast > reach) return null;

   circlesOf(A, _a); circlesOf(B, _b);
   let best = null;
   for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
         const dx = _b[j].x - _a[i].x, dz = _b[j].z - _a[i].z;
         const d = Math.hypot(dx, dz);
         const sum = _a[i].r + _b[j].r;
         if (d >= sum) continue;
         const pen = sum - d;
         if (!best || pen > best.pen) {
            best = { pen, nx: d > 1e-6 ? dx / d : 1, nz: d > 1e-6 ? dz / d : 0, ia: i, jb: j };
         }
      }
   }
   return best;
}

// Stoss aufloesen: Schiffe trennen, Impuls tauschen, Schaden buchen.
export function resolve(A, B, hit, dt) {
   const mA = A.tons, mB = B.tons;
   const inv = 1 / (mA + mB);

   // 1) Durchdringung aufheben (nach Masse gewichtet)
   const push = hit.pen * 0.5;
   A.pos.x -= hit.nx * push * (mB * inv) * 2;
   A.pos.z -= hit.nz * push * (mB * inv) * 2;
   B.pos.x += hit.nx * push * (mA * inv) * 2;
   B.pos.z += hit.nz * push * (mA * inv) * 2;

   // 2) Geschwindigkeiten entlang der Stossnormalen
   const fa = dirVec(A.dyn.heading), fb = dirVec(B.dyn.heading);
   const vA = (fa.x * hit.nx + fa.z * hit.nz) * A.dyn.speed;
   const vB = (fb.x * hit.nx + fb.z * hit.nz) * B.dyn.speed;
   const closing = vA - vB;   // > 0 = sie laufen aufeinander zu

   if (closing > 0) {
      // teilelastischer Stoss: das leichtere Schiff wird weggeworfen
      const e = 0.18;
      const j = (1 + e) * closing * inv;
      A.dyn.speed = Math.max(0, A.dyn.speed - j * mB / Math.max(Math.abs(vA) > 0.01 ? 1 : 1, 1) * 0.9);
      B.dyn.speed = Math.max(0, B.dyn.speed + j * mA * 0.25);
   }

   // 3) Verhaken: bei langsamer Beruehrung bleiben sie im Tauwerk haengen
   const locked = Math.abs(closing) < 1.6;
   if (locked) {
      A.dyn.speed *= 1 / (1 + 2.2 * dt);
      B.dyn.speed *= 1 / (1 + 2.2 * dt);
   }

   // 4) Schaden - nur einmal je Beruehrung, nicht in jedem Frame
   const now = A._ramCooldown ?? 0;
   const res = { closing, locked, damaged: false, aRes: null, bRes: null };
   if (closing > 1.2 && now <= 0) {
      A._ramCooldown = 1.2;
      B._ramCooldown = 1.2;
      // Welche Seite wurde getroffen? Peilung des Stosspunkts im Schiffssystem.
      const bearA = normDeg(Math.atan2(hit.nx, hit.nz) * 180 / Math.PI);
      const bearB = normDeg(bearA + 180);
      const relA = diffDeg(A.dyn.heading, bearA);
      const relB = diffDeg(B.dyn.heading, bearB);
      const sA = clamp(0.5 - Math.cos(relA * Math.PI / 180) * 0.5, 0, 1);
      const sB = clamp(0.5 - Math.cos(relB * Math.PI / 180) * 0.5, 0, 1);
      res.aRes = A.takeRam({ closingKts: closing, otherTons: mB, ownTons: mA, side: relA > 0 ? "STBD" : "PORT", s: sA });
      res.bRes = B.takeRam({ closingKts: closing, otherTons: mA, ownTons: mB, side: relB > 0 ? "STBD" : "PORT", s: sB });
      res.damaged = true;
   }
   return res;
}

// Alle Paare einer Liste pruefen
export function step(ships, dt) {
   const events = [];
   for (const s of ships) {
      if (s._ramCooldown > 0) s._ramCooldown -= dt;
   }
   for (let i = 0; i < ships.length; i++) {
      for (let j = i + 1; j < ships.length; j++) {
         const A = ships[i], B = ships[j];
         if (!A.alive || !B.alive || A.dmg.sunk || B.dmg.sunk) continue;
         const hit = testPair(A, B);
         if (!hit) continue;
         const r = resolve(A, B, hit, dt);
         if (r.damaged) events.push({ type: "collision", a: A, b: B, closing: r.closing });
         else if (r.locked) events.push({ type: "locked", a: A, b: B });
      }
   }
   return events;
}

// Grundberuehrung pruefen und buchen
export function groundStep(ship, depthAt, dt) {
   if (!ship.alive || ship.dmg.sunk) return null;
   const d = depthAt(ship.pos.x, ship.pos.z);
   const draft = ship.vessel.hull.draft;
   if (d > draft * 1.12) {
      ship.dyn.stopped = false;
      ship.groundedFor = 0;
      return null;
   }
   // Kiel beruehrt den Grund
   const speed = ship.dyn.speed;
   ship.groundedFor += dt;
   const dmg = ship.takeGrounding({ speedKts: speed, draft, depth: Math.max(d, 0) });
   // Fahrt abrupt weg, das Schiff sitzt fest
   ship.dyn.speed *= 1 / (1 + 6 * dt);
   if (d < draft * 0.82) ship.dyn.stopped = true;
   return { depth: d, draft, dmg, hard: d < draft * 0.82 };
}

export default { testPair, resolve, step, groundStep };
