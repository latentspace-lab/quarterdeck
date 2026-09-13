// main.js - Einstiegspunkt
import { Simulator } from "./game.js";

// Start-Overlay (bleibt sichtbar, bis der Renderer läuft)
const boot = document.createElement("div");
boot.style.cssText =
    "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);color:#bfe6ff;font-family:system-ui,sans-serif;font-size:13px;opacity:.9;z-index:30;pointer-events:none;text-align:center;background:rgba(6,16,24,.55);padding:6px 14px;border-radius:20px";
boot.textContent = "Segel-Simulator 3D — initialisiert…";
document.body.appendChild(boot);

function showError(msg) {
   boot.textContent = "Fehler: " + msg;
   boot.style.color = "#ff8b8b";
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
       "position:fixed;left:50%;top:18%;transform:translateX(-50%);color:#9ff;font-family:system-ui;text-align:center;z-index:30;max-width:560px;line-height:1.5";
   hint.innerHTML =
       "Der 3D-Renderer konnte nicht gestartet werden.<br>" +
       "Ursachen: WebGL im Browser deaktiviert, alte/unsichere TLS, oder der Server laeuft nicht.<br>" +
       "Oeffne die Seite ueber <b>http://127.0.0.1:5180/</b> (Vite-Dev-Server) oder baue mit <b>npm run build</b>.";
   document.body.appendChild(hint);
}

// Animationsschleife (nur wenn Sim aktiv)
let last = performance.now();
const MAX_DT = 0.05;
let errShown = false;
function frame() {
    requestAnimationFrame(frame);
   if (!sim || sim.menuOpen) return;
   let now = performance.now();
   let dt = (now - last) / 1000;
   last = now;
   dt = Math.min(dt, MAX_DT);
   try {
      sim.step(dt);
      if (errShown) {
         errShown = false;
         boot.style.color = "#bfe6ff";
         boot.textContent = "Segel-Simulator 3D";
      }
   } catch (err) {
      console.error("[segel-simulator] Framefehler:", err);
      sim.renderOnly(); // trotzdem ein Bild zeigen
      if (!errShown) {
         errShown = true;
         boot.style.opacity = "1";
         boot.style.color = "#ff8b8b";
         boot.textContent = "Fehler: " + (err && err.message ? err.message : String(err));
      }
    }
}
requestAnimationFrame(frame);

console.log("[segel-simulator] geladen. window.__sim", sim ? "= Simulator" : "(Fehler)");
