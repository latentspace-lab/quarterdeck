// main.js - Einstiegspunkt
import { Simulator } from "./game.js";
import { Accumulator, SIM_DT } from "@segel/shared";

// Start-Overlay (bleibt sichtbar, bis der Renderer läuft)
const boot = document.createElement("div");
// Colours and font come from the stylesheet tokens so the overlay follows the
// rendering style (styles.css).
boot.style.cssText =
    "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);color:var(--text);font-family:var(--font);font-size:13px;opacity:.9;z-index:30;pointer-events:none;text-align:center;background:var(--paper-solid);border:1px solid var(--rule);padding:6px 14px;border-radius:var(--r-pill)";
boot.textContent = "Segel-Simulator 3D — initialisiert…";
document.body.appendChild(boot);

function showError(msg) {
   boot.textContent = "Fehler: " + msg;
   boot.style.color = "var(--bad)";
   boot.style.opacity = "1";
   console.error("[segel-simulator] Initialisierungsfehler:", msg);
}

let sim = null;
try {
   sim = new Simulator();
   window.__sim = sim;
   // nach kurzer Zeit den Boot-Text ausblenden
   setTimeout(() => {
      boot.style.opacity = "0";
      setTimeout(() => boot.remove(), 600);
   }, 1200);
} catch (err) {
   showError(err && err.message ? err.message : String(err));
   const hint = document.createElement("div");
   hint.style.cssText =
       "position:fixed;left:50%;top:18%;transform:translateX(-50%);color:var(--text);font-family:var(--font);text-align:center;z-index:30;max-width:560px;line-height:1.5";
   hint.innerHTML =
       "Der 3D-Renderer konnte nicht gestartet werden.<br>" +
       "Ursachen: WebGL im Browser deaktiviert, alte/unsichere TLS, oder der Server laeuft nicht.<br>" +
       "Oeffne die Seite ueber <b>http://127.0.0.1:5180/</b> (Vite-Dev-Server) oder baue mit <b>npm run build</b>.";
   document.body.appendChild(hint);
}

// ---------------------------------------------------------------------------
// Spielschleife: feste Simulation, freie Darstellung (Phase 0B')
//
// Die Simulation laeuft mit SIM_DT (30 Hz), gerendert wird mit Bildschirmrate.
// Ein Akkumulator sammelt die vergangene Zeit und gibt sie in ganzen Schritten
// aus; der Rest (alpha) interpoliert die Schiffslagen zwischen den letzten
// beiden Schritten, damit bei 60 oder 144 Hz nichts ruckelt.
//
// Warum nicht einfach sim.step(dt) je Frame: die Physik enthaelt Glaettungen,
// die von dt abhaengen. Nur bei konstantem dt kommt eine Nachsimulation auf
// dem Server auf dasselbe Ergebnis - die Voraussetzung fuer Client-Prediction.
// ---------------------------------------------------------------------------
const acc = new Accumulator(SIM_DT);
let errShown = false;

function frame(now) {
   requestAnimationFrame(frame);
   if (!sim) return;

   const steps = acc.advance(now);
   try {
      for (let i = 0; i < steps; i++) sim.stepFixed(SIM_DT);
      sim.render(acc.alpha, SIM_DT * Math.max(steps, 1));
      if (errShown) {
         errShown = false;
         boot.style.color = "var(--text)";
         boot.textContent = "Segel-Simulator 3D";
      }
   } catch (err) {
      console.error("[segel-simulator] Framefehler:", err);
      sim.renderOnly(); // trotzdem ein Bild zeigen
      acc.reset(now);   // nach einem Fehler nicht die verlorene Zeit aufholen
      if (!errShown) {
         errShown = true;
         boot.style.opacity = "1";
         boot.style.color = "var(--bad)";
         boot.textContent = "Fehler: " + (err && err.message ? err.message : String(err));
      }
   }
}
requestAnimationFrame((t0) => {
   acc.reset(t0);
   frame(t0);
});

// Ein Tab im Hintergrund bekommt keine Frames. Beim Zurueckkommen darf die
// Simulation die Pause nicht nachholen - sonst springt das Schiff.
document.addEventListener("visibilitychange", () => {
   if (!document.hidden) acc.reset(performance.now());
});

console.log("[segel-simulator] geladen. window.__sim", sim ? "= Simulator" : "(Fehler)");
