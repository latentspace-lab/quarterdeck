// ui.js - 2D-HUD + 2D-Kompass + Menue + Training-Panel
import { normDeg } from "./utils.js";
import { VESSELS, vesselLabel, broadsideWeight, gunCount } from "./vessels.js";

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
              <div class="small" id="hudShipRate">Bermuda-Sloop</div>
              <div class="small" id="hudLap">Runde 0</div>
              <div class="small" id="hudTime">0.0s · Beste: --</div>
              <div class="small" id="hudCourse">Kurs: Start</div>
              <div class="small" id="hudProgress">0%</div>
           </div>
           <div class="panel tr windbox">
              <div class="wind-title">WIND</div>
              <div class="wind-dir"><span id="windDir">0</span>° · <span id="windName">Windstille</span></div>
              <div class="wind-speed"><span id="windSpeed">0.0</span> kn · <span id="beaufort">Bft 0</span></div>
              <div class="awa">AwA <span id="awaFrom">--</span>° · <span id="awaSpeed">--</span> kn</div>
              <div class="small" id="hudGust">Gusts: an</div>
           </div>
           <div class="panel bl">
              <div class="readbig"><span id="hSpeed">0.0</span><span class="u">kn</span></div>
              <div class="small" id="vmg">VMG ↑ 0.0 · ↓ 0.0</div>
              <div class="small" id="twa">TWA -- · <span id="tack">Port</span></div>
           </div>
           <div class="panel bc">
              <div class="pos" id="pos"><span class="dot"></span><span id="posText">Krausen</span></div>
              <div class="rudder">
                 <span class="rr" style="opacity:.8">BB ←</span>
                 <div class="rudder-track"><div class="rudder-ind" id="rudderInd"></div></div>
                 <span class="rr" style="opacity:.8">→ STB</span>
              </div>
              <div class="camera" id="camera">KAMERA: Verfolger</div>
              <div class="hint">Leertaste: Boot aufrichten nach Kenter · C: Kamera</div>
           </div>
           <div class="br small keys">
              <div><b>Steuer:</b> A / D &nbsp;|&nbsp; ← / → &nbsp;Ruder</div>
              <div><b>Segeltrimm:</b> W in · S aus &nbsp;|&nbsp; C / 1-4 Kamera · H HUD · T Top</div>
              <div><b>Menü:</b> M / Esc &nbsp;·&nbsp; R Neustart (Kurs) &nbsp;·&nbsp; G Gusts</div>
           </div>
           <div class="panel gun" id="gunPanel" style="display:none">
              <div class="gun-title">BATTERIE · <span id="gunCal">—</span></div>
              <div class="gun-row">
                 <span class="gun-side">Q ◄ BB</span>
                 <div class="gun-track"><div class="gun-fill" id="gunFillP"></div></div>
                 <span class="gun-state" id="gunStateP">KLAR</span>
              </div>
              <div class="gun-row">
                 <span class="gun-side">E ► STB</span>
                 <div class="gun-track"><div class="gun-fill" id="gunFillS"></div></div>
                 <span class="gun-state" id="gunStateS">KLAR</span>
              </div>
              <div class="small" id="gunInfo">— Rohre je Seite · F = beide Seiten</div>
           </div>
           <div class="msgwrap" id="msgwrap"></div>
           <div class="train panel" id="train" style="display:none">
              <div class="train-title" id="trainTitle">Training</div>
              <div class="train-desc" id="trainDesc"></div>
              <div class="small" id="trainHint">Ziel</div>
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
      };
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

      if (s.mode === "Regatta" && s.course) {
         R.lap.textContent = "Runde " + s.course.lap;
         R.time.textContent =
            s.course.time.toFixed(1) + "s · Beste: " +
            (s.course.best ? s.course.best.toFixed(1) + "s" : "--");
         R.course.textContent =
            "Leg " +
            (s.course.leg + 1) +
            " · " +
            (s.course.legName || "Wendeboje") +
            " · " +
            Math.round(s.course.dist) +
            " m · Rgk " +
            Math.round(s.course.bearing) +
            "°";
         R.progress.style.visibility = "visible";
         R.progress.textContent = Math.round(s.course.progress * 100) + "%";
      } else {
         R.lap.textContent = "";
         R.time.textContent = "";
         R.course.textContent = s.mode === "Training" ? "" : "Frei auf See";
         R.progress.style.visibility = "hidden";
      }

      R.windDir.textContent = Math.round(s.wind.dir % 360);
      R.windName.textContent = s.wind.name;
      R.windSpeed.textContent = s.wind.speed.toFixed(1);
      R.beaufort.textContent = "Bft " + s.wind.bft;
      R.awaFrom.textContent = s.awa.from ? Math.round(s.awa.from) : "--";
      R.awaSpeed.textContent = s.awa.speed ? s.awa.speed.toFixed(1) : "--";
      R.gust.textContent = "Gusts: " + (s.gusts ? "an" : "aus");

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
         (s.boat.capsize ? "  KENTER!" : "");
      R.tack.textContent = s.boat.tack === "STBD" ? "Stbd" : "Port";

      const rr = Math.max(-1, Math.min(1, s.boat.rudder || 0));
      R.rudderInd.style.left = ((rr + 1) / 2 * 100).toFixed(0) + "%";
      R.camera.textContent = "KAMERA: " + s.camera;
      R.posText.textContent = s.pos;
      R.posDot.style.background = pointColor(s.boat.twa, s.boat.luffing, s.noGo || 32);

      if (this.training) {
         R.train.style.display = "block";
         R.trainTitle.textContent = this.training.title || "";
         R.trainDesc.textContent = this.training.desc || "";
         R.trainHint.textContent =
            "Fortschritt: " + Math.round((this.training.progress || 0) * 100) + "%";
         R.trainFill.style.width = Math.round((this.training.progress || 0) * 100) + "%";
         R.trainFill.style.background = this.training.done ? "#3bd671" : "#ff5d5d";
      } else {
         R.train.style.display = "none";
      }

      if (s.message && s.message !== this._last.message) {
         this._showMessage(s.message);
      }
      this._last.message = s.message;
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
      const set = (fill, state, g) => {
         const pct = Math.round(g.progress * 100);
         fill.style.width = pct + "%";
         fill.style.background = g.ready
            ? "linear-gradient(90deg,#ffb03d,#ff5d5d)"
            : "linear-gradient(90deg,#2d4f6b,#4b7fa6)";
         state.textContent = g.ready ? "KLAR" : "LADEN " + pct + "%";
         state.style.color = g.ready ? "#ffcf5d" : "rgba(210,230,250,0.6)";
      };
      set(R.gunFillP, R.gunStateP, s.guns.PORT);
      set(R.gunFillS, R.gunStateS, s.guns.STBD);
      R.gunInfo.textContent =
         s.guns.guns + " Rohre je Seite · " + s.guns.broadsides + " Breitseiten · "
         + s.guns.shots + " Schuss";
   }

   showMessage(text) {
      this._showMessage(text);
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

   drawCompass(s) {
      const ctx = this.ctx;
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
      ctx.fillStyle = "rgba(8,20,32,0.85)";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(120,180,220,0.45)";
      ctx.stroke();

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
         ctx.strokeStyle = a % 90 === 0 ? "rgba(0,0,0,0)" : "rgba(200,220,240,0.4)";
         ctx.stroke();
      }

      const dirs = [
         ["N", 0],
         ["E", 90],
         ["S", 180],
         ["W", 270],
      ];
      for (const [lbl, ang] of dirs) {
         const rad = (ang * Math.PI) / 180;
         const x = Math.sin(rad) * (RR - 22);
         const z = Math.cos(rad) * (RR - 22);
         ctx.font = lbl === "N" ? "bold 15px system-ui" : "12px system-ui";
         ctx.fillStyle = lbl === "N" ? "#ff5d5d" : "rgba(210,230,250,0.85)";
         ctx.textAlign = "center";
         ctx.textBaseline = "middle";
         ctx.fillText(lbl, x, -z + 1);
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
      ctx.strokeStyle = "#4ea3ff";
      ctx.stroke();
      ctx.fillStyle = "#4ea3ff";
      ctx.beginPath();
      ctx.arc(x, -y, 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(6, 10);
      ctx.lineTo(0, 5);
      ctx.lineTo(-6, 10);
      ctx.closePath();
      ctx.fillStyle = s.boat.luffing ? "#ffcc44" : "#ff4444";
      ctx.fill();

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
         ctx.strokeStyle = "#44ffcc";
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
         onWindChange: opts.onWindChange,
         onVesselChange: opts.onVesselChange || (() => {}),
         onStart: opts.onStart,
         onHelp: opts.onHelp,
      };
      this.renderMenu(m);
   }

   renderMenu(m) {
      const modes = [
         ["Freeride", "Frei auf See, Windspielen"],
         ["Regatta", "Runden-Kurs mit Wendebojen"],
         ["Training", "Segeltechnische Übungen"],
      ];
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
            ? `<span class="sb-g">${gunCount(v)} Rohre · ${broadsideWeight(v)} lb Breitseite</span>`
            : `<span class="sb-g">ohne Bewaffnung</span>`;
         return `<button class="ship-btn${m.vesselId === v.id ? " active" : ""}" data-vessel="${v.id}">
                  <div class="sb-head">
                     <span class="sb-name">${vesselLabel(v)}</span>
                     <span class="sb-era">${v.era}</span>
                  </div>
                  <div class="sb-rate">${v.rate}</div>
                  <div class="sb-desc">${v.desc}</div>
                  <div class="sb-stats">
                     <span>${v.hull.loa.toFixed(0)} m LüA</span>
                     <span>${v.crew} Mann</span>
                     <span>Am Wind ${v.sail.noGo}°</span>
                  </div>
                  <div class="sb-foot">${guns}</div>
               </button>`;
      }).join("");
      const selected = VESSELS.find((v) => v.id === m.vesselId) || VESSELS[0];

      this.menuEl.innerHTML =
          `<div class="menu-card">
            <h1>Segel-Simulator 3D</h1>
            <p class="subm">Wende · Krause · Raumschot — semi-realistische Physik</p>
            <div class="sec-label">Schiff</div>
            <div class="ship-grid">${shipHtml}</div>
            <div class="sec-label">Spielmodus</div>
            <div class="mode-grid">${modeHtml}</div>
            <div class="menu-controls">
               <label class="ctrl">
                  <span>Windrichtung</span>
                  <input type="range" id="menuDir" min="0" max="359" value="${m.windDir}" step="5" />
                  <span class="val" id="menuDirVal">${m.windDir}°</span>
               </label>
               <label class="ctrl">
                  <span>Windstärke (Bft <b id="menuBft"></b>)</span>
                  <input type="range" id="menuSpeed" min="1" max="35" value="${m.windSpeed}" step="1" />
                  <span class="val" id="menuSpeedVal">${m.windSpeed} kn</span>
               </label>
               <label class="ctrl toggle">
                  <input type="checkbox" id="menuGusts" ${m.gusts ? "checked" : ""} />
                  <span>Gusts / Veer (Wind-Schwankungen)</span>
               </label>
            </div>
            <div class="menu-btns">
               <button class="primary" id="menuStart">${m.mode} · ${vesselLabel(selected)}</button>
               <button id="menuHelp">Hilfe</button>
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
      this.menuEl.querySelectorAll(".ship-btn").forEach((b) => {
         b.onclick = () => {
            m.vesselId = b.dataset.vessel;
            m.onVesselChange(m.vesselId);
            this.renderMenu(m);
         };
      });
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
      this.menuEl.querySelector("#menuStart").onclick = () =>
         m.onStart(m.mode, m.windDir, m.windSpeed, m.gusts, m.vesselId);
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

function pointColor(twa, luffing, noGo = 32) {
   if (luffing) return "#ff5d5d";
   const t = Math.abs(twa || 0) % 360;
   if (t < noGo) return "#ff9e3d";
   if (t < noGo + 23) return "#ffe66d";
   if (t < 110) return "#5dff8a";
   if (t < 150) return "#5d8bff";
   return "#3d5dff";
}

export default { UI };
