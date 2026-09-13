// tests/pending/balance.test.js - OFFENE BALANCE-FRAGEN
//
// Diese Faelle standen als Zusicherungen in der regulaeren Suite und sind dort
// (auch auf main) immer rot gewesen. Sie behaupten kein Ist, sondern ein Soll,
// das die Simulation derzeit nicht erreicht. Ob das Soll oder das Modell
// geaendert werden soll, ist eine Design-Entscheidung - deshalb liegen sie
// hier und nicht in der Standard-Suite.
//
// Ausfuehren:  node tests/run.js --pending
import * as THREE from "three";
import { DamageModel, AMMO } from "../../packages/client/src/damage.js";
import { getVessel } from "../../packages/client/src/vessels.js";
import { makeRng } from "@segel/shared";
import { Ship } from "../../packages/client/src/ship.js";
import { DebrisField } from "../../packages/client/src/debris.js";
import { Captain } from "../../packages/client/src/fleet.js";
import { seaHeight, ampForWind } from "../../packages/client/src/ocean.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("Balance (offen)");
const { ok } = suite;

const LY = getVessel("lydia");

suite.section("1) Wirkt eine Breitseite stark genug?");
{
   // Rumpfschaden je Treffer: dmg = (lb/18) * reach * ammo.hull * 0.055 / scantling
   // Fuer die Lydia (scantling 0.82) sind das exakt 0.015625 Gefechtskraft je
   // Vollkugel auf 0.25 Reichweite - unabhaengig vom Zufall.
   const pound = (n) => {
      const rng = makeRng(1);
      const d = new DamageModel(LY, { rng });
      for (let i = 0; i < n; i++) {
         d.applyHit({ side: "STBD", s: 0.15 + rng() * 0.7, y: 2.6,
            ammo: AMMO.ball, lb: 18, range01: 0.25, freeboard: 4.3 });
      }
      return d;
   };
   const eight = pound(8).integrity();
   const twenty = pound(20).integrity();
   suite.note(`gemessen: 8 Treffer -> ${eight.toFixed(4)}, 20 Treffer -> ${twenty.toFixed(4)}`);
   ok(eight < 0.85, "SOLL: eine Breitseite (8 Treffer) kostet rund ein Viertel",
      "ist " + eight.toFixed(3));
   ok(twenty < 0.40, "SOLL: zweieinhalb Breitseiten (20 Treffer) machen sie gefechtsunfaehig",
      "ist " + twenty.toFixed(3));
   suite.note("Um das Soll zu treffen, muesste der Faktor 0.055 in damage.ts auf rund 0.11 steigen");
   suite.note("- oder die Faelle beschreiben ein Gefecht mit mehr als 8 Treffern je Breitseite.");
}

suite.section("2) Schliessen die Kapitaene auf Gefechtsentfernung auf?");
{
   // Captain.engage ist die gewuenschte Kampfentfernung. Der Manoeverteil
   // haelt sie nicht ein: beide bleiben weit ausserhalb stehen.
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 400 });
   const all = [];
   const targets = () => all.map((s) => s.targetInfo());
   const onHit = (h) => h.target.ship.takeHit(h);
   const mk = (id, x, z, hd) => {
      const s = new Ship({ vessel: getVessel(id), scene, debris, targets, onHit, sound: false });
      s.place(x, z, hd, 5); all.push(s); return s;
   };
   const A = mk("lydia", 0, 0, 90);
   const B = mk("amelie", 300, 90, 270);
   const ENGAGE_A = 160;
   const capA = new Captain(A, { doctrine: "hull", skill: 1.0, engage: ENGAGE_A });
   const capB = new Captain(B, { doctrine: "rig", skill: 0.85, engage: 220 });
   const wind = { dir: 20, speedKts: 16 };
   const amp = ampForWind(wind.speedKts), waveRad = Math.PI;
   let t = 0; const dt = 1 / 30;
   let minDist = Infinity;
   while (t < 1200 && !A.dmg.struck && !B.dmg.struck && !A.dmg.sunk && !B.dmg.sunk) {
      const gunCtx = { windDir: wind.dir, windSpeed: wind.speedKts,
         seaHeight: (x, z) => seaHeight(x, z, t, waveRad, amp) * 0.9 };
      const ctx = { wind, t, waveRad, amp, gunCtx };
      capA.update(dt, { wind, target: B }); capB.update(dt, { wind, target: A });
      A.update(dt, ctx); B.update(dt, ctx);
      A.battery.update(dt, gunCtx); B.battery.update(dt, gunCtx);
      minDist = Math.min(minDist, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
      t += dt;
   }
   suite.note(`gemessen: geringste Entfernung ${minDist.toFixed(0)} m bei engage ${ENGAGE_A} m, Dauer ${t.toFixed(0)} s`);
   ok(minDist < ENGAGE_A * 1.35, "SOLL: die Kapitaene kommen auf Gefechtsentfernung heran",
      minDist.toFixed(0) + " m");
   ok(t < 1200, "SOLL: das Gefecht wird binnen 20 Minuten entschieden", t.toFixed(0) + " s");
   suite.note("Captain._steer() haelt die Entfernung nicht - Ansatzpunkt: fleet.js Zeile ~91/94");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
