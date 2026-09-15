// main.js - entry point
import { Simulator } from "./game.js";
import { Accumulator, SIM_DT } from "@quarterdeck/shared";

// Splash screen element (declared in index.html, fades out when the
// renderer is up). Replaces the old inline boot text.
const splash = document.getElementById("splash");
const splashLoading = splash ? splash.querySelector(".splash-loading") : null;

function showError(msg) {
   if (splashLoading) {
      splashLoading.textContent = "Error: " + msg;
      splashLoading.style.color = "var(--bad)";
   }
   console.error("[quarterdeck] initialization error:", msg);
}

let sim = null;
try {
   sim = new Simulator();
   window.__sim = sim;
   // Fade out the splash screen once the renderer is running
   setTimeout(() => {
      if (splash) {
         splash.classList.add("hidden");
         setTimeout(() => splash.remove(), 800);
      }
   }, 1200);

   // Allow click/tap to dismiss the splash early
   if (splash) {
      splash.addEventListener("click", () => {
         splash.classList.add("hidden");
         setTimeout(() => splash.remove(), 800);
      });
   }
} catch (err) {
   showError(err && err.message ? err.message : String(err));
   if (splash) splash.style.cursor = "default";
   const hint = document.createElement("div");
   hint.style.cssText =
       "position:fixed;left:50%;top:18%;transform:translateX(-50%);color:#e8d9b0;font-family:var(--font);text-align:center;z-index:60;max-width:560px;line-height:1.5;text-shadow:0 2px 8px rgba(0,0,0,0.8)";
   hint.innerHTML =
       "The 3D renderer could not be started.<br>" +
       "Possible causes: WebGL disabled in the browser, old/insecure TLS, or the server isn't running.<br>" +
       "Open the page via <b>http://127.0.0.1:5180/</b> (Vite dev server) or build with <b>npm run build</b>.";
   document.body.appendChild(hint);
}

// ---------------------------------------------------------------------------
// Game loop: fixed simulation, free-running rendering (Phase 0B')
//
// The simulation runs at SIM_DT (30 Hz); rendering happens at screen rate.
// An accumulator collects the elapsed time and hands it out in whole steps;
// the remainder (alpha) interpolates ship poses between the last two steps
// so nothing judders at 60 or 144 Hz.
//
// Why not simply sim.step(dt) per frame: the physics contains smoothing that
// depends on dt. Only with a constant dt does a re-simulation on the server
// arrive at the same result - the precondition for client prediction.
// ---------------------------------------------------------------------------
const acc = new Accumulator(SIM_DT);
let errShown = false;

function frame(now) {
   requestAnimationFrame(frame);
   if (!sim) return;

   const steps = acc.advance(now);
   try {
      if (steps === 0) console.debug("[quarterdeck] no steps this frame, acc.acc=", acc.acc, "elapsed=", (now - acc.last) / 1000);
      for (let i = 0; i < steps; i++) sim.stepFixed(SIM_DT);
      sim.render(acc.alpha, SIM_DT * Math.max(steps, 1));
      if (errShown && splashLoading) {
         errShown = false;
         splashLoading.style.color = "";
         splashLoading.textContent = "Quarterdeck";
      }
   } catch (err) {
      console.error("[quarterdeck] frame error:", err);
      sim.renderOnly(); // show a frame anyway
      acc.reset(now);   // after an error, don't make up for the lost time
      if (!errShown && splashLoading) {
         errShown = true;
         splashLoading.textContent = "Error: " + (err && err.message ? err.message : String(err));
         splashLoading.style.color = "var(--bad)";
      }
   }
}
requestAnimationFrame((t0) => {
   acc.reset(t0);
   frame(t0);
});

// A backgrounded tab gets no frames. When it comes back, the simulation
// must not catch up on the pause - otherwise the ship would jump.
document.addEventListener("visibilitychange", () => {
   if (!document.hidden) acc.reset(performance.now());
});

console.log("[quarterdeck] loaded. window.__sim", sim ? "= Simulator" : "(error)");
