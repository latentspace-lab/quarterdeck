// main.js - Entry point
import { Simulator } from "./game.js";
import { Accumulator, SIM_DT } from "@segel/shared";

// boat overlay (stays visible until the renderer is running)
const boot = document.createElement("div");
// Colours and font come from the stylesheet tokens so the overlay follows the
// rendering style (styles.css).
boot.style.cssText =
    "position:fixed;left:50%;bottom:14px;transform:translateX(-50%);color:var(--text);font-family:var(--font);font-size:13px;opacity:.9;z-index:30;pointer-events:none;text-align:center;background:var(--paper-solid);border:1px solid var(--rule);padding:6px 14px;border-radius:var(--r-pill)";
boot.textContent = "Sailing Simulator 3D — initializing…";
document.body.appendChild(boot);

function showError(msg) {
   boot.textContent = "Error: " + msg;
   boot.style.color = "var(--bad)";
   boot.style.opacity = "1";
   console.error("[segel-simulator] Initialization error:", msg);
}

let sim = null;
try {
   sim = new Simulator();
   window.__sim = sim;
   // nach kurzer time den boat-Text ausblenden
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
       "The 3D renderer could not start.<br>" +
       "Causes: WebGL disabled in the browser, old/insecure TLS, or the server is not running.<br>" +
       "Open the page via <b>http://127.0.0.1:5180/</b> (Vite dev server) or build with <b>npm run build</b>.";
   document.body.appendChild(hint);
}

// ---------------------------------------------------------------------------
// Game loop: fixed simulation, free rendering (Phase 0B')
//
// The simulation runs at SIM_DT (30 Hz), rendering at display rate.
// An accumulator collects elapsed time and dispenses it in whole steps;
// the remainder (alpha) interpolates ship positions between the last two
// steps, so at 60 or 144 Hz nothing stutters.
//
// Why not just sim.step(dt) per frame: the physics contains smoothing
// terms that depend on dt. Only with constant dt does a replay on the
// server produce the same result — the prerequisite for client prediction.
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
         boot.textContent = "Sailing Simulator 3D";
      }
   } catch (err) {
      console.error("[segel-simulator] Frame error:", err);
      sim.renderOnly(); // trotzdem ein Bild zeigen
      acc.reset(now);   // don't catch up the lost time after an error
      if (!errShown) {
         errShown = true;
         boot.style.opacity = "1";
         boot.style.color = "var(--bad)";
         boot.textContent = "Error: " + (err && err.message ? err.message : String(err));
      }
   }
}
requestAnimationFrame((t0) => {
   acc.reset(t0);
   frame(t0);
});

// A tab in the background gets no frames. On returning, the simulation
// must not catch up the pause — otherwise the ship jumps.
document.addEventListener("visibilitychange", () => {
   if (!document.hidden) acc.reset(performance.now());
});

console.log("[segel-simulator] loaded. window.__sim", sim ? "= Simulator" : "(error)");
