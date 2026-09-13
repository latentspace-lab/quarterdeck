// tests/regression/determinism.test.js
//
// Die Zusage von Phase 0D: gleicher Seed + gleiche Eingaben -> gleiches
// Ergebnis. Ohne sie gibt es keine wiederholbaren Gefechtstests, keine
// nachspielbaren Salven (Phase 3C) und keine belastbare Fehlersuche.
//
// Was hier NICHT behauptet wird: dass Client und Server zu denselben
// Schadenswuerfen kommen. Im serverautoritativen Entwurf laeuft die
// Schadenslogik gar nicht auf dem Client, und die Reihenfolge, in der der
// Server seinen Generator verbraucht, haengt an der Ankunftsreihenfolge der
// Eingaben.
import {
   BoatDynamics, DamageModel, Crew, SeaState, Wind, World,
   spawnSalvo, dischargeShots, stepProjectile,
   makeRng, deriveRng, getVessel, AMMO, SIM_DT,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Determinismus");
const { ok, eq } = suite;

const SEED = 20260913;
const VESSEL = getVessel("lydia");

// ---------------------------------------------------------------------------
// Ein vollstaendiger Simulationslauf aus einem einzigen Seed.
// Genau so wird ein Raum in Phase 1 aufgesetzt: WorldParams rein, Zustand raus.
// ---------------------------------------------------------------------------
function run(seed, ticks = 900) {
   const world = new World(seed);
   const wind = new Wind({ dir: 20, speed: 16, variability: 1 });
   const sea = new SeaState(16);
   const dyn = new BoatDynamics({ vessel: VESSEL, heading: 110 });
   const dmg = new DamageModel(VESSEL, { rng: deriveRng(seed, "dmg") });
   const crew = new Crew(VESSEL, { rng: deriveRng(seed, "crew") });
   const salvoRng = deriveRng(seed, "salvo");

   const trace = [];
   let t = 0;
   for (let i = 0; i < ticks; i++) {
      t += SIM_DT;
      wind.update(SIM_DT, t);
      sea.step(SIM_DT, wind.speed, wind.dir);

      dyn.setRudder(Math.sin(i * 0.017) * 0.7);
      dyn.driveMul = dmg.driveFactor();
      dyn.rudderMul = dmg.rudderFactor();
      dyn.heelBias = dmg.floodHeel();
      dyn.step(SIM_DT, { dir: wind.dir, speedKts: wind.speed });

      // Alle 60 Ticks eine Breitseite und ein Treffer - damit auch die
      // gewuerfelten Pfade im Lauf vorkommen.
      if (i % 60 === 30) {
         const shots = spawnSalvo({
            side: i % 120 === 30 ? "PORT" : "STBD", ammo: "ball",
            muzzleCount: 13, readyCount: 11, spread: 0.32,
            gunnery: 1.1, rangeToTarget: 320, maxRange: 500,
         }, salvoRng);
         trace.push(shots.length, shots[0].aimElev, shots[0].at);
         const res = dmg.applyHit({
            side: "STBD", s: (i % 300) / 300, y: 2 + (i % 7),
            ammo: AMMO.ball, lb: 18, range01: 0.2, freeboard: 5,
         });
         if (res) {
            crew.hit(res.crew.n, res.crew.where);
            trace.push(res.splinters, res.crew.n, res.holed ? 1 : 0);
         }
      }
      dmg.update(SIM_DT, { heel: dyn.heel, pump: crew.pumping() });
      crew.update(SIM_DT);

      trace.push(
         dyn.pos.x, dyn.pos.z, dyn.heading, dyn.speed, dyn.heel, dyn.rudder,
         sea.seaWind, sea.phaseT, dmg.integrity(), dmg.flooding, crew.fit,
      );
   }
   return {
      sig: fingerprint(trace),
      worldSig: fingerprint(world.features.flatMap((f) => [f.x, f.z, f.r, f.h]), 9),
      state: {
         x: dyn.pos.x, z: dyn.pos.z, heading: dyn.heading, speed: dyn.speed,
         seaWind: sea.seaWind, hull: dmg.integrity(), fit: crew.fit,
      },
   };
}

suite.section("Ein Seed, ein Ergebnis");
{
   const a = run(SEED);
   const b = run(SEED);
   eq(a.sig, b.sig, "900 Ticks zweimal gerechnet: identische Spur", a.sig);
   eq(a.worldSig, b.worldSig, "identische Seekarte", a.worldSig);
   suite.deepEq(a.state, b.state, "identischer Endzustand");
}

suite.section("Ein anderer Seed ergibt ein anderes Gefecht");
{
   const a = run(SEED);
   const c = run(SEED + 1);
   ok(a.sig !== c.sig, "die Spur unterscheidet sich");
   ok(a.worldSig !== c.worldSig, "und die Seekarte auch");
}

suite.section("Laenge spielt keine Rolle - ein Praefix bleibt ein Praefix");
{
   // Wer 900 Ticks rechnet, muss in den ersten 300 exakt dasselbe tun wie
   // jemand, der nur 300 rechnet. Das klingt trivial, faellt aber um, sobald
   // irgendwo ein Zustand ausserhalb der Schleife haengt.
   const short300 = run(SEED, 300).state;
   const long900 = run(SEED, 900);
   const alsoShort = run(SEED, 300).state;
   suite.deepEq(short300, alsoShort, "300 Ticks sind reproduzierbar");
   ok(long900.state.x !== short300.x, "und 900 Ticks fuehren weiter", "Sanity");
}

suite.section("Zufallsstroeme bleiben getrennt");
{
   // Das Schadensmodell darf dem Salvengenerator keine Zahlen wegnehmen.
   const salvoOnly = (seed, extraDamageRolls) => {
      const salvo = deriveRng(seed, "salvo");
      const dmg = new DamageModel(VESSEL, { rng: deriveRng(seed, "dmg") });
      for (let i = 0; i < extraDamageRolls; i++) {
         dmg.applyHit({ side: "PORT", s: 0.4, y: 2, ammo: AMMO.ball, lb: 18, range01: 0.3, freeboard: 5 });
      }
      const opts = { side: "PORT", ammo: "ball", muzzleCount: 13, readyCount: 13,
         spread: 0.3, gunnery: 1, rangeToTarget: 300, maxRange: 500 };
      return fingerprint(spawnSalvo(opts, salvo).flatMap((s) => [s.aimElev, s.aimTrain, s.at]));
   };
   eq(salvoOnly(5, 0), salvoOnly(5, 250),
      "250 Schadenswuerfe mehr aendern die naechste Salve nicht");
}

suite.section("Die Flugbahn einer Salve laesst sich nachspielen");
{
   // Phase 3C in klein: Seed und Ausgangslage reichen, um bei jedem
   // Teilnehmer dieselben Einschlaege zu erzeugen.
   const replay = (seed) => {
      const rng = makeRng(seed);
      const salvo = spawnSalvo({
         side: "STBD", ammo: "ball", muzzleCount: 13, readyCount: 13,
         spread: 0.32, gunnery: 1.1, rangeToTarget: 340, maxRange: 500,
      }, rng);
      const out = [];
      for (const sh of salvo) {
         const shots = dischargeShots({
            origin: { x: 0, y: 4, z: sh.idx * 2 - 12 },
            flat: { x: 1, y: 0, z: 0 },
            ammo: sh.ammo, aimElev: sh.aimElev, aimTrain: sh.aimTrain, lb: 18,
         }, rng);
         for (const b of shots) {
            for (let i = 0; i < 120 && b.pos.y > 0; i++) stepProjectile(b, SIM_DT);
            out.push(b.pos.x, b.pos.y, b.pos.z);
         }
      }
      return fingerprint(out);
   };
   eq(replay(31337), replay(31337), "gleicher Seed, gleiche Einschlaege", replay(31337));
   ok(replay(31337) !== replay(31338), "anderer Seed, andere Einschlaege");
}

suite.section("Kein verstecktes Math.random() in den geteilten Modulen");
{
   // Der Nachweis mit dem Holzhammer: Math.random wird abgeklemmt. Faellt
   // irgendwo noch ein unbeseedeter Wurf, fliegt der Lauf hier auf.
   const real = Math.random;
   let leaked = 0;
   Math.random = () => { leaked++; return 0.5; };
   try {
      run(SEED, 300);
   } finally {
      Math.random = real;
   }
   eq(leaked, 0, "der Simulationslauf greift kein einziges Mal auf Math.random zurueck");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
