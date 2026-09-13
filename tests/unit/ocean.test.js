// tests/unit/ocean.test.js - Wellenmathematik und Seegangszustand.
import {
   WAVES, seaHeight, ampForWind, lambdaForWind, waveHeightForWind,
   whitecapsForWind, seaStateName, SeaState, SIM_DT,
} from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("ocean-math");
const { ok, near, eq } = suite;

suite.section("Wellentabelle");
ok(WAVES.length >= 4, "mehrere Wellenkomponenten", WAVES.length + " Stueck");
ok(WAVES.every((w) => w.a > 0 && w.L > 0 && w.q > 0), "alle Komponenten physikalisch sinnvoll");
ok(WAVES.every((w, i, a) => i === 0 || w.a <= a[i - 1].a), "nach Amplitude absteigend sortiert");

suite.section("Seegang aus Wind (Pierson-Moskowitz)");
eq(waveHeightForWind(0), 0, "Flaute: keine Welle");
ok(waveHeightForWind(30) > waveHeightForWind(12), "mehr Wind, hoehere See");
// Hs waechst mit dem Quadrat der Windgeschwindigkeit: doppelter Wind -> vierfache Hoehe
near(waveHeightForWind(20) / waveHeightForWind(10), 4, 0.02, "doppelter Wind, vierfache Hoehe");
ok(waveHeightForWind(200) <= 11.5 + 1e-9, "gedeckelt, damit aus dem Orkan kein Tsunami wird",
   waveHeightForWind(200).toFixed(2) + " m");
ok(lambdaForWind(30) > lambdaForWind(12), "Sturmsee hat laengere Wellen");
ok(lambdaForWind(30) / lambdaForWind(12) < waveHeightForWind(30) / waveHeightForWind(12),
   "die Laenge waechst langsamer als die Hoehe (die See bleibt steil)");
eq(whitecapsForWind(5), 0, "unter Bft 4 keine Weisskappen");
ok(whitecapsForWind(20) > 0 && whitecapsForWind(20) < 1, "dazwischen anteilig");
eq(whitecapsForWind(60), 1, "im Sturm bedeckt");
eq(seaStateName(0), "calm", "Douglas-Skala: calm");
ok(seaStateName(40) === "high" || seaStateName(40) === "very high", "Douglas-Skala: schwer",
   seaStateName(40));

suite.section("seaHeight()");
{
   const amp = ampForWind(16);
   let finite = true;
   let maxAbs = 0;
   for (let i = 0; i < 400; i++) {
      const h = seaHeight(i * 7.3 - 900, i * -3.1 + 400, i * 0.11, 1.9, amp, lambdaForWind(16));
      if (!Number.isFinite(h)) finite = false;
      maxAbs = Math.max(maxAbs, Math.abs(h));
   }
   ok(finite, "ueberall endlich");
   ok(maxAbs < waveHeightForWind(16) * 1.2, "bleibt im Rahmen der signifikanten Hoehe",
      maxAbs.toFixed(2) + " m bei Hs " + waveHeightForWind(16).toFixed(2) + " m");
   eq(seaHeight(10, 20, 3, 1.0, 0.2, 1), seaHeight(10, 20, 3, 1.0, 0.2, 1), "rein (gleiche Eingabe, gleiches Ergebnis)");
   ok(seaHeight(10, 20, 3, 1.0, 0.4, 1) !== seaHeight(10, 20, 3, 1.0, 0.2, 1), "reagiert auf die Amplitude");
   ok(seaHeight(10, 20, 4, 1.0, 0.2, 1) !== seaHeight(10, 20, 3, 1.0, 0.2, 1), "laeuft mit der Zeit");
   eq(seaHeight(0, 0, 0, Math.PI, 0, 1), 0, "Amplitude 0 ergibt eine Spiegelflaeche");
}

suite.section("SeaState: Nachlauf des Seegangs");
{
   const s = new SeaState(12);
   eq(s.seaWind, 12, "startet beim Anfangswind");
   eq(s.phaseT, 0, "Phase beginnt bei 0");

   // Auffrischen: die See folgt, aber langsam (tau 45 s).
   for (let i = 0; i < 30; i++) s.step(SIM_DT, 30, 0); // eine Sekunde
   ok(s.seaWind > 12 && s.seaWind < 13, "nach 1 s ist die See kaum gefolgt", s.seaWind.toFixed(3));
   for (let i = 0; i < 30 * 180; i++) s.step(SIM_DT, 30, 0); // drei Minuten
   near(s.seaWind, 30, 0.6, "nach 3 min steht sie fast am Wind", s.seaWind.toFixed(2));

   // Abklingen ist langsamer als Aufbau (tau 95 s gegen 45 s).
   const up = new SeaState(10);
   const down = new SeaState(30);
   for (let i = 0; i < 30 * 30; i++) { up.step(SIM_DT, 30, 0); down.step(SIM_DT, 10, 0); }
   const climbed = (up.seaWind - 10) / 20;
   const fell = (30 - down.seaWind) / 20;
   ok(climbed > fell, "eine See baut sich schneller auf als sie ablaeuft",
      (climbed * 100).toFixed(0) + " % gegen " + (fell * 100).toFixed(0) + " %");
}

suite.section("SeaState: Wellenphase");
{
   const s = new SeaState(12);
   for (let i = 0; i < 30; i++) s.step(SIM_DT, 12, 0);
   ok(s.phaseT > 0 && s.phaseT < 1.2, "Phase laeuft, aber langsamer als die Uhr",
      s.phaseT.toFixed(3) + " s in 1.0 s");

   // Lange Wellen laufen langsamer: mehr Wind -> mehr lambda -> weniger Phase.
   const calm = new SeaState(6);
   const storm = new SeaState(40);
   for (let i = 0; i < 300; i++) { calm.step(SIM_DT, 6, 0); storm.step(SIM_DT, 40, 0); }
   ok(storm.phaseT < calm.phaseT, "Sturmwellen laufen langsamer durch die Phase",
      storm.phaseT.toFixed(2) + " gegen " + calm.phaseT.toFixed(2));
}

suite.section("SeaState: Determinismus und Uebertragung");
{
   const trace = (n) => {
      const s = new SeaState(12);
      const out = [];
      for (let i = 0; i < n; i++) {
         s.step(SIM_DT, 12 + Math.sin(i * 0.01) * 8, 20 + i * 0.02);
         out.push(s.seaWind, s.phaseT, s.heightAt(30, -12));
      }
      return out;
   };
   eq(fingerprint(trace(600)), fingerprint(trace(600)),
      "gleicher Eingabeverlauf, identische Spur");

   // SeaSync: der uebertragene Zustand muss die Wasserflaeche vollstaendig
   // wiederherstellen - sonst rechnen Client und Server auf verschiedenen Wellen.
   const a = new SeaState(12);
   for (let i = 0; i < 500; i++) a.step(SIM_DT, 22, 47);
   const b = new SeaState(0);
   b.fromSync(a.toSync());
   b.windRad = a.windRad;
   near(b.heightAt(12.5, -33.25), a.heightAt(12.5, -33.25), 1e-12,
      "aus SeaSync wiederhergestellt: gleiche Wellenhoehe");
   near(b.amp, a.amp, 1e-12, "gleiche Amplitude");
   near(b.lambda, a.lambda, 1e-12, "gleiche Streckung");

   const sam = a.sampler(0.9);
   near(sam(5, 5), a.heightAt(5, 5) * 0.9, 1e-12, "sampler() liefert die skalierte Flaeche");
   // Der Sampler friert den Zustand ein - so rechnen alle Systeme eines Ticks
   // mit exakt derselben Flaeche, auch wenn die See danach weiterlaeuft.
   const frozen = sam(5, 5);
   a.step(SIM_DT, 22, 47);
   near(sam(5, 5), frozen, 1e-12, "sampler() bleibt innerhalb des Ticks stabil");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
