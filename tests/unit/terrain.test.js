// tests/unit/terrain.test.js - Seekarte als Rechenmodell.
import {
   World, generateWorld, activeWorld, setActiveWorld, worldInfo,
   groundHeight, waterDepth, isOpenWater, findOpenWater, nearestShoal,
   makeRng, PLAY_RADIUS,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("terrain-math");
const { ok, near, eq } = suite;

const featureSig = (w) => fingerprint(w.features.flatMap((f) => [f.x, f.z, f.r, f.h]), 9);

suite.section("Determinismus");
{
   const a = new World(4242);
   const b = new World(4242);
   eq(featureSig(a), featureSig(b), "gleicher Seed, gleiche Karte");
   ok(featureSig(a) !== featureSig(new World(4243)), "anderer Seed, andere Karte");
   ok(a.features.length > 0, "die Karte ist nicht leer", a.features.length + " Merkmale");
   eq(a.seed, 4242, "der Seed wird mitgefuehrt");

   // Das ist die Zusage fuer Phase 1: der Server schickt nur den Seed.
   const client = new World(a.seed);
   let same = true;
   for (let i = 0; i < 200; i++) {
      const x = -1500 + i * 15;
      const z = 900 - i * 11;
      if (Math.abs(client.groundHeight(x, z) - a.groundHeight(x, z)) > 1e-12) same = false;
   }
   ok(same, "aus dem Seed allein entsteht dieselbe Tiefenkarte");
}

suite.section("Leere Welt");
{
   const empty = new World(1, { islands: 0, freeReefs: 0 });
   eq(empty.features.length, 0, "keine Merkmale");
   eq(empty.waterDepth(0, 0), 26, "offenes Wasser ist 26 m tief");
   eq(empty.waterDepth(5000, -5000), 26, "auch weit draussen");
}

suite.section("Tiefe und Land");
{
   const w = new World(777);
   ok(Number.isFinite(w.groundHeight(0, 0)), "Grundhoehe ist endlich");
   near(w.waterDepth(123, -456), -w.groundHeight(123, -456), 1e-12,
      "Tiefe ist das negierte Grundprofil");

   // Um den Nullpunkt bleibt ein Revier frei - sonst startet ein Schiff auf einem Riff.
   let minHome = Infinity;
   for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      minHome = Math.min(minHome, w.waterDepth(Math.cos(a) * 300, Math.sin(a) * 300));
   }
   ok(minHome > 15, "im Startrevier ist ueberall Wasser", minHome.toFixed(1) + " m");

   // Inseln ragen heraus, Riffe liegen knapp darunter.
   if (w.islands.length) {
      const isle = w.islands[0];
      ok(w.groundHeight(isle.x, isle.z) > 0, "die Insel ragt aus dem Wasser",
         w.groundHeight(isle.x, isle.z).toFixed(1) + " m");
   }
   for (const r of w.reefs.slice(0, 3)) {
      const d = w.waterDepth(r.x, r.z);
      ok(d < 26, "das Riff hebt den Grund", d.toFixed(1) + " m Resttiefe");
   }
   ok(w.reefs.every((r) => Math.hypot(r.x, r.z) >= 0), "Riffe haben Koordinaten");
   ok(w.islands.every((i) => Math.hypot(i.x, i.z) < PLAY_RADIUS + 500), "Inseln liegen im Revier");
}

suite.section("Freies Wasser suchen");
{
   const w = new World(31337);
   const rng = makeRng(9);
   for (let k = 0; k < 25; k++) {
      const p = w.findOpenWater({ rng, near: { x: 0, z: 0 }, minDist: 200, maxDist: 1200 });
      if (!w.isOpenWater(p.x, p.z, 15, 220) && !(p.x === 0 && p.z === 0)) {
         ok(false, "findOpenWater liefert offenes Wasser");
         break;
      }
      if (k === 24) ok(true, "25 gesuchte Plaetze liegen alle im Freien");
   }
   // Mit demselben Generator kommt dieselbe Folge von Plaetzen heraus.
   const seqA = Array.from({ length: 5 }, () => w.findOpenWater({ rng: makeRng(4) }));
   const seqB = Array.from({ length: 5 }, () => w.findOpenWater({ rng: makeRng(4) }));
   eq(fingerprint(seqA.flatMap((p) => [p.x, p.z])), fingerprint(seqB.flatMap((p) => [p.x, p.z])),
      "mit gleichem Generator dieselben Plaetze");

   const sh = w.nearestShoal(0, 0);
   ok(sh && Number.isFinite(sh.dist), "nearestShoal meldet eine Entfernung",
      sh ? sh.dist.toFixed(0) + " m" : "-");
}

suite.section("Aktive Karte (Einspieler-Pfad)");
{
   const w = generateWorld(2468);
   eq(activeWorld(), w, "generateWorld setzt die aktive Karte");
   eq(worldInfo().seed, 2468, "worldInfo liefert sie zurueck");
   near(groundHeight(100, 100), w.groundHeight(100, 100), 1e-12, "die freien Funktionen lesen daraus");
   near(waterDepth(100, 100), w.waterDepth(100, 100), 1e-12, "waterDepth ebenso");
   eq(isOpenWater(0, 0), w.isOpenWater(0, 0), "isOpenWater ebenso");
   ok(typeof findOpenWater({ rng: makeRng(1) }).x === "number", "findOpenWater ebenso");
   ok(nearestShoal(0, 0) !== undefined, "nearestShoal ebenso");

   // Umschalten auf eine andere Karte wirkt sofort - so bekommt in Phase 1
   // jeder Raum seine eigene Welt.
   const other = new World(1);
   setActiveWorld(other);
   near(groundHeight(100, 100), other.groundHeight(100, 100), 1e-12, "setActiveWorld schaltet um");
   setActiveWorld(w);
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
