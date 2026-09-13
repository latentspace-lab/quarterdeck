// tests/unit/ballistics.test.js - Wurfbahn, Salve, Trefferpruefung.
import { Matrix4 } from "three/src/math/Matrix4.js";
import { Vector3 } from "three/src/math/Vector3.js";
import {
   rangeForElevation, elevationForRange, segmentBox, spawnSalvo,
   dischargeShots, stepProjectile, checkProjectileHits, rangeToTarget,
   makeRng, AMMO, SIM_DT, getVessel,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("ballistics");
const { ok, near, eq } = suite;

const BALL = AMMO.ball;

suite.section("Wurfweite");
{
   ok(rangeForElevation(0, 330, 0.22) > 0, "waagerecht aus 2.5 m Hoehe fliegt sie ein Stueck",
      rangeForElevation(0, 330, 0.22).toFixed(0) + " m");
   ok(rangeForElevation(6, 330, 0.22) > rangeForElevation(2, 330, 0.22),
      "mehr Erhoehung, mehr Weite");
   ok(rangeForElevation(6, 250, 0.55) < rangeForElevation(6, 330, 0.22),
      "die Kettenkugel bleibt kurz");
   ok(rangeForElevation(6, 330, 0.85) < rangeForElevation(6, 330, 0.22),
      "mehr Luftwiderstand, weniger Weite");
   ok(rangeForElevation(-1, 330, 0.22) < rangeForElevation(0, 330, 0.22),
      "nach unten gerichtet noch kuerzer");
   ok(Number.isFinite(rangeForElevation(21, 330, 0.22)), "auch am oberen Anschlag endlich");
}

suite.section("Richtloesung (Umkehrung)");
{
   for (const R of [120, 300, 500, 800]) {
      const e = elevationForRange(R, BALL.v0, BALL.drag);
      const got = rangeForElevation(e, BALL.v0, BALL.drag);
      near(got, R, R * 0.02, "Richtloesung fuer " + R + " m trifft", got.toFixed(0) + " m bei " + e.toFixed(2) + "°");
   }
   ok(elevationForRange(800, BALL.v0, BALL.drag) > elevationForRange(200, BALL.v0, BALL.drag),
      "weiter heisst hoeher richten");
   eq(elevationForRange(400, 330, 0.22), elevationForRange(400, 330, 0.22), "rein und reproduzierbar");
}

suite.section("segmentBox()");
{
   const P = (x, y, z) => ({ x, y, z });
   ok(segmentBox(P(-10, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1) !== null, "quer hindurch trifft");
   eq(segmentBox(P(-10, 5, 0), P(10, 5, 0), -1, 1, -1, 1, -1, 1), null, "darueber hinweg trifft nicht");
   eq(segmentBox(P(-10, 0, 0), P(-5, 0, 0), -1, 1, -1, 1, -1, 1), null,
      "eine Strecke, die vor der Box endet, trifft nicht");
   eq(segmentBox(P(5, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1), null,
      "eine Strecke hinter der Box trifft nicht");
   const t = segmentBox(P(-10, 0, 0), P(10, 0, 0), -1, 1, -1, 1, -1, 1);
   near(t, 0.45, 1e-9, "der Eintrittsparameter stimmt", String(t));
   eq(segmentBox(P(0, 0, 0), P(0, 0, 0.5), -1, 1, -1, 1, -1, 1), 0,
      "startet die Strecke drinnen, ist t = 0");
   // Achsenparallele Entartung: Richtung 0 in einer Achse.
   eq(segmentBox(P(5, 0, 0), P(5, 10, 0), -1, 1, -100, 100, -1, 1), null,
      "parallel ausserhalb trifft nicht");
   ok(segmentBox(P(0, -10, 0), P(0, 10, 0), -1, 1, -1, 1, -1, 1) !== null,
      "parallel innerhalb trifft");
}

suite.section("spawnSalvo(): aller Zufall an einer Stelle");
{
   const opts = {
      side: "PORT", ammo: "ball", muzzleCount: 13, readyCount: 13,
      spread: 0.32, gunnery: 1, rangeToTarget: 350, maxRange: 500,
   };
   const sig = (seed) => fingerprint(
      spawnSalvo(opts, makeRng(seed)).flatMap((s) => [s.idx, s.aimElev, s.aimTrain, s.at]));

   eq(sig(11), sig(11), "gleicher Seed, gleiche Salve");
   ok(sig(11) !== sig(12), "anderer Seed, andere Salve");

   const shots = spawnSalvo(opts, makeRng(11));
   eq(shots.length, 13, "ein Schuss je klarem Rohr");
   ok(shots.every((s) => s.side === "PORT"), "alle auf derselben Seite");
   ok(shots.every((s) => s.idx >= 0 && s.idx < 13), "Pfortenindizes im Bereich");
   ok(new Set(shots.map((s) => s.idx)).size === 13, "jede Pforte genau einmal");
   const aims = new Set(shots.map((s) => s.aimElev));
   eq(aims.size, 1, "die ganze Lage teilt einen Richtfehler (sie geht gemeinsam zu hoch oder zu tief)");
   ok(shots.every((s) => s.at >= 0 && s.at <= 0.32 + 0.035), "der Donner rollt ueber die Breitseite");
   ok(Math.max(...shots.map((s) => s.at)) > Math.min(...shots.map((s) => s.at)),
      "die Rohre loesen versetzt aus");

   // Ausgefallene Rohre werden gleichmaessig verteilt, nicht vorn gebuendelt.
   const half = spawnSalvo({ ...opts, readyCount: 6 }, makeRng(3));
   eq(half.length, 6, "sechs bediente Rohre, sechs Schuesse");
   ok(Math.max(...half.map((s) => s.idx)) > 8, "sie verteilen sich ueber die ganze Bordwand",
      half.map((s) => s.idx).join(","));
   eq(spawnSalvo({ ...opts, readyCount: 0 }, makeRng(3)).length, 0, "ausgeschlagene Seite feuert nicht");

   // Bessere Bedienungen streuen weniger.
   const spreadOf = (gunnery) => {
      let sum = 0;
      for (let s = 0; s < 200; s++) {
         sum += Math.abs(spawnSalvo({ ...opts, gunnery }, makeRng(s))[0].aimTrain);
      }
      return sum / 200;
   };
   ok(spreadOf(1.4) < spreadOf(0.6), "gedrillte Bedienungen streuen weniger",
      spreadOf(1.4).toExponential(2) + " gegen " + spreadOf(0.6).toExponential(2));

   // Ohne Ziel im Schussfeld wird auf halbe Reichweite gelegt.
   const blind = spawnSalvo({ ...opts, rangeToTarget: 0 }, makeRng(1));
   ok(blind.length === 13 && Number.isFinite(blind[0].aimElev), "ohne Ziel wird trotzdem gerichtet");
}

suite.section("dischargeShots() und Flugbahn");
{
   const rng = makeRng(42);
   const shots = dischargeShots({
      origin: { x: 0, y: 3, z: 0 }, flat: { x: 1, y: 0, z: 0 },
      ammo: "ball", aimElev: 2, aimTrain: 0, lb: 18,
   }, rng);
   eq(shots.length, 1, "eine Vollkugel je Rohr");
   const b = shots[0];
   ok(b.vel.x > 200, "sie geht nach Steuerbord hinaus", b.vel.x.toFixed(0) + " m/s");
   ok(b.vel.y > 0, "und leicht nach oben");
   near(Math.hypot(b.vel.x, b.vel.y, b.vel.z), BALL.v0, BALL.v0 * 0.06, "Muendungsgeschwindigkeit");

   eq(dischargeShots({ origin: { x: 0, y: 3, z: 0 }, flat: { x: 1, y: 0, z: 0 },
      ammo: "grape", aimElev: 0, aimTrain: 0, lb: 18 }, makeRng(1)).length,
      AMMO.grape.pellets, "die Kartaetsche wirft einen Schwarm");

   // Der Flug: Schwerkraft und Luftwiderstand, fester Schritt.
   let apex = -Infinity;
   let flightT = 0;
   while (b.pos.y > 0 && flightT < 30) { stepProjectile(b, SIM_DT); apex = Math.max(apex, b.pos.y); flightT += SIM_DT; }
   ok(apex > 3, "sie steigt ueber die Muendungshoehe", apex.toFixed(1) + " m");
   ok(flightT > 0.5 && flightT < 30, "und kommt wieder herunter", flightT.toFixed(1) + " s");
   ok(b.pos.x > 100, "und fliegt dabei weit", b.pos.x.toFixed(0) + " m");
   // prev/pos spannen den Streckenabschnitt auf, den die Trefferpruefung testet.
   ok(b.prev.x !== b.pos.x, "prev und pos unterscheiden sich nach dem Schritt");

   // Determinismus der ganzen Kette.
   const trace = (seed) => {
      const s = dischargeShots({ origin: { x: 0, y: 3, z: 0 }, flat: { x: 1, y: 0, z: 0 },
         ammo: "ball", aimElev: 2, aimTrain: 0, lb: 18 }, makeRng(seed))[0];
      const out = [];
      for (let i = 0; i < 60; i++) { stepProjectile(s, SIM_DT); out.push(s.pos.x, s.pos.y, s.pos.z); }
      return fingerprint(out);
   };
   eq(trace(7), trace(7), "gleicher Seed, gleiche Flugbahn");
   ok(trace(7) !== trace(8), "anderer Seed, andere Flugbahn");
}

suite.section("Trefferpruefung");
{
   const v = getVessel("amelie");
   const target = {
      id: "B", matrixWorld: new Matrix4().makeTranslation(150, 0, 0),
      LOA: v.hull.loa, BEAM: v.hull.beam, DRAFT: v.hull.draft, FB: 5,
      rigTop: 46, rigHalfWidth: v.hull.beam,
   };
   const mk = (from, to) => ({
      origin: { ...from }, prev: { ...from }, pos: { ...to },
      vel: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
      ammo: "ball", lb: 18, drag: 0.22,
   });
   const rng = makeRng(1);

   const hit = checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [target], 500, rng, "A");
   ok(hit !== null, "eine Kugel durch die Bordwand trifft");
   if (hit) {
      eq(hit.target.id, "B", "das richtige Ziel");
      ok(hit.side === "PORT" || hit.side === "STBD", "eine Seite wird bestimmt", hit.side);
      ok(hit.s >= 0 && hit.s <= 1, "Laengsposition normiert", hit.s.toFixed(2));
      ok(typeof hit.local.clone === "function", "local ist ein Vector3 (der Client klont es)");
      ok(typeof hit.world.clone === "function", "world ist ein Vector3");
      ok(typeof hit.dir.clone === "function", "dir ist ein Vector3");
      near(hit.dir.length(), 1, 1e-9, "dir ist normiert");
      ok(hit.speed > 0, "Auftreffgeschwindigkeit");
      eq(hit.ammo.id, "ball", "die Munitionsart wird durchgereicht");
   }

   eq(checkProjectileHits(mk({ x: 140, y: 200, z: 0 }, { x: 160, y: 200, z: 0 }), [target], 500, rng, "A"),
      null, "weit darueber hinweg trifft nichts");
   eq(checkProjectileHits(mk({ x: 0, y: 2, z: 0 }, { x: 10, y: 2, z: 0 }), [target], 500, rng, "A"),
      null, "eine Kugel, die das Ziel nicht erreicht, trifft nicht");
   eq(checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [target], 500, rng, "B"),
      null, "das eigene Schiff wird uebersprungen");
   eq(checkProjectileHits(mk({ x: 140, y: 2, z: 0 }, { x: 160, y: 2, z: 0 }), [], 500, rng, "A"),
      null, "ohne Ziele kein Treffer");

   // Das Rigg ist grossteils Luft: dieselbe Bahn trifft nicht immer.
   let caught = 0;
   const r2 = makeRng(5);
   for (let i = 0; i < 400; i++) {
      const s = mk({ x: 140, y: 25, z: 0 }, { x: 160, y: 25, z: 0 });
      if (checkProjectileHits(s, [target], 500, r2, "A")) caught++;
   }
   ok(caught > 0 && caught < 400, "im Rigg faengt sich nur ein Teil der Geschosse",
      caught + " von 400");

   // Je Geschoss und Ziel wird genau EINMAL gewuerfelt - danach fliegt sie durch.
   const persistent = mk({ x: 140, y: 25, z: 0 }, { x: 160, y: 25, z: 0 });
   const first = checkProjectileHits(persistent, [target], 500, makeRng(9), "A");
   const second = checkProjectileHits(persistent, [target], 500, makeRng(9), "A");
   eq(!!first, !!second, "die Wuerfelentscheidung im Rigg bleibt bestehen");

   // Kettenkugel faengt sich oefter als Vollkugel.
   const catchRate = (ammo) => {
      const r = makeRng(3);
      let n = 0;
      for (let i = 0; i < 600; i++) {
         const s = mk({ x: 140, y: 20, z: 0 }, { x: 160, y: 20, z: 0 });
         s.ammo = ammo;
         if (checkProjectileHits(s, [target], 500, r, "A")) n++;
      }
      return n / 600;
   };
   ok(catchRate("chain") > catchRate("ball"), "Kettenkugel faengt sich oefter im Tauwerk",
      (catchRate("chain") * 100).toFixed(0) + " % gegen " + (catchRate("ball") * 100).toFixed(0) + " %");
}

suite.section("rangeToTarget(): was in der Breitseite steht");
{
   const own = new Matrix4(); // Eigenes Schiff im Ursprung, Bug nach +Z
   const at = (x, z) => ({
      id: "t" + x + "_" + z, matrixWorld: new Matrix4().makeTranslation(x, 0, z),
      LOA: 40, BEAM: 10, DRAFT: 4, FB: 5,
   });
   near(rangeToTarget(own, "STBD", [at(200, 0)], 500, "me"), 200, 1e-6, "querab Steuerbord: 200 m");
   eq(rangeToTarget(own, "PORT", [at(200, 0)], 500, "me"), 0, "auf der falschen Seite: nichts");
   near(rangeToTarget(own, "PORT", [at(-150, 0)], 500, "me"), 150, 1e-6, "querab Backbord: 150 m");
   eq(rangeToTarget(own, "STBD", [at(20, 400)], 500, "me"), 0,
      "fast genau voraus laesst sich mit der Breitseite nicht fassen");
   eq(rangeToTarget(own, "STBD", [at(2000, 0)], 500, "me"), 0, "weit ausser Reichweite zaehlt nicht");
   near(rangeToTarget(own, "STBD", [at(400, 0), at(180, 0)], 500, "me"), 180, 1e-6,
      "das naechste Ziel gewinnt");
   eq(rangeToTarget(own, "STBD", [], 500, "me"), 0, "leere Liste: 0");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
