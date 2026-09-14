// ui.js - 2D HUD + compass + menu + training panel
import { normDeg } from "./utils.js";
import { VESSELS, vesselLabel, broadsideWeight, gunCount } from "./vessels.js";
import { palette } from "./style.js";

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
      this.build();
   }

   build() {
      this.root.innerHTML =
          `
           <div class="panel tl">
              <div class="mode" id="hudMode">FREERIDE</div>
              <div class="ship-name" id="hudShip">Nordwind</div>
              <div class="small" id="hudShipRate">Bermuda Sloop</div>
              <div class="small" id="hudLap">Lap 0</div>
              <div class="small" id="hudTime">0.0s · Best: --</div>
              <div class="small" id="hudCourse">Course: Start</div>
              <div class="small" id="hudProgress">0%</div>
           </div>
           <div class="panel tr windbox">
              <div class="wind-title">WIND</div>
              <div class="wind-dir"><span id="windDir">0</span>° · <span id="windName">Calm</span></div>
              <div class="wind-speed"><span id="windSpeed">0.0</span> kn · <span id="beaufort">Bft 0</span></div>
              <div class="awa">AwA <span id="awaFrom">--</span>° · <span id="awaSpeed">--</span> kn</div>
              <div class="small" id="seaState">Sea: --</div>
              <div class="small" id="hudGust">Gusts: on</div>
           </div>
           <div class="panel bl">
              <div class="readbig"><span id="hSpeed">0.0</span><span class="u">kn</span></div>
              <div class="small" id="vmg">VMG ↑ 0.0 · ↓ 0.0</div>
              <div class="small" id="twa">TWA -- · <span id="tack">Port</span></div>
           </div>
           <div class="panel bc">
              <div class="pos" id="pos"><span class="dot"></span><span id="posText">Luffing</span></div>
              <div class="rudder">
                 <span class="rr" style="opacity:.8">PORT ←</span>
                 <div class="rudder-track"><div class="rudder-ind" id="rudderInd"></div></div>
                 <span class="rr" style="opacity:.8">→ STBD</span>
              </div>
              <div class="camera" id="camera">CAM: Follow</div>
              <div class="hint">Space: Right the boat after capsize · C: Camera</div>
           </div>
           <div class="panel cmd" id="cmdPanel">
              <div class="cmd-title">CAPTAIN'S ORDERS</div>
              <div class="cmd-group">
                 <div class="cmd-label">Helm</div>
                 <div class="cmd-row">
                    <button type="button" class="cmd" data-hold="KeyA"><span class="l">◄ Port</span><kbd>A</kbd></button>
                    <button type="button" class="cmd" data-hold="KeyD"><span class="l">Starboard ►</span><kbd>D</kbd></button>
                 </div>
              </div>
              <div class="cmd-group">
                 <div class="cmd-label">Sails</div>
                 <div class="cmd-row">
                    <button type="button" class="cmd" data-hold="KeyW" id="cmdSailIn"><span class="l">Set sail</span><kbd>W</kbd></button>
                    <button type="button" class="cmd" data-hold="KeyS" id="cmdSailOut"><span class="l">Reef</span><kbd>S</kbd></button>
                    <span class="cmd-state" id="cmdSailState"></span>
                 </div>
              </div>
              <div class="cmd-group" id="cmdGuns">
                 <div class="cmd-label">Gunnery</div>
                 <div class="cmd-row">
                    <button type="button" class="cmd" data-cmd="firePort" id="cmdFireP"><span class="l">Fire port</span><kbd>Q</kbd></button>
                    <button type="button" class="cmd" data-cmd="fireStbd" id="cmdFireS"><span class="l">Fire stbd</span><kbd>E</kbd></button>
                    <button type="button" class="cmd" data-cmd="fireBoth" id="cmdFireB"><span class="l">Both</span><kbd>F</kbd></button>
                 </div>
                 <div class="cmd-row">
                    <span class="cmd-state" style="margin:0">Load</span>
                    <button type="button" class="cmd small ammo-btn" data-cmd="ammo:ball"><span class="l">Shot</span></button>
                    <button type="button" class="cmd small ammo-btn" data-cmd="ammo:chain"><span class="l">Chain</span></button>
                    <button type="button" class="cmd small ammo-btn" data-cmd="ammo:grape"><span class="l">Grape</span></button>
                    <kbd>Z</kbd>
                 </div>
              </div>
              <div class="cmd-group">
                 <div class="cmd-label">Damage control</div>
                 <div class="cmd-row">
                    <button type="button" class="cmd" data-cmd="cutWreck" id="cmdCut"><span class="l">Cut away wreck</span><kbd>X</kbd></button>
                    <button type="button" class="cmd" data-cmd="capsizeRight" id="cmdRight"><span class="l">Right the ship</span><kbd>Space</kbd></button>
                 </div>
              </div>
              <div class="cmd-group">
                 <div class="cmd-label">Ship &amp; view</div>
                 <div class="cmd-row">
                    <button type="button" class="cmd small" data-cmd="cycleVessel" id="cmdVessel"><span class="l">Change ship</span><kbd>V</kbd></button>
                    <button type="button" class="cmd small" data-cmd="cycleCamera"><span class="l">Camera</span><kbd>C</kbd></button>
                    <button type="button" class="cmd small" data-cmd="toggleMenu"><span class="l">Menu</span><kbd>M</kbd></button>
                 </div>
              </div>
              <div class="hint">H hides the HUD · T top-down · G gusts · R restart course</div>
           </div>
           <div class="panel crew" id="crewPanel" style="display:none">
              <div class="crew-title">CREW <span id="crewHead"></span></div>
              <div id="crewList"></div>
              <div class="crew-foot"><span>Moral</span>
                 <div class="dmg-track"><div class="dmg-fill" id="crewMoral"></div></div>
                 <span class="dv" id="crewMoralV">100%</span></div>
           </div>
           <div class="panel dmg" id="dmgPanel" style="display:none">
              <div class="dmg-title">HULL CONDITION</div>
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
                    <div class="masts" id="dMasts"></div>
                 </div>
              </div>
              <div class="small warn" id="dWarn"></div>
           </div>
           <div class="panel foes" id="foePanel" style="display:none">
              <div class="foe-title">ENEMIES</div>
              <div id="foeList"></div>
           </div>
           <div class="panel gun" id="gunPanel" style="display:none">
              <div class="gun-title">BATTERY · <span id="gunCal">—</span></div>
              <div class="ammo-row" id="ammoRow"></div>
              <div class="gun-row">
                 <span class="gun-side">Q ◄ PORT</span>
                 <div class="gun-track"><div class="gun-fill" id="gunFillP"></div></div>
                 <span class="gun-state" id="gunStateP">READY</span>
              </div>
              <div class="gun-row">
                 <span class="gun-side">E ► STBD</span>
                 <div class="gun-track"><div class="gun-fill" id="gunFillS"></div></div>
                 <span class="gun-state" id="gunStateS">READY</span>
              </div>
              <div class="small" id="gunInfo">— guns per side · F = both sides</div>
           </div>
           <div class="msgwrap" id="msgwrap"></div>
           <div class="train panel" id="train" style="display:none">
              <div class="train-title" id="trainTitle">Training</div>
              <div class="train-desc" id="trainDesc"></div>
              <div class="small" id="trainHint">Goal</div>
              <div class="train-bar"><div class="train-fill" id="trainFill"></div></div>
           </div>
           `;
      this._refs = {
         mode: this.root.querySelector("#hudMode"),
         ship: this.root.querySelector("#hudShip"),
         shipRate: this.root.querySelector("#hudShipRate"),
         gunPanel: this.root.querySelector("#gunPanel"),
         gunCal: this.root.querySelector("#gunCal"),
         gunFillP: this.root.querySelector("#gunFillP"),
         gunFillS: this.root.querySelector("#gunFillS"),
         gunStateP: this.root.querySelector("#gunStateP"),
         gunStateS: this.root.querySelector("#gunStateS"),
         gunInfo: this.root.querySelector("#gunInfo"),
         ammoRow: this.root.querySelector("#ammoRow"),
         crewPanel: this.root.querySelector("#crewPanel"),
         crewHead: this.root.querySelector("#crewHead"),
         crewList: this.root.querySelector("#crewList"),
         crewMoral: this.root.querySelector("#crewMoral"),
         crewMoralV: this.root.querySelector("#crewMoralV"),
         dmgPanel: this.root.querySelector("#dmgPanel"),
         dHull: this.root.querySelector("#dHull"), dHullV: this.root.querySelector("#dHullV"),
         dRig: this.root.querySelector("#dRig"), dRigV: this.root.querySelector("#dRigV"),
         dRud: this.root.querySelector("#dRud"), dRudV: this.root.querySelector("#dRudV"),
         dFlood: this.root.querySelector("#dFlood"), dFloodV: this.root.querySelector("#dFloodV"),
         dMasts: this.root.querySelector("#dMasts"),
         plan: {
            sections: {},
            masts: {},
            xs: {},
            rudder: this.root.querySelector("#pl_rudder"),
         },
         dWarn: this.root.querySelector("#dWarn"),
         foePanel: this.root.querySelector("#foePanel"),
         foeList: this.root.querySelector("#foeList"),
         lap: this.root.querySelector("#hudLap"),
         time: this.root.querySelector("#hudTime"),
         course: this.root.querySelector("#hudCourse"),
         progress: this.root.querySelector("#hudProgress"),
         windDir: this.root.querySelector("#windDir"),
         windName: this.root.querySelector("#windName"),
         windSpeed: this.root.querySelector("#windSpeed"),
         beaufort: this.root.querySelector("#beaufort"),
         awaFrom: this.root.querySelector("#awaFrom"),
         awaSpeed: this.root.querySelector("#awaSpeed"),
         gust: this.root.querySelector("#hudGust"),
         seaState: this.root.querySelector("#seaState"),
         hSpeed: this.root.querySelector("#hSpeed"),
         vmg: this.root.querySelector("#vmg"),
         twa: this.root.querySelector("#twa"),
         tack: this.root.querySelector("#tack"),
         rudderInd: this.root.querySelector("#rudderInd"),
         camera: this.root.querySelector("#camera"),
         posText: this.root.querySelector("#posText"),
         posDot: this.root.querySelector("#pos .dot"),
         msgwrap: this.root.querySelector("#msgwrap"),
         train: this.root.querySelector("#train"),
         trainTitle: this.root.querySelector("#trainTitle"),
         trainDesc: this.root.querySelector("#trainDesc"),
         trainHint: this.root.querySelector("#trainHint"),
         trainFill: this.root.querySelector("#trainFill"),
         cmdPanel: this.root.querySelector("#cmdPanel"),
         cmdGuns: this.root.querySelector("#cmdGuns"),
         cmdFireP: this.root.querySelector("#cmdFireP"),
         cmdFireS: this.root.querySelector("#cmdFireS"),
         cmdFireB: this.root.querySelector("#cmdFireB"),
         cmdAmmo: Array.from(this.root.querySelectorAll(".ammo-btn")),
         cmdSailIn: this.root.querySelector("#cmdSailIn .l"),
         cmdSailOut: this.root.querySelector("#cmdSailOut .l"),
         cmdSailState: this.root.querySelector("#cmdSailState"),
         cmdCut: this.root.querySelector("#cmdCut"),
         cmdRight: this.root.querySelector("#cmdRight"),
         cmdVessel: this.root.querySelector("#cmdVessel"),
      };
      this._bindCommands();
      for (const side of ["PORT", "STBD"]) {
         for (const sec of ["BOW", "MID", "QUARTER"]) {
            const k = side + "_" + sec;
            this._refs.plan.sections[k] = this.root.querySelector("#pl_" + k);
         }
      }
      for (const m of ["fore", "main", "mizzen"]) {
         this._refs.plan.masts[m] = this.root.querySelector("#pl_mast_" + m);
         this._refs.plan.xs[m] = this.root.querySelector("#pl_x_" + m);
      }
   }

   /**
    * The orders panel: every command the captain can give, as a button.
    * Buttons with data-cmd push the same queue event the key would; buttons
    * with data-hold act like holding the key down (helm, sails). The game
    * plugs in onCommand(name) and onHold(code, down).
    */
   _bindCommands() {
      this.onCommand = null;
      this.onHold = null;
      for (const b of this.root.querySelectorAll("button.cmd[data-cmd]")) {
         b.addEventListener("click", () => {
            b.blur();
            if (this.onCommand) this.onCommand(b.dataset.cmd);
         });
      }
      for (const b of this.root.querySelectorAll("button.cmd[data-hold]")) {
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

   _updateCommands(s) {
      const R = this._refs;
      if (!R.cmdPanel) return;
      const armed = !!(s.vessel && s.vessel.guns);
      R.cmdGuns.style.display = armed ? "" : "none";
      if (armed && s.guns) {
         const ready = s.guns.gunsReady || { PORT: s.guns.guns, STBD: s.guns.guns };
         const st = (btn, g, n) => {
            const ok = !!(g && g.ready && n > 0);
            btn.classList.toggle("ready", ok);
            btn.disabled = !ok;
         };
         st(R.cmdFireP, s.guns.PORT, ready.PORT);
         st(R.cmdFireS, s.guns.STBD, ready.STBD);
         R.cmdFireB.disabled = R.cmdFireP.disabled && R.cmdFireS.disabled;
         R.cmdFireB.classList.toggle("ready", !R.cmdFireB.disabled);
         const cur = s.guns.ammo ? s.guns.ammo.id : "ball";
         for (const b of R.cmdAmmo) b.classList.toggle("on", b.dataset.cmd === "ammo:" + cur);
      }
      const square = !!(s.vessel && s.vessel.rig === "square");
      R.cmdSailIn.textContent = square ? "Set sail" : "Trim in";
      R.cmdSailOut.textContent = square ? "Reef" : "Trim out";
      R.cmdSailState.textContent = square && typeof s.sailSet === "number"
         ? Math.round(s.sailSet * 100) + "% set" : "";
      R.cmdCut.disabled = !s.wreck;
      R.cmdRight.disabled = !(s.boat && s.boat.capsize);
      R.cmdVessel.style.display = s.multiplayer ? "none" : "";
   }

   update(s) {
      if (!this.hudVisible) {
         this.root.style.display = "none";
         this.compass.style.display = "none";
         return;
      }
      this.root.style.display = "block";
      this.compass.style.display = "block";
      const R = this._refs;
      R.mode.textContent = s.mode.toUpperCase();

      if (s.vessel) {
         R.ship.textContent = vesselLabel(s.vessel);
         R.shipRate.textContent = s.vessel.rate;
      }
      this._updateGuns(s);
      this._updateDamage(s);
      this._updateCrew(s);
      this._updateFoes(s);

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
         R.progress.style.visibility = "visible";
         R.progress.textContent = Math.round(s.course.progress * 100) + "%";
      } else {
         R.lap.textContent = "";
         R.time.textContent = "";
         R.course.textContent = s.mode === "Training" ? "" : "Open Sea";
         R.progress.style.visibility = "hidden";
      }

      R.windDir.textContent = Math.round(s.wind.dir % 360);
      R.windName.textContent = s.wind.name;
      R.windSpeed.textContent = s.wind.speed.toFixed(1);
      R.beaufort.textContent = "Bft " + s.wind.bft;
      R.awaFrom.textContent = s.awa.from ? Math.round(s.awa.from) : "--";
      R.awaSpeed.textContent = s.awa.speed ? s.awa.speed.toFixed(1) : "--";
      R.gust.textContent = "Gusts: " + (s.gusts ? "on" : "off");
      if (s.sea) R.seaState.textContent = "Sea: " + s.sea.name + " · " + s.sea.hs.toFixed(1) + " m";

      const sp = s.boat.speed.toFixed(1);
      R.hSpeed.textContent = sp;
      R.hSpeed.parentElement.classList.toggle("luff", !!s.boat.luffing);
      R.vmg.textContent =
         "VMG ↑ " + s.boat.vmgUp.toFixed(1) + "  ↓ " + s.boat.vmgDown.toFixed(1);
      R.twa.textContent =
         "TWA " +
         Math.round(s.boat.twa) +
         "° · " +
         (s.boat.tack === "STBD" ? "Stbd" : "Port") +
         (s.boat.capsize ? "  CAPSIZED!" : "");
      R.tack.textContent = s.boat.tack === "STBD" ? "Stbd" : "Port";

      const rr = Math.max(-1, Math.min(1, s.boat.rudder || 0));
      R.rudderInd.style.left = ((rr + 1) / 2 * 100).toFixed(0) + "%";
      R.camera.textContent = "CAM: " + s.camera;
      R.posText.textContent = s.pos;
      R.posDot.style.background = pointColor(s.boat.twa, s.boat.luffing, s.noGo || 32);

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
      this._updateCommands(s);
      this.drawCompass(s);
   }

   _updateGuns(s) {
      const R = this._refs;
      if (!s.guns || !s.guns.guns) {
         R.gunPanel.style.display = "none";
         return;
      }
      R.gunPanel.style.display = "block";
      const cal = (s.vessel && s.vessel.guns && s.vessel.guns.decks
         .map((d) => d.calibre).join(" / ")) || "";
      R.gunCal.textContent = cal;
      const ready = s.guns.gunsReady || { PORT: s.guns.guns, STBD: s.guns.guns };
      const set = (fill, state, g, nReady) => {
         const pct = Math.round(g.progress * 100);
         // A side without manned guns is not "ready", it is finished. The
         // colours live in the stylesheet (is-out / is-ready / loading).
         const out = nReady <= 0;
         fill.className = "gun-fill" + (out ? " is-out" : g.ready ? " is-ready" : "");
         state.className = "gun-state" + (out ? " is-out" : g.ready ? " is-ready" : "");
         if (out) {
            fill.style.width = "100%";
            state.textContent = "KNOCKED OUT";
            return;
         }
         fill.style.width = pct + "%";
         state.textContent = g.ready ? "READY" : "LOADING " + pct + "%";
      };
      set(R.gunFillP, R.gunStateP, s.guns.PORT, ready.PORT);
      set(R.gunFillS, R.gunStateS, s.guns.STBD, ready.STBD);
      R.gunInfo.textContent =
         ready.PORT + "/" + ready.STBD + " of " + s.guns.guns + " guns · "
         + s.guns.broadsides + " broadsides · " + s.guns.shots + " shots";
      if (s.guns.ammo && R.ammoRow) {
         const cur = s.guns.ammo.id;
         const names = [["ball", "Shot"], ["chain", "Chain"], ["grape", "Grape"]];
         R.ammoRow.innerHTML = names.map(([id, n]) =>
            `<span class="ammo${id === cur ? " on" : ""}">${n}</span>`).join("")
            + `<span class="ammo-key">Z</span>`;
      }
   }

   showMessage(text) {
      this._showMessage(text);
   }

   _updateDamage(s) {
      const R = this._refs;
      const d = s.damage;
      if (!d || (s.vessel && s.vessel.rig !== "square")) {
         R.dmgPanel.style.display = "none";
         return;
      }
      R.dmgPanel.style.display = "block";
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

      const M = [['fore', 'Fore'], ['main', 'Main'], ['mizzen', 'Mizzen']];
      R.dMasts.innerHTML = M.map(([k, n]) => {
         const st = d.masts[k];
         const cls = st.state === "gone" ? "gone" : st.state === "wounded" ? "hurt" : "ok";
         const val = st.state === "gone" ? "gone" : Math.round(st.integrity * 100) + "%";
         return `<span class="mast ${cls}" title="${n}mast">${n}<b>${val}</b></span>`;
      }).join("");

      const warn = [];
      if (d.afire > 0.05) warn.push("FIRE ON BOARD");
      if (s.wreck) warn.push("Wreck in tow — X to cut");
      if (d.flooding > 0.25) warn.push("Water in the ship");
      if (s.depth !== null && s.depth !== undefined && s.depth < 12) {
         warn.push("SHALLOW WATER " + s.depth.toFixed(1) + " m");
      }
      R.dWarn.textContent = warn.join(" · ");
      R.dWarn.style.display = warn.length ? "block" : "none";
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
