// ui.js - 2D HUD + compass + menu + training panel
import { normDeg } from "./utils.js";
import { VESSELS, vesselLabel, broadsideWeight, gunCount } from "./vessels.js";
import { palette } from "./style.js";
import { safeStorage, readJSON, writeJSON } from "./storage.js";

// Folding panels. A panel that is not pinned open shows only its head with
// a one-line summary; it unfolds by itself for a few seconds when what it
// reports changes for the worse (a hit, a casualty, a wind shift), the way
// a good first lieutenant reports only what the captain must hear now.
const HUD_KEY = "quarterdeck.hud";
const FOLD_DEFAULTS = { dmg: true, crew: false, wind: false, foes: false }; // true = pinned open
const NUDGE_MS = 6000;
// After a start the wind ramps up and the ship settles; none of that is news.
const QUIET_MS = 4000;
// What counts as "worth a look": drops in condition, a shift of fifteen
// degrees, the wind freshening or dying by four knots or a third. (Not a
// Beaufort step: with gusts on, a wind sitting on a Beaufort boundary would
// cross it every few seconds.)
const NUDGE = { hull: 0.05, rig: 0.05, rudder: 0.10, leak: 0.05, morale: 0.05, windDeg: 20, windKn: 5, windFrac: 0.35 };
// The wind is judged on a running mean, so a gust or a momentary shift does
// not count; only a change that holds for several seconds does.
const WIND_TAU_MS = 6000;

class Fold {
   constructor(panel, id, pinned, onChange) {
      this.el = panel;
      this.id = id;
      this.pinned = pinned;
      this.onChange = onChange;
      this.head = panel.querySelector(".panel-head");
      this.sum = panel.querySelector(".panel-sum");
      // Why the panel opened by itself, shown in the head while it is open.
      this.whyEl = document.createElement("span");
      this.whyEl.className = "panel-why";
      this.head.insertBefore(this.whyEl, this.sum);
      this.why = "";
      this._until = 0;
      this.head.addEventListener("click", () => this.toggle());
      this.apply(0);
   }
   get expanded() { return !this.el.classList.contains("is-collapsed"); }
   toggle() {
      if (this.el.classList.contains("no-fold")) return;
      this.pinned = !this.pinned;
      this._until = 0;
      this.onChange(this);
      this.apply(performance.now());
   }
   setSummary(text) {
      if (this.sum.textContent !== text) this.sum.textContent = text;
   }
   /**
    * Unfold for a while and say why; a pinned panel is open anyway. A sticky
    * reason (renewed every frame while it lasts) does not overwrite a fresh
    * one such as "hull hit".
    */
   nudge(now, why, sticky = false) {
      if (this.pinned) return;
      const fresh = now >= this._until;
      this._until = Math.max(this._until, now + NUDGE_MS);
      if (why && (fresh || !sticky)) this.why = why;
   }
   apply(now) {
      const nudged = !this.pinned && now < this._until;
      this.el.classList.toggle("is-collapsed", !(this.pinned || nudged));
      this.el.classList.toggle("is-nudged", nudged);
      const text = nudged ? this.why : "";
      if (this.whyEl.textContent !== text) this.whyEl.textContent = text;
   }
}

export class UI {
   constructor(rootHud, compassCanvas, menuEl, bodyEl) {
      this.root = rootHud;
      this.compass = compassCanvas;
      this.ctx = compassCanvas.getContext("2d");
      this.menuEl = menuEl;
      this.body = bodyEl;
      this.hudVisible = true;
      this.training = null;
      this._last = {};
      this._prev = {};
      this._quietUntil = 0;
      this._pips = {};
      this.build();
   }

   build() {
      this.root.innerHTML =
          `
           <div class="hud-col" id="hud-left">
              <div class="panel ship" id="shipPanel">
                 <div class="panel-head" data-fold="dmg">
                    <span class="ship-id">
                       <span class="ship-name" id="hudShip">Nordwind</span>
                       <span class="ship-sub"><span class="mode" id="hudMode">FREERIDE</span> · <span id="hudShipRate">Bermuda Sloop</span></span>
                    </span>
                    <span class="panel-sum" id="dmgSum"></span>
                    <span class="chev"></span>
                 </div>
                 <div class="race small" id="hudRace" hidden>
                    <div id="hudLap"></div>
                    <div id="hudTime"></div>
                    <div id="hudCourse"></div>
                    <div id="hudProgress"></div>
                 </div>
                 <div class="panel-body" id="dmgBody">
                    <div class="dmg-body">
                       <svg class="plan" id="dPlan" viewBox="0 0 92 132" aria-hidden="true">
                          <polygon id="pl_PORT_BOW"      points="46,4 46,44 14,44 20,22"/>
                          <polygon id="pl_STBD_BOW"      points="46,4 46,44 78,44 72,22"/>
                          <polygon id="pl_PORT_MID"      points="46,44 46,88 11,88 14,44"/>
                          <polygon id="pl_STBD_MID"      points="46,44 46,88 81,88 78,44"/>
                          <polygon id="pl_PORT_QUARTER"  points="46,88 46,120 18,117 11,88"/>
                          <polygon id="pl_STBD_QUARTER"  points="46,88 46,120 74,117 81,88"/>
                          <path class="plan-line" d="M46,4 L20,22 L14,44 L11,88 L18,117 L46,120
                             L74,117 L81,88 L78,44 L72,22 Z"/>
                          <line class="plan-line thin" x1="46" y1="6" x2="46" y2="119"/>
                          <line class="plan-line thin" x1="14" y1="44" x2="78" y2="44"/>
                          <line class="plan-line thin" x1="11" y1="88" x2="81" y2="88"/>
                          <circle id="pl_mast_fore"   cx="46" cy="30" r="5.5"/>
                          <circle id="pl_mast_main"   cx="46" cy="66" r="6"/>
                          <circle id="pl_mast_mizzen" cx="46" cy="100" r="5"/>
                          <text id="pl_x_fore"   class="plan-x" x="46" y="33.5">✕</text>
                          <text id="pl_x_main"   class="plan-x" x="46" y="69.5">✕</text>
                          <text id="pl_x_mizzen" class="plan-x" x="46" y="103.5">✕</text>
                          <polygon id="pl_rudder" points="42,121 50,121 48,130 44,130"/>
                       </svg>
                       <div class="dmg-bars">
                          <div class="dmg-row"><span class="dl">Hull</span>
                             <div class="dmg-track"><div class="dmg-fill" id="dHull"></div></div>
                             <span class="dv" id="dHullV">100%</span></div>
                          <div class="dmg-row"><span class="dl">Rigging</span>
                             <div class="dmg-track"><div class="dmg-fill" id="dRig"></div></div>
                             <span class="dv" id="dRigV">100%</span></div>
                          <div class="dmg-row"><span class="dl">Rudder</span>
                             <div class="dmg-track"><div class="dmg-fill" id="dRud"></div></div>
                             <span class="dv" id="dRudV">100%</span></div>
                          <div class="dmg-row"><span class="dl">Leak</span>
                             <div class="dmg-track"><div class="dmg-fill flood" id="dFlood"></div></div>
                             <span class="dv" id="dFloodV">0%</span></div>
                       </div>
                    </div>
                    <div class="dmg-foot">
                       <span class="small warn" id="dWarn"></span>
                       <button type="button" class="cmd act" data-cmd="cutWreck" id="cmdCut" hidden><span class="l">Cut away wreck</span><kbd>X</kbd></button>
                    </div>
                 </div>
              </div>
              <div class="panel crew" id="crewPanel" style="display:none">
                 <div class="panel-head" data-fold="crew">
                    <span class="crew-title">CREW <span id="crewHead"></span></span>
                    <span class="panel-sum" id="crewSum"></span>
                    <span class="chev"></span>
                 </div>
                 <div class="panel-body">
                    <div id="crewList"></div>
                    <div class="crew-foot"><span>Morale</span>
                       <div class="dmg-track"><div class="dmg-fill" id="crewMoral"></div></div>
                       <span class="dv" id="crewMoralV">100%</span></div>
                 </div>
              </div>
              <div class="panel gun" id="gunPanel" style="display:none">
                 <div class="gun-title">BATTERY · <span id="gunCal">—</span></div>
                 <div class="ammo-row" id="ammoRow">
                    <button type="button" class="ammo" data-cmd="ammo:ball">Shot</button>
                    <button type="button" class="ammo" data-cmd="ammo:chain">Chain</button>
                    <button type="button" class="ammo" data-cmd="ammo:grape">Grape</button>
                    <kbd class="ammo-key">Z</kbd>
                 </div>
                 <button type="button" class="gun-row" data-cmd="firePort" id="cmdFireP">
                    <span class="gun-side">Port</span><kbd>Q</kbd>
                    <span class="gun-pips" id="gunPipsP"></span>
                    <span class="gun-track"><span class="gun-fill" id="gunFillP"></span></span>
                    <span class="gun-state" id="gunStateP">READY</span>
                 </button>
                 <button type="button" class="gun-row" data-cmd="fireStbd" id="cmdFireS">
                    <span class="gun-side">Stbd</span><kbd>E</kbd>
                    <span class="gun-pips" id="gunPipsS"></span>
                    <span class="gun-track"><span class="gun-fill" id="gunFillS"></span></span>
                    <span class="gun-state" id="gunStateS">READY</span>
                 </button>
              </div>
              <div class="panel foes" id="foePanel" style="display:none">
                 <div class="panel-head" data-fold="foes">
                    <span class="foe-title">ENEMIES</span>
                    <span class="panel-sum" id="foeSum"></span>
                    <span class="chev"></span>
                 </div>
                 <div class="panel-body" id="foeList"></div>
              </div>
           </div>
           <div class="hud-col" id="hud-right">
              <div class="panel windbox" id="windPanel">
                 <div class="panel-head" data-fold="wind">
                    <span class="wind-title">WIND</span>
                    <span class="panel-sum" id="windSum"></span>
                    <span class="chev"></span>
                 </div>
                 <div class="panel-body">
                    <div class="wind-dir"><span id="windDir">0</span>° · <span id="windName">Calm</span></div>
                    <div class="wind-speed"><span id="windSpeed">0.0</span> kn · <span id="beaufort">Bft 0</span></div>
                    <div class="awa">AwA <span id="awaFrom">--</span>° · <span id="awaSpeed">--</span> kn</div>
                    <div class="small" id="seaState">Sea: --</div>
                 </div>
              </div>
              <div class="panel speed">
                 <div class="readbig"><span id="hSpeed">0.0</span><span class="u">kn</span></div>
                 <div class="small" id="vmg">VMG ↑ 0.0 · ↓ 0.0</div>
                 <div class="small" id="twa">TWA -- · <span id="tack">Port</span></div>
              </div>
              <div class="panel conn" id="conn">
                 <div class="pos" id="pos"><span class="dot"></span><span id="posText">Luffing</span></div>
                 <div class="rudder-track"><div class="rudder-ind" id="rudderInd"></div></div>
                 <div class="helm">
                    <button type="button" class="cmd hold" data-hold="KeyA"><span class="l">◄ Port</span><kbd>A</kbd></button>
                    <button type="button" class="cmd hold" data-hold="KeyD"><span class="l">Stbd ►</span><kbd>D</kbd></button>
                 </div>
                 <div class="sails">
                    <button type="button" class="cmd hold" data-hold="KeyW" id="cmdSailIn"><span class="l">Set sail</span><kbd>W</kbd></button>
                    <span class="cmd-state" id="cmdSailState"></span>
                    <button type="button" class="cmd hold" data-hold="KeyS" id="cmdSailOut"><span class="l">Reef</span><kbd>S</kbd></button>
                 </div>
                 <button type="button" class="cmd act" data-cmd="capsizeRight" id="cmdRight" hidden><span class="l">Right the ship</span><kbd>Space</kbd></button>
              </div>
           </div>
           <div class="hud-tabs" id="hud-tabs">
              <button type="button" class="cmd tab" data-cmd="toggleMenu" id="cmdMenu"><span class="l">Menu</span><kbd>M</kbd></button>
              <button type="button" class="cmd tab" data-cmd="cycleCamera" id="cmdView"><span class="l">View</span><kbd>C</kbd></button>
           </div>
           <div class="msgwrap" id="msgwrap"></div>
           <div class="train panel" id="train" style="display:none">
              <div class="train-title" id="trainTitle">Training</div>
              <div class="train-desc" id="trainDesc"></div>
              <div class="small" id="trainHint">Goal</div>
              <div class="train-bar"><div class="train-fill" id="trainFill"></div></div>
           </div>
           `;
      const q = (sel) => this.root.querySelector(sel);
      this._refs = {
         mode: q("#hudMode"),
         ship: q("#hudShip"),
         shipRate: q("#hudShipRate"),
         gunPanel: q("#gunPanel"),
         gunCal: q("#gunCal"),
         gunFillP: q("#gunFillP"),
         gunFillS: q("#gunFillS"),
         gunStateP: q("#gunStateP"),
         gunStateS: q("#gunStateS"),
         gunPipsP: q("#gunPipsP"),
         gunPipsS: q("#gunPipsS"),
         ammo: Array.from(this.root.querySelectorAll("#ammoRow button[data-cmd]")),
         cmdFireP: q("#cmdFireP"),
         cmdFireS: q("#cmdFireS"),
         crewPanel: q("#crewPanel"),
         crewHead: q("#crewHead"),
         crewList: q("#crewList"),
         crewMoral: q("#crewMoral"),
         crewMoralV: q("#crewMoralV"),
         shipPanel: q("#shipPanel"),
         dmgBody: q("#dmgBody"),
         race: q("#hudRace"),
         dHull: q("#dHull"), dHullV: q("#dHullV"),
         dRig: q("#dRig"), dRigV: q("#dRigV"),
         dRud: q("#dRud"), dRudV: q("#dRudV"),
         dFlood: q("#dFlood"), dFloodV: q("#dFloodV"),
         plan: {
            sections: {},
            masts: {},
            xs: {},
            rudder: q("#pl_rudder"),
         },
         dWarn: q("#dWarn"),
         cmdCut: q("#cmdCut"),
         foePanel: q("#foePanel"),
         foeList: q("#foeList"),
         lap: q("#hudLap"),
         time: q("#hudTime"),
         course: q("#hudCourse"),
         progress: q("#hudProgress"),
         windDir: q("#windDir"),
         windName: q("#windName"),
         windSpeed: q("#windSpeed"),
         beaufort: q("#beaufort"),
         awaFrom: q("#awaFrom"),
         awaSpeed: q("#awaSpeed"),
         seaState: q("#seaState"),
         hSpeed: q("#hSpeed"),
         vmg: q("#vmg"),
         twa: q("#twa"),
         tack: q("#tack"),
         rudderInd: q("#rudderInd"),
         posText: q("#posText"),
         posDot: q("#pos .dot"),
         cmdSailIn: q("#cmdSailIn .l"),
         cmdSailOut: q("#cmdSailOut .l"),
         cmdSailState: q("#cmdSailState"),
         cmdRight: q("#cmdRight"),
         msgwrap: q("#msgwrap"),
         train: q("#train"),
         trainTitle: q("#trainTitle"),
         trainDesc: q("#trainDesc"),
         trainHint: q("#trainHint"),
         trainFill: q("#trainFill"),
      };
      this._bindCommands();
      for (const side of ["PORT", "STBD"]) {
         for (const sec of ["BOW", "MID", "QUARTER"]) {
            const k = side + "_" + sec;
            this._refs.plan.sections[k] = q("#pl_" + k);
         }
      }
      for (const m of ["fore", "main", "mizzen"]) {
         this._refs.plan.masts[m] = q("#pl_mast_" + m);
         this._refs.plan.xs[m] = q("#pl_x_" + m);
      }

      // Folding panels; what the player pinned open or shut is remembered.
      this._prefs = readJSON(safeStorage(), HUD_KEY, FOLD_DEFAULTS);
      this.folds = {};
      for (const id of Object.keys(FOLD_DEFAULTS)) {
         const panel = q(`[data-fold="${id}"]`).closest(".panel");
         this.folds[id] = new Fold(panel, id, !!this._prefs[id], (f) => {
            this._prefs[f.id] = f.pinned;
            writeJSON(safeStorage(), HUD_KEY, this._prefs);
         });
      }
   }

   /**
    * Every command the captain can give by mouse lives inside the readout it
    * concerns: the battery rows fire, the load chips load, the helm and sail
    * buttons under the point of sail are held. Buttons with data-cmd push
    * the same queue event the key would; buttons with data-hold act like
    * holding the key down. The game plugs in onCommand(name) and
    * onHold(code, down).
    */
   _bindCommands() {
      this.onCommand = null;
      this.onHold = null;
      for (const b of this.root.querySelectorAll("button[data-cmd]")) {
         b.addEventListener("click", () => {
            b.blur();
            if (this.onCommand) this.onCommand(b.dataset.cmd);
         });
      }
      for (const b of this.root.querySelectorAll("button[data-hold]")) {
         const code = b.dataset.hold;
         const set = (down) => {
            b.classList.toggle("held", down);
            if (this.onHold) this.onHold(code, down);
         };
         b.addEventListener("pointerdown", (e) => { e.preventDefault(); set(true); });
         for (const ev of ["pointerup", "pointercancel", "pointerleave"]) b.addEventListener(ev, () => set(false));
         b.addEventListener("click", () => b.blur());
      }
   }

   update(s) {
      if (!this.hudVisible) {
         this.root.style.display = "none";
         this.compass.style.display = "none";
         return;
      }
      this.root.style.display = "block";
      this.compass.style.display = "block";
      const now = performance.now();
      const R = this._refs;
      R.mode.textContent = s.mode.toUpperCase();

      if (s.vessel) {
         R.ship.textContent = vesselLabel(s.vessel);
         R.shipRate.textContent = s.vessel.rate;
      }
      this._attention(s, now);
      this._updateGuns(s);
      this._updateDamage(s);
      this._updateCrew(s);
      this._updateFoes(s);

      R.race.hidden = !s.course;
      if (s.course) {
         R.lap.textContent = "Lap " + s.course.lap;
         R.time.textContent =
            s.course.time.toFixed(1) + "s · Best: " +
            (s.course.best ? s.course.best.toFixed(1) + "s" : "--");
         R.course.textContent =
            "Leg " +
            (s.course.leg + 1) +
            " · " +
            (s.course.legName || "Mark buoy") +
            " · " +
            Math.round(s.course.dist) +
            " m · Brg " +
            Math.round(s.course.bearing) +
            "°";
         R.progress.textContent = Math.round(s.course.progress * 100) + "%";
      }

      this._updateWind(s);

      const sp = s.boat.speed.toFixed(1);
      R.hSpeed.textContent = sp;
      R.hSpeed.parentElement.classList.toggle("luff", !!s.boat.luffing);
      R.vmg.textContent =
         "VMG ↑ " + s.boat.vmgUp.toFixed(1) + "  ↓ " + s.boat.vmgDown.toFixed(1);
      R.twa.textContent = "TWA " + Math.round(s.boat.twa) + "° · " + (s.boat.tack === "STBD" ? "Stbd" : "Port");

      this._updateConn(s);

      if (this.training) {
         R.train.style.display = "block";
         R.trainTitle.textContent = this.training.title || "";
         R.trainDesc.textContent = this.training.desc || "";
         R.trainHint.textContent =
            "Progress: " + Math.round((this.training.progress || 0) * 100) + "%";
         R.trainFill.style.width = Math.round((this.training.progress || 0) * 100) + "%";
         R.trainFill.classList.toggle("is-done", !!this.training.done);
      } else {
         R.train.style.display = "none";
      }

      if (s.message && s.message !== this._last.message) {
         this._showMessage(s.message);
      }
      this._last.message = s.message;
      for (const f of Object.values(this.folds)) f.apply(now);
      this.drawCompass(s);
   }

   /** Forget the last frame: a new mode or ship starts with a clean slate, not a "change". */
   resetAttention() {
      this._prev = {};
      this._windEma = null;
      this._prevNow = 0;
      this._quietUntil = performance.now() + QUIET_MS;
      for (const f of Object.values(this.folds)) f._until = 0;
   }

   /**
    * Decide which folded panels deserve a look this frame, by comparing the
    * state against a compact snapshot of the last one. Only changes for the
    * worse unfold a panel: nobody needs to be told that nothing happened.
    */
   _attention(s, now) {
      const P = this._prev, d = s.damage, c = s.crew;
      const next = {};
      // The snapshot is kept up to date even while quiet, so the first real
      // change after a start is measured against the settled state.
      const quiet = now < this._quietUntil;
      const F = {};
      for (const k in this.folds) F[k] = { nudge: (t, why, sticky) => { if (!quiet) this.folds[k].nudge(t, why, sticky); } };
      if (d && d.masts) {
         const rig = (d.rigging + d.sails) / 2;
         const gone = ["fore", "main", "mizzen"].filter((m) => d.masts[m] && d.masts[m].state === "gone").length;
         const afire = d.afire > 0.05;
         next.hull = { hull: d.hull, rig, rudder: d.rudder, leak: d.flooding, gone, afire };
         const p = P.hull;
         if (p) {
            const why = [];
            if (p.hull - d.hull >= NUDGE.hull) why.push("hull hit");
            if (p.rig - rig >= NUDGE.rig) why.push("rigging hit");
            if (p.rudder - d.rudder >= NUDGE.rudder) why.push("rudder hit");
            if (d.flooding - p.leak >= NUDGE.leak) why.push("taking water");
            if (gone > p.gone) why.push("mast gone");
            if (afire && !p.afire) why.push("fire");
            if (why.length) F.dmg.nudge(now, why.join(" · "));
         }
         // A wreck alongside or a shoaling bottom stays worth a look as long as it lasts.
         if (s.wreck) F.dmg.nudge(now, "wreck alongside", true);
         else if (s.depth !== null && s.depth !== undefined && s.depth < 12) F.dmg.nudge(now, "shallow water", true);
      }
      if (c) {
         next.crew = { fit: c.fit, morale: c.morale };
         if (P.crew) {
            if (c.fit < P.crew.fit) F.crew.nudge(now, "casualties");
            else if (P.crew.morale - c.morale >= NUDGE.morale) F.crew.nudge(now, "morale falling");
         }
      }
      if (s.wind) {
         // Running mean of the wind (as a vector, so north does not wrap),
         // compared against a reference that moves only when a nudge fires:
         // gusts cancel out, a slow veer still adds up to a shift.
         const dt = this._prevNow ? now - this._prevNow : 0;
         const a = dt > 0 ? 1 - Math.exp(-dt / WIND_TAU_MS) : 1;
         const rad = s.wind.dir * Math.PI / 180;
         const e = this._windEma || (this._windEma = { x: Math.sin(rad), y: Math.cos(rad), speed: s.wind.speed });
         e.x += (Math.sin(rad) - e.x) * a;
         e.y += (Math.cos(rad) - e.y) * a;
         e.speed += (s.wind.speed - e.speed) * a;
         const dir = normDeg(Math.atan2(e.x, e.y) * 180 / Math.PI);
         const ref = P.wind || { dir, speed: e.speed };
         const dd = ((dir - ref.dir) % 360 + 540) % 360 - 180;
         const dv = e.speed - ref.speed;
         let why = null;
         if (Math.abs(dd) >= NUDGE.windDeg) why = (dd > 0 ? "veered " : "backed ") + Math.round(Math.abs(dd)) + "°";
         else if (Math.abs(dv) >= Math.max(NUDGE.windKn, NUDGE.windFrac * ref.speed)) {
            why = (dv > 0 ? "freshening " : "dying ") + Math.round(ref.speed) + " → " + Math.round(e.speed) + " kn";
         }
         if (why) {
            if (P.wind) F.wind.nudge(now, why);
            next.wind = { dir, speed: e.speed };
         } else next.wind = ref;
      }
      this._prevNow = now;
      if (s.enemies) {
         const seen = {};
         for (const e of s.enemies) seen[e.name] = e.sunk ? 2 : e.struck ? 1 : 0;
         if (P.foes) {
            for (const k in seen) {
               if (!(k in P.foes)) F.foes.nudge(now, "new sail: " + k);
               else if (seen[k] > P.foes[k]) F.foes.nudge(now, k + (seen[k] === 2 ? " sunk" : " struck"));
            }
         }
         next.foes = seen;
      }
      this._prev = next;
   }

   _updateWind(s) {
      const R = this._refs;
      const dir = Math.round(s.wind.dir % 360);
      R.windDir.textContent = dir;
      R.windName.textContent = s.wind.name;
      R.windSpeed.textContent = s.wind.speed.toFixed(1);
      R.beaufort.textContent = "Bft " + s.wind.bft;
      R.awaFrom.textContent = s.awa.from ? Math.round(s.awa.from) : "--";
      R.awaSpeed.textContent = s.awa.speed ? s.awa.speed.toFixed(1) : "--";
      if (s.sea) R.seaState.textContent = "Sea: " + s.sea.name + " · " + s.sea.hs.toFixed(1) + " m";
      this.folds.wind.setSummary(dir + "° " + s.wind.name + " · " + Math.round(s.wind.speed) + " kn");
   }

   /** The conn: point of sail, helm and canvas, and the one order a capsize allows. */
   _updateConn(s) {
      const R = this._refs;
      const rr = Math.max(-1, Math.min(1, s.boat.rudder || 0));
      R.rudderInd.style.left = ((rr + 1) / 2 * 100).toFixed(0) + "%";
      R.posText.textContent = s.pos;
      R.posDot.style.background = pointColor(s.boat.twa, s.boat.luffing, s.noGo || 32);
      const square = !!(s.vessel && s.vessel.rig === "square");
      R.cmdSailIn.textContent = square ? "Set sail" : "Trim in";
      R.cmdSailOut.textContent = square ? "Reef" : "Trim out";
      R.cmdSailState.textContent = square && typeof s.sailSet === "number"
         ? Math.round(s.sailSet * 100) + "% set" : "";
      R.cmdRight.hidden = !(s.boat && s.boat.capsize);
   }

   _updateGuns(s) {
      const R = this._refs;
      if (!s.guns || !s.guns.guns) {
         R.gunPanel.style.display = "none";
         return;
      }
      R.gunPanel.style.display = "block";
      // "18-pounder / 9-pounder" is a mouthful for a panel title: 18-pdr / 9-pdr.
      const cal = (s.vessel && s.vessel.guns && s.vessel.guns.decks
         .map((d) => String(d.calibre).replace(/-pounders?/i, "-pdr")).join(" / ")) || "";
      R.gunCal.textContent = cal;
      const ready = s.guns.gunsReady || { PORT: s.guns.guns, STBD: s.guns.guns };
      // One pip per gun of the side, one row per deck; a knocked-out gun is
      // a hollow pip, taken from the lower deck first. The rows are rebuilt
      // only when the numbers change.
      let decks = (s.vessel && s.vessel.guns && s.vessel.guns.decks || []).map((d) => d.count | 0);
      if (decks.reduce((a, b) => a + b, 0) !== s.guns.guns) decks = [s.guns.guns];
      const pips = (el, key, k) => {
         const sig = decks.join(",") + "/" + k;
         if (this._pips[key] === sig) return;
         this._pips[key] = sig;
         let left = k;
         el.innerHTML = decks.map((n) => {
            const on = Math.min(n, left);
            left -= on;
            return `<span class="deck">` + Array.from({ length: n }, (_, i) => `<span class="pip${i < on ? "" : " out"}"></span>`).join("") + `</span>`;
         }).join("");
      };
      pips(R.gunPipsP, "P", ready.PORT);
      pips(R.gunPipsS, "S", ready.STBD);
      const set = (btn, fill, state, g, nReady) => {
         const pct = Math.round(g.progress * 100);
         // A side without manned guns is not "ready", it is finished. The
         // colours live in the stylesheet (is-out / is-ready / loading).
         const out = nReady <= 0;
         fill.className = "gun-fill" + (out ? " is-out" : g.ready ? " is-ready" : "");
         state.className = "gun-state" + (out ? " is-out" : g.ready ? " is-ready" : "");
         const ok = !out && !!g.ready;
         btn.disabled = !ok;
         btn.classList.toggle("ready", ok);
         if (out) {
            fill.style.width = "100%";
            state.textContent = "KNOCKED OUT";
            return;
         }
         fill.style.width = pct + "%";
         state.textContent = g.ready ? "READY" : "LOADING " + pct + "%";
      };
      set(R.cmdFireP, R.gunFillP, R.gunStateP, s.guns.PORT, ready.PORT);
      set(R.cmdFireS, R.gunFillS, R.gunStateS, s.guns.STBD, ready.STBD);
      const cur = s.guns.ammo ? s.guns.ammo.id : "ball";
      for (const b of R.ammo) b.classList.toggle("on", b.dataset.cmd === "ammo:" + cur);
   }

   showMessage(text) {
      this._showMessage(text);
   }

   _updateDamage(s) {
      const R = this._refs;
      const d = s.damage;
      const has = !!(d && d.masts && !(s.vessel && s.vessel.rig !== "square"));
      R.shipPanel.classList.toggle("no-fold", !has);
      R.dmgBody.hidden = !has;
      if (!has) {
         this.folds.dmg.setSummary("");
         return;
      }
      const bar = (fill, val, v, invert = false) => {
         const pct = Math.round(val * 100);
         fill.style.width = pct + "%";
         const good = invert ? 1 - val : val;
         setLevel(fill, good);
         v.textContent = pct + "%";
      };
      bar(R.dHull, d.hull, R.dHullV);
      bar(R.dRig, (d.rigging + d.sails) / 2, R.dRigV);
      bar(R.dRud, d.rudder, R.dRudV);
      bar(R.dFlood, d.flooding, R.dFloodV, true);

      // Hull plan: each of the six sections individually. An average across
      // the whole hull would hide exactly what matters - namely WHERE she was
      // hit. A shot-through broadside is something different from even wear.
      if (d.sections) {
         for (const k in R.plan.sections) {
            const el = R.plan.sections[k];
            if (el) el.style.fill = damageColor(d.sections[k]);
         }
      }
      for (const m of ["fore", "main", "mizzen"]) {
         const st = d.masts[m];
         const el = R.plan.masts[m];
         const x = R.plan.xs[m];
         if (!el) continue;
         const gone = st.state === "gone";
         el.style.fill = gone ? "var(--plan-gone)" : damageColor(st.integrity);
         el.classList.toggle("is-gone", gone);
         el.classList.toggle("is-hurt", !gone && st.state === "wounded");
         if (x) x.style.display = gone ? "block" : "none";
      }
      if (R.plan.rudder) R.plan.rudder.style.fill = damageColor(d.rudder);

      const warn = [];
      if (d.afire > 0.05) warn.push("FIRE ON BOARD");
      if (s.wreck) warn.push("Wreck in tow");
      if (d.flooding > 0.25) warn.push("Water in the ship");
      if (s.depth !== null && s.depth !== undefined && s.depth < 12) {
         warn.push("SHALLOW WATER " + s.depth.toFixed(1) + " m");
      }
      R.dWarn.textContent = warn.join(" · ");
      R.dWarn.style.display = warn.length ? "" : "none";
      R.cmdCut.hidden = !s.wreck;

      this.folds.dmg.setSummary((d.afire > 0.05 ? "FIRE · " : "")
         + "Hull " + Math.round(d.hull * 100) + "% · Leak " + Math.round(d.flooding * 100) + "%");
   }

   _updateCrew(s) {
      const R = this._refs;
      const c = s.crew;
      if (!c || c.total < 8) { R.crewPanel.style.display = "none"; return; }
      R.crewPanel.style.display = "block";
      R.crewHead.textContent = c.fit + " / " + c.total
         + (c.wounded ? "  ✚" + c.wounded : "") + (c.dead ? "  †" + c.dead : "");
      R.crewList.innerHTML = c.roles.map((r) => {
         const pct = Math.round(r.frac * 100);
         const cls = r.frac > 0.7 ? "" : r.frac > 0.4 ? " is-warn" : " is-bad";
         return `<div class="crew-row">
            <span class="cl">${r.short}</span>
            <div class="crew-track"><div class="crew-fill${cls}" style="width:${pct}%"></div></div>
            <span class="cv">${r.fit}</span>
         </div>`;
      }).join("");
      const m = c.morale;
      R.crewMoral.style.width = Math.round(m * 100) + "%";
      setLevel(R.crewMoral, m);
      R.crewMoralV.textContent = Math.round(m * 100) + "%";
      this.folds.crew.setSummary("Morale " + Math.round(m * 100) + "%");
   }

   _updateFoes(s) {
      const R = this._refs;
      if (!s.enemies || !s.enemies.length) {
         R.foePanel.style.display = "none";
         return;
      }
      R.foePanel.style.display = "block";
      R.foeList.innerHTML = s.enemies.map((e) => {
         const st = e.sunk ? "sunk" : e.struck ? "struck" : Math.round(e.dist) + " m";
         const cls = e.sunk ? "out" : e.struck ? "struck" : "";
         const bar = Math.max(0, Math.round(e.hull * 100));
         return `<div class="foe ${cls}">
            <div class="foe-name">${e.name}<span class="foe-dist">${st}</span></div>
            <div class="foe-sub">${e.rate}</div>
            <div class="foe-bar"><div class="foe-fill" style="width:${bar}%"></div></div>
            <div class="foe-sub">Brg ${Math.round(e.bearing)}° · Masts ${e.masts}/3</div>
         </div>`;
      }).join("");
      const afloat = s.enemies.filter((e) => !e.sunk && !e.struck);
      let sum;
      if (!afloat.length) sum = s.enemies.every((e) => e.sunk) ? "all sunk" : "all struck";
      else {
         const nearest = Math.min(...afloat.map((e) => e.dist));
         sum = afloat.length + (afloat.length === 1 ? " ship" : " ships") + " · nearest " + Math.round(nearest) + " m";
      }
      this.folds.foes.setSummary(sum);
   }

   _showMessage(text) {
      const wrap = this._refs.msgwrap;
      const m = document.createElement("div");
      m.className = "msg";
      m.textContent = text;
      wrap.appendChild(m);
      const t0 = performance.now();
      const tick = () => {
         const dt = (performance.now() - t0) / 1000;
         if (dt > 3.5) {
            m.remove();
            return;
         }
         m.style.opacity = String(Math.max(0, 1 - (dt - 2.5)));
         requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
   }

   /**
    * The compass rose. Colours and lettering come from the style's HUD
    * palette; the aquatint skin draws an engraved 16-point rose with
    * lozenge points, the plain skin the original ticked disc.
    */
   drawCompass(s) {
      const ctx = this.ctx;
      const P = palette().hud;
      const size = this.compass.width;
      const cx = size / 2;
      const cy = size / 2;
      const RR = size / 2 - 4;
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate((-s.boat.heading * Math.PI) / 180);

      ctx.beginPath();
      ctx.arc(0, 0, RR, 0, Math.PI * 2);
      ctx.fillStyle = P.rose;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.rim;
      ctx.stroke();

      if (P.engraved) {
         // inner rule and 10-degree graduation, as on a printed rose
         ctx.beginPath();
         ctx.arc(0, 0, RR - 7, 0, Math.PI * 2);
         ctx.lineWidth = 0.8;
         ctx.strokeStyle = P.tick;
         ctx.stroke();
         for (let a = 0; a < 360; a += 10) {
            const rad = (a * Math.PI) / 180;
            const len = a % 30 === 0 ? 7 : 3.5;
            ctx.beginPath();
            ctx.moveTo(Math.sin(rad) * RR, -Math.cos(rad) * RR);
            ctx.lineTo(Math.sin(rad) * (RR - len), -Math.cos(rad) * (RR - len));
            ctx.lineWidth = a % 90 === 0 ? 1.4 : 0.8;
            ctx.strokeStyle = P.tick;
            ctx.stroke();
         }
         // sixteen lozenge points: long for the cardinals, shorter for the
         // half and quarter winds, each split light/dark down the middle
         const lozenge = (ang, len, half, dark, light) => {
            ctx.save();
            ctx.rotate(ang);
            ctx.beginPath();
            ctx.moveTo(0, -len); ctx.lineTo(half, -len * 0.28); ctx.lineTo(0, 0); ctx.closePath();
            ctx.fillStyle = dark; ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, -len); ctx.lineTo(-half, -len * 0.28); ctx.lineTo(0, 0); ctx.closePath();
            ctx.fillStyle = light; ctx.fill();
            ctx.beginPath();
            ctx.moveTo(0, -len); ctx.lineTo(half, -len * 0.28); ctx.lineTo(0, 0);
            ctx.lineTo(-half, -len * 0.28); ctx.closePath();
            ctx.lineWidth = 0.6; ctx.strokeStyle = P.letter; ctx.stroke();
            ctx.restore();
         };
         for (let i = 0; i < 16; i++) {
            const ang = (i * Math.PI) / 8;
            if (i % 4 === 0) continue;                       // cardinals last, on top
            if (i % 2 === 0) lozenge(ang, RR - 30, 3.2, P.tick, "rgba(255,255,255,0.35)");
            else lozenge(ang, RR - 42, 2.4, P.tick, "rgba(255,255,255,0.3)");
         }
         for (let i = 0; i < 4; i++) {
            lozenge((i * Math.PI) / 2, RR - 20, 4.5, i === 0 ? P.north : P.letter, "rgba(255,255,255,0.45)");
         }
      } else {
         for (let a = 0; a < 360; a += 30) {
            const rad = (a * Math.PI) / 180;
            const x1 = Math.sin(rad) * RR;
            const z1 = Math.cos(rad) * RR;
            const x2 = Math.sin(rad) * (RR - 8);
            const z2 = Math.cos(rad) * (RR - 8);
            ctx.beginPath();
            ctx.moveTo(x1, -z1);
            ctx.lineTo(x2, -z2);
            ctx.lineWidth = a % 90 === 0 ? 2 : 1;
            ctx.strokeStyle = a % 90 === 0 ? "rgba(0,0,0,0)" : P.tick;
            ctx.stroke();
         }
      }

      const dirs = [
         ["N", 0],
         ["E", 90],
         ["S", 180],
         ["W", 270],
      ];
      for (const [lbl, ang] of dirs) {
         const rad = (ang * Math.PI) / 180;
         const r = P.engraved ? RR - 13 : RR - 22;
         const x = Math.sin(rad) * r;
         const z = Math.cos(rad) * r;
         ctx.font = (lbl === "N" && !P.engraved ? "bold 15px " : P.engraved ? "13px " : "12px ") + P.font;
         ctx.fillStyle = lbl === "N" ? P.north : P.letter;
         ctx.textAlign = "center";
         ctx.textBaseline = "middle";
         if (P.engraved) {
            // letters stay upright on the ring, on a small paper patch
            ctx.save();
            ctx.translate(x, -z + 1);
            ctx.rotate((s.boat.heading * Math.PI) / 180);
            ctx.fillStyle = P.rose;
            ctx.fillRect(-6, -7, 12, 14);
            ctx.fillStyle = lbl === "N" ? P.north : P.letter;
            ctx.fillText(lbl, 0, 0);
            ctx.restore();
         } else {
            ctx.fillText(lbl, x, -z + 1);
         }
      }
      ctx.restore();

      ctx.save();
      ctx.translate(cx, cy);
      let relWind = normDeg(s.wind.dir - s.boat.heading);
      if (relWind > 180) relWind -= 360;
      let a = (relWind * Math.PI) / 180;
      let x = -Math.sin(a) * (RR - 4);
      let y = Math.cos(a) * (RR - 4);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(x, -y);
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.trueWind;
      ctx.stroke();
      ctx.fillStyle = P.trueWind;
      ctx.beginPath();
      ctx.arc(x, -y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(6, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-6, 10);
      ctx.closePath();
      ctx.fillStyle = s.boat.luffing ? P.shipLuff : P.ship;
      ctx.fill();
      if (P.engraved) { ctx.lineWidth = 0.8; ctx.strokeStyle = P.letter; ctx.stroke(); }

      if (s.awa.from) {
         let ra = normDeg(s.awa.from - s.boat.heading);
         if (ra > 180) ra -= 360;
         a = (ra * Math.PI) / 180;
         x = -Math.sin(a) * (RR - 16);
         y = Math.cos(a) * (RR - 16);
         ctx.beginPath();
         ctx.moveTo(0, 0);
         ctx.lineTo(x, -y);
         ctx.lineWidth = 2;
         ctx.strokeStyle = P.apparent;
         ctx.stroke();
      }
      ctx.restore();
   }

   setTraining(tr) {
      this.training = tr || null;
   }

   openMenu(opts) {
      const m = {
         mode: opts.mode,
         vesselId: opts.vesselId || "yacht",
         windDir: opts.windDir,
         windSpeed: opts.windSpeed,
         gusts: opts.gusts,
         scenarioId: opts.scenarioId || "single",
         scenarios: opts.scenarios || [],
         onScenarioChange: opts.onScenarioChange || (() => {}),
         randomStart: opts.randomStart !== false,
         onRandomChange: opts.onRandomChange || (() => {}),
         onWindChange: opts.onWindChange,
         onVesselChange: opts.onVesselChange || (() => {}),
         onStart: opts.onStart,
         onHelp: opts.onHelp,
         mp: { url: "", name: "", roomId: "", roomName: "", mode: "battle", connected: false, ...(opts.multiplayer || {}) },
         onJoin: opts.onJoin || (() => {}),
         onListRooms: opts.onListRooms || null,
         onResume: opts.onResume || null,
      };
      this._roomListToken = 0;
      this.renderMenu(m);
   }

   /** Fetch and render the lobby list; a newer request supersedes an older one. */
   refreshRooms(m) {
      const box = this.menuEl.querySelector("#roomList");
      if (!box || !m.onListRooms) return;
      const token = ++this._roomListToken;
      box.innerHTML = `<div class="room-empty">Looking for rooms on ${escapeAttr(m.mp.url)} …</div>`;
      Promise.resolve()
         .then(() => m.onListRooms(m.mp.url))
         .then((rooms) => {
            if (token !== this._roomListToken) return;
            this._renderRoomList(m, rooms || []);
         })
         .catch((e) => {
            if (token !== this._roomListToken) return;
            box.innerHTML = `<div class="room-empty">No server at ${escapeAttr(m.mp.url)} (${escapeAttr(e && e.message ? e.message : e)})</div>`;
         });
   }

   _renderRoomList(m, rooms) {
      const box = this.menuEl.querySelector("#roomList");
      if (!box) return;
      if (!rooms.length) {
         box.innerHTML = `<div class="room-empty">No open room — Join creates one.</div>`;
         return;
      }
      box.innerHTML = rooms.map((r) => {
         const md = r.metadata || {};
         const kind = md.mode === "regatta" ? "Regatta" : "Battle";
         const enemies = md.mode === "regatta" ? "" : (md.enemies && md.enemies.length ? md.enemies.length + " AI" : "no AI") + " · ";
         const wind = Number.isFinite(md.windBaseSpeed) ? Math.round(md.windBaseSpeed) + " kn" : "";
         const full = r.clients >= r.maxClients;
         return `<div class="room-row${full ? " full" : ""}" data-room="${escapeAttr(r.roomId)}">
               <span class="room-name"><span class="room-title">${escapeAttr(md.name || r.roomId)}</span> <span class="room-kind">${kind}</span></span>
               <span class="room-info">${r.clients}/${r.maxClients} players · ${enemies}${wind}</span>
               <button class="room-join" ${full ? "disabled" : ""}>Join</button>
            </div>`;
      }).join("");
      box.querySelectorAll(".room-row").forEach((row) => {
         const btn = row.querySelector(".room-join");
         if (btn) btn.onclick = () => this._join(m, row.dataset.room);
      });
   }

   _join(m, roomId) {
      const sc = m.scenarios.find((s) => s.id === m.scenarioId);
      const enemies = sc ? (sc.forces[m.vesselId] || []) : [];
      m.onJoin({
         url: m.mp.url,
         name: m.mp.name,
         roomId: roomId || m.mp.roomId || undefined,
         mode: m.mp.mode || "battle",
         vesselId: m.vesselId,
         create: {
            enemies,
            roomName: m.mp.roomName || undefined,
            windBaseDir: m.windDir,
            windBaseSpeed: m.windSpeed,
            windVariability: m.gusts ? 1 : 0,
         },
      });
   }

   renderMenu(m) {
      const modes = [
         ["Freeride", "Open sea, play with the wind"],
         ["Battle", "Sea battle against the French"],
         ["Regatta", "Lap course with turning buoys"],
         ["Training", "Sail-handling exercises"],
         ["Multiplayer", "Join a battle on a server"],
      ];
      const isMp = m.mode === "Multiplayer";
      const modeHtml = modes
         .map(
            ([k, d]) =>
               `<button class="mode-btn${m.mode === k ? " active" : ""}" data-mode="${k}">
                  <div class="mb-title">${k}</div>
                  <div class="mb-desc">${d}</div>
               </button>`
            )
         .join("");
      const shipHtml = VESSELS.map((v) => {
         const guns = v.guns
            ? `<span class="sb-g">${gunCount(v)} guns · ${broadsideWeight(v)} lb broadside</span>`
            : `<span class="sb-g">unarmed</span>`;
         return `<button class="ship-btn${m.vesselId === v.id ? " active" : ""}" data-vessel="${v.id}">
                  <div class="sb-head">
                     <span class="sb-name">${vesselLabel(v)}</span>
                     <span class="sb-era">${v.era}</span>
                  </div>
                  <div class="sb-rate">${v.rate}</div>
                  <div class="sb-desc">${v.desc}</div>
                  <div class="sb-stats">
                     <span>${v.hull.loa.toFixed(0)} m LOA</span>
                     <span>${v.crew} crew</span>
                     <span>Close-hauled ${v.sail.noGo}°</span>
                  </div>
                  <div class="sb-foot">${guns}</div>
               </button>`;
      }).join("");
      const selected = VESSELS.find((v) => v.id === m.vesselId) || VESSELS[0];

      // Only show Battle when there is actually combat
      let scenarioHtml = "";
      if ((m.mode === "Battle" || (isMp && (m.mp.mode || "battle") !== "regatta")) && m.scenarios.length) {
         const unarmed = !selected.guns;
         const cards = m.scenarios.map((sc) => {
            const force = (sc.forces[m.vesselId] || []);
            const label = unarmed || !force.length
               ? "no opponent for this ship"
               : force.length + (force.length === 1 ? " opponent" : " opponents");
            return `<button class="sc-btn${m.scenarioId === sc.id ? " active" : ""}${unarmed ? " off" : ""}" data-sc="${sc.id}">
                  <div class="sc-title">${sc.title}</div>
                  <div class="sc-desc">${sc.desc}</div>
                  <div class="sc-force">${label}</div>
               </button>`;
         }).join("");
         scenarioHtml = `<div class="sec-label">${isMp ? "AI enemies (when creating a room)" : "Battle"}</div>
            <div class="sc-grid">${cards}</div>`
            + (unarmed && !isMp ? `<div class="sc-hint">${selected.name} has no guns — choose a warship.</div>` : "")
            + (isMp ? "" : `<label class="ctrl toggle">
                  <input type="checkbox" id="menuRandom" ${m.randomStart ? "checked" : ""} />
                  <span>Random wind and enemy bearing each battle (off: classic start dead to windward)</span>
               </label>`);
      }

      const mpHtml = !isMp ? "" : `
            <div class="sec-label">Server</div>
            <div class="menu-controls">
               <label class="ctrl">
                  <span>Server</span>
                  <input type="text" id="mpUrl" value="${escapeAttr(m.mp.url)}" spellcheck="false" />
               </label>
               <label class="ctrl">
                  <span>Your name</span>
                  <input type="text" id="mpName" value="${escapeAttr(m.mp.name)}" maxlength="24" />
               </label>
               <label class="ctrl">
                  <span>Room name (for the room you create)</span>
                  <input type="text" id="mpRoomName" value="${escapeAttr(m.mp.roomName)}" maxlength="32" />
               </label>
               <label class="ctrl">
                  <span>Room id (paste to join a specific room)</span>
                  <input type="text" id="mpRoom" value="${escapeAttr(m.mp.roomId)}" spellcheck="false" />
               </label>
            </div>
            <div class="sec-label">Room type</div>
            <div class="mode-grid m3">
               ${[["battle", "Battle", "2–8 players, AI enemies optional"],
                  ["regatta", "Regatta", "race the windward-leeward course"],
                  ["practice", "Practice", "alone against the AI, private room"]]
                  .map(([id, title, desc]) => `<button class="mode-btn${(m.mp.mode || "battle") === id ? " active" : ""}" data-mpmode="${id}">
                     <div class="mb-title">${title}</div><div class="mb-desc">${desc}</div></button>`).join("")}
            </div>
            <div class="sec-label">Open rooms <button class="room-refresh" id="roomRefresh">Refresh</button></div>
            <div class="room-list" id="roomList"></div>
            <div class="sc-hint">Wind and enemies below apply to a room you create.</div>`;

      const mpMode = m.mp.mode || "battle";
      const startLabel = isMp
         ? (mpMode === "practice" ? "Practice · " : m.mp.roomId ? "Join room · "
            : mpMode === "regatta" ? "Join or create regatta · " : "Join or create battle · ") + vesselLabel(selected)
         : `${m.mode} · ${vesselLabel(selected)}`;
      const resumeHtml = m.mp.connected && m.onResume
         ? `<button id="menuResume">Back to the battle</button>`
         : "";

      this.menuEl.innerHTML =
          `<div class="menu-card">
            <h1>Quarterdeck</h1>
            <p class="subm">Close-hauled · Luffing · Beam Reach — semi-realistic physics</p>
            <div class="sec-label">Ship</div>
            <div class="ship-grid">${shipHtml}</div>
            <div class="sec-label">Game Mode</div>
            <div class="mode-grid m4">${modeHtml}</div>
            ${mpHtml}
            ${scenarioHtml}
            <div class="menu-controls">
               <label class="ctrl">
                  <span>Wind direction</span>
                  <input type="range" id="menuDir" min="0" max="359" value="${m.windDir}" step="5" />
                  <span class="val" id="menuDirVal">${m.windDir}°</span>
               </label>
               <label class="ctrl">
                  <span>Wind speed (Bft <b id="menuBft"></b>)</span>
                  <input type="range" id="menuSpeed" min="1" max="35" value="${m.windSpeed}" step="1" />
                  <span class="val" id="menuSpeedVal">${m.windSpeed} kn</span>
               </label>
               <label class="ctrl toggle">
                  <input type="checkbox" id="menuGusts" ${m.gusts ? "checked" : ""} />
                  <span>Gusts / Veer (wind fluctuations)</span>
               </label>
            </div>
            <div class="menu-btns">
               <button class="primary" id="menuStart">${startLabel}</button>
               ${resumeHtml}
               <button id="menuHelp">Help</button>
            </div>
         </div>`;
      this.menuEl.style.display = "flex";
      this.compass.style.display = "none";
      this.root.style.display = "none";

      this.menuEl.querySelectorAll(".mode-btn").forEach((b) => {
         b.onclick = () => {
             m.mode = b.dataset.mode;
             this.renderMenu(m);
         };
      });
      this.menuEl.querySelectorAll(".sc-btn").forEach((b) => {
         b.onclick = () => {
            m.scenarioId = b.dataset.sc;
            m.onScenarioChange(m.scenarioId);
            this.renderMenu(m);
         };
      });
      this.menuEl.querySelectorAll(".ship-btn").forEach((b) => {
         b.onclick = () => {
            m.vesselId = b.dataset.vessel;
            m.onVesselChange(m.vesselId);
            this.renderMenu(m);
         };
      });
      const rnd = this.menuEl.querySelector("#menuRandom");
      if (rnd) rnd.onchange = () => { m.randomStart = rnd.checked; m.onRandomChange(m.randomStart); };
      const dir = this.menuEl.querySelector("#menuDir");
      const dirVal = this.menuEl.querySelector("#menuDirVal");
      const sp = this.menuEl.querySelector("#menuSpeed");
      const spVal = this.menuEl.querySelector("#menuSpeedVal");
      const gusts = this.menuEl.querySelector("#menuGusts");
      this._updateBft(m);
      dir.oninput = () => {
         m.windDir = +dir.value;
         dirVal.textContent = m.windDir + "°";
         this._updateBft(m);
         m.onWindChange(m.windDir, m.windSpeed, m.gusts);
      };
      sp.oninput = () => {
         m.windSpeed = +sp.value;
         spVal.textContent = m.windSpeed + " kn";
         this._updateBft(m);
         m.onWindChange(m.windDir, m.windSpeed, m.gusts);
      };
      gusts.onchange = () => {
         m.gusts = gusts.checked;
         m.onWindChange(m.windDir, m.windSpeed, m.gusts);
      };
      for (const [id, key] of [["#mpUrl", "url"], ["#mpName", "name"], ["#mpRoom", "roomId"], ["#mpRoomName", "roomName"]]) {
         const el = this.menuEl.querySelector(id);
         if (el) el.oninput = () => { m.mp[key] = el.value.trim(); };
      }
      const urlEl = this.menuEl.querySelector("#mpUrl");
      if (urlEl) urlEl.onchange = () => this.refreshRooms(m);
      this.menuEl.querySelectorAll(".mode-btn[data-mpmode]").forEach((b) => {
         b.onclick = () => { m.mp.mode = b.dataset.mpmode; this.renderMenu(m); };
      });
      const refresh = this.menuEl.querySelector("#roomRefresh");
      if (refresh) refresh.onclick = () => this.refreshRooms(m);
      if (isMp) this.refreshRooms(m);
      this.menuEl.querySelector("#menuStart").onclick = () => {
         if (isMp) {
            this._join(m, null);
            return;
         }
         m.onStart(m.mode, m.windDir, m.windSpeed, m.gusts, m.vesselId, m.scenarioId);
      };
      const resume = this.menuEl.querySelector("#menuResume");
      if (resume) resume.onclick = () => m.onResume();
      this.menuEl.querySelector("#menuHelp").onclick = () => m.onHelp(m);
   }

   _updateBft(m) {
      const map = [
         [1, 0],
         [4, 1],
         [7, 2],
         [11, 3],
         [17, 4],
         [22, 5],
         [28, 6],
         [34, 7],
         [41, 8],
         [48, 9],
         [56, 10],
         [64, 11],
      ];
      let b = 12;
      for (const [lo, hi] of map) {
         if (m.windSpeed < lo) {
            b = hi;
            break;
         }
         b = hi;
      }
      const el = this.menuEl.querySelector("#menuBft");
      if (el) el.textContent = b;
   }

   closeMenu() {
      this.menuEl.style.display = "none";
      this.root.style.display = "block";
      this.compass.style.display = "block";
   }
}

// Condition colour for the hull plan: sound -> worn -> shot through -> gone.
// The stops come from the style's HUD palette.
function damageColor(v) {
   const t = Math.max(0, Math.min(1, v === undefined ? 1 : v));
   const stops = palette().hud.damageStops;
   for (let i = 0; i < stops.length - 1; i++) {
      const [a, ca] = stops[i], [b, cb] = stops[i + 1];
      if (t >= a && t <= b) {
         const u = (t - a) / (b - a);
         const c = [0, 1, 2].map((j) => Math.round(ca[j] + (cb[j] - ca[j]) * u));
         return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
   }
   const last = stops[stops.length - 1][1];
   return `rgb(${last[0]},${last[1]},${last[2]})`;
}

// Bar fill by condition: the classes pick the skin's colours.
function setLevel(el, good) {
   el.classList.toggle("is-warn", good <= 0.6 && good > 0.3);
   el.classList.toggle("is-bad", good <= 0.3);
}

function escapeAttr(s) {
   return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Point-of-sail dot: the stylesheet tokens carry the colours of both skins.
function pointColor(twa, luffing, noGo = 32) {
   if (luffing) return "var(--pos-luff)";
   const t = Math.abs(twa || 0) % 360;
   if (t < noGo) return "var(--pos-nogo)";
   if (t < noGo + 23) return "var(--pos-close)";
   if (t < 110) return "var(--pos-reach)";
   if (t < 150) return "var(--pos-broad)";
   return "var(--pos-run)";
}

export default { UI };
