// game.js - Simulation: bindet Szene, Boot, Physik, Kamera, Steuerung, Modi, UI
import * as THREE from "three";
import { createOcean, seaHeight, ampForWind } from "./ocean.js";
import { createScene } from "./scene.js";
import { buildSailboat } from "./boat.js";
import { buildWarship } from "./warship.js";
import { getVessel, VESSELS, vesselLabel } from "./vessels.js";
import { Battery } from "./guns.js";
import { BoatDynamics, pointOfSail, vmgUp, vmgDown, polarSpeedAt } from "./physics.js";
import { Wind, beaufortName, beaufortOf } from "./wind.js";
import { CameraRig } from "./camera.js";
import { Controls } from "./controls.js";
import { Course } from "./marks.js";
import { makeTrainer } from "./trainer.js";
import { UI } from "./ui.js";
import { DEG, clamp, lerp, normDeg, dirVec, diffDeg } from "./utils.js";

const CAM_LABEL = {
   CHASE: "Verfolger",
   COCKPIT: "Cockpit",
   TOP: "Draufsicht",
   ORBIT: "Orbit",
};

export class Simulator {
   constructor(opts = {}) {
      this.dom = opts.dom || document.querySelector("#hud");
      const viewport = document.getElementById("viewport");
      const compassC = document.getElementById("compass");
      const menuEl = document.getElementById("menu");
      this.paused = false;
      this.menuOpen = true;

      // Renderer
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      viewport.appendChild(this.renderer.domElement);
      this.renderer.domElement.style.cssText = "position:fixed;inset:0;width:100%;height:100%";

      // Szene
      const scene = createScene();
      this.scene = scene;
      scene.setSunDir(55, 48);

      // Kamera
      this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 12000);
      this.camera.position.set(0, 8, -18);
      this.camera.lookAt(0, 1, 0);

      // Ozean
      this.ocean = createOcean({ sunDir: new THREE.Vector3(0.4, 0.6, 0.7) });
      scene.add(this.ocean.mesh);
      this.ocean.mesh.receiveShadow = false;

      // Sonnenrichtung an Meer weiterreichen (Sonne ist fix)
      this.sunDir = scene.sunLight.position.clone().normalize();
      this.ocean.uniforms.uSunDir.value.copy(this.sunDir);

      // Ziel-Marker (für Training) - Ring auf dem Wasser
      this.targetMarker = makeTargetMarker();
      this.targetMarker.visible = false;
      scene.add(this.targetMarker);

      // Physik (Schiff wird gleich gesetzt)
      this.boat = new BoatDynamics({
         heading: 0,
         x: 0,
         z: 0,
         autoTrim: true,
         vessel: getVessel("yacht"),
      });

      // Wind
      this.wind = new Wind({ dir: 0, speed: 12, gust: 0.5, veer: 0.4, variability: 1 });
      this.manualTrim = false;

      // Kamera-Regie
      this.cam = new CameraRig(this.camera, this.renderer.domElement);
      this.cam.mode = "CHASE";

      // Eingabe
      this.controls = new Controls(document);

      // UI
      this.ui = new UI(this.dom, compassC, menuEl, document.body);
      this.ui.compass.width = 160;
      this.ui.compass.height = 160;

      // Geschuetze
      this.battery = new Battery(scene.scene);

      // Schiff (Modell + Physik-Profil + Kamera + Batterie)
      this.yacht = null;
      this.vessel = null;
      this.vesselId = null;
      this.setVessel("yacht");

      // Regatta-Kurs
      this.course = new Course(scene.scene, { x: 0, z: 0 });

      // Trainer (wird von setVessel an das Schiff angepasst)
      this.trainState = null;
      this.trainDoneTimer = 0;

      // Modus
      this.mode = "Freeride";
      this.gusts = true;
      this.hudVisible = true;

      // Ziel-Boje-Anker für Trainings-Aufgabe 7
      this.trainTarget = { x: 0, z: 500 };

      // Time
      this.t = 0;
      this._last = performance.now();

      this._bindMenu();
      this._onResize = () => this._resize();
      window.addEventListener("resize", this._onResize);

      // Zuerst Menü anzeigen
      this.openMenu();
   }

   // Schiff wechseln: 3D-Modell, Physik-Profil, Kamera, Batterie, Trainer.
   setVessel(id) {
      const v = getVessel(id);
      if (this.vesselId === v.id && this.yacht) return this.vessel;
      if (this.yacht) {
         this.scene.remove(this.yacht);
         disposeTree(this.yacht);
      }
      this.vessel = v;
      this.vesselId = v.id;

      const model = v.rig === "square" ? buildWarship(v) : buildSailboat();
      model.scale.setScalar(1.0);
      this.scene.add(model);
      this.yacht = model;

      // Sonnenrichtung an alle Segel-Shader weiterreichen
      for (const sail of model.userData.sails || []) {
         const u = sail.material && sail.material.uniforms;
         if (u && u.uSunDir) u.uSunDir.value.copy(this.sunDir);
      }

      this.boat.setVessel(v);
      this.boat.sailSet = 1;
      this.cam.setVessel(v.cam);
      this.battery.setShip(model, v);
      this.trainer = makeTrainer(v);
      this.recoilRoll = 0;
      return v;
   }

   openMenu() {
      this.menuOpen = true;
      this.paused = true;
      this.ui.openMenu({
         mode: this.mode,
         vesselId: this.vesselId,
         windDir: this.wind.baseDir,
         windSpeed: this.wind.baseSpeed,
         gusts: this.gusts,
         onWindChange: (dir, speed, gusts) => {
            this.wind.baseDir = dir;
            this.wind.baseSpeed = speed;
            this.gusts = gusts;
            this.wind.variability = gusts ? 1 : 0;
            this.ocean.windKts = speed;
         },
         // Live-Vorschau: das Schiff wird schon im Menue gewechselt
         onVesselChange: (id) => this.setVessel(id),
         onStart: (mode, dir, speed, gusts, vesselId) =>
            this.startMode(mode, dir, speed, gusts, vesselId),
         onHelp: () => this._showHelp(),
      });
   }

   _showHelp() {
      const help = document.createElement("div");
      help.id = "help";
      help.innerHTML =
         `<div class="help-card" style="pointer-events:auto">
           <h2>Hilfe & Steuerung</h2>
           <h3>Grundregeln der Segelphysik</h3>
           <p>Der <b>Segelkurs (TWA)</b> ist der Winkel zwischen Bootskurs und Wind.
           Gegen den Wind (Upwind) segelt man nie in 0°, sondern in <i>Krausen</i> (~45°) und wendet (Halse).
           Der schnellste Windkurs ist der <i>Raumschot</i> (Beam, ~90°).
           Downwind (Raumschot/Raum) segelt man tiefer (~135°) als direkt vor dem Wind (180°).</p>
           <h3>Rahsegler der Royal Navy</h3>
           <p>Ein Rahsegler (Sloop, Fregatte, Linienschiff) kommt nur etwa
           <b>sechs Strich</b> — rund 65° — an den Wind heran; darunter liegen die
           Segel back und das Schiff verliert Fahrt. Die <b>Rahen werden gebrasst</b>:
           je spitzer der Wind, desto schräger stehen sie, bis bei 45° die Takelage
           nicht mehr mitgeht. Am schnellsten laeuft so ein Schiff mit dem Wind
           schräg von achtern (Backstagsbrise, ~135°). Masse bedeutet Trägheit:
           anluven, abfallen und wenden dauern lange — vorausdenken.</p>
           <h3>Geschütze</h3>
           <p>Die Batterie feuert seitwaerts. <b>Q</b> gibt die Backbord-Breitseite,
           <b>E</b> die Steuerbord-Breitseite, <b>F</b> beide. Die Bedienungen lösen
           versetzt aus, das Schiff bekommt einen Rückstoß-Krängungsstoß, und der
           Pulverrauch treibt mit dem Wind ab — zu Lee steht man schnell im eigenen
           Qualm. Nachladen dauert je nach Schiff 9 bis 13 Sekunden.</p>
           <h3>Steuerung</h3>
           <ul style="margin:6px 0 0 18px">
             <li><b>A / D</b> oder <b>← / →</b> : Ruder (Backbord / Steuerbord)</li>
             <li><b>W / S</b> : Segel trimmen (ein / aus) — bei manueller Trimmung</li>
             <li><b>C</b> / <b>1–4</b> : Kamera (Verfolger, Cockpit, Draufsicht, Orbit)</li>
             <li><b>M</b> / <b>Esc</b> : Menü · <b>R</b> : Kurs/Training neu · <b>G</b> : Gusts</li>
             <li><b>Q / E / F</b> : Breitseite Backbord / Steuerbord / beide</li>
             <li><b>V</b> : Schiff wechseln &nbsp;·&nbsp; <b>W / S</b> : bei Rahseglern Segel setzen / reffen</li>
             <li><b>Leertaste</b> : Boot nach Kenter aufrichten</li>
             <li><b>Mausrad</b> : Zoom · <b>Ziehen</b> : Ansicht drehen</li>
           </ul>
           <p style="margin-top:12px"><b class="prim">Tipp:</b> Halte dich an den Kompass.
           Der rote Pfeil = Boot, der blaue = Wind (woher), der türkise = scheinbarer Wind.</p>
           <button class="help-close" style="margin-top:14px;padding:10px 22px;border-radius:10px;border:0;background:#3da3ff;color:#061019;font-weight:700;cursor:pointer">Verstanden</button>
         </div>`;
      document.body.appendChild(help);
      help.style.display = "flex";
      const close = () => help.remove();
      help.querySelector(".help-close").onclick = close;
      help.onclick = (e) => {
         if (e.target === help) close();
      };
   }

   startMode(mode, dir, speed, gusts, vesselId) {
      if (vesselId) this.setVessel(vesselId);
      this.mode = mode;
      this.wind.baseDir = dir;
      this.wind.baseSpeed = speed;
      this.gusts = gusts;
      this.wind.variability = gusts ? 1 : 0;
      this.ocean.windKts = speed;
      this.ui.closeMenu();
      this.menuOpen = false;
      this.paused = false;
      this._placeAtStart(mode);
      this.battery.clear();
      this.course.setVisible(mode === "Regatta");
      this.ui.showMessage(
         vesselLabel(this.vessel) + " klar zum Auslaufen — " + this.vessel.rate);
      if (mode === "Regatta") {
         this.course.reset();
         this.ui.setTraining(null);
         this.trainState = null;
         this.yacht.visible = true;
      }
      if (mode === "Training") {
         this.yacht.visible = true;
         this.trainer.reset();
         this.trainer.setIndex(0);
         const c = this.trainer.current;
         this._updateTrainTarget(c);
         this.ui.setTraining({
            title: c.title,
            desc: c.desc,
            hint: c.hint,
            progress: 0,
            done: false,
         });
      }
      if (mode === "Freeride") {
         this.ui.setTraining(null);
         this.trainState = null;
         this.targetMarker.visible = false;
         this.yacht.visible = true;
      }
   }

   _placeAtStart(mode) {
      const V = this.vessel;
      // Kein Start mitten im Wind: ein Rahsegler kaeme dort nie heraus.
      // Regatta beginnt am Wind auf dem besten Kreuzkurs, sonst auf Raumschot.
      const startTwa = mode === "Regatta"
         ? V.sail.noGo + 8
         : (V.rig === "square" ? 110 : 90);
      // twa = windDir - heading  ->  heading = windDir - twa (Wind von Steuerbord)
      this.boat.heading = normDeg(this.wind.baseDir - startTwa);
      this.boat.heel = 0;
      this.boat.pos.x = 0;
      this.boat.pos.z = mode === "Regatta" ? -30 - V.hull.loa * 1.2 : 0;
      this.boat.sailSet = 1;
      this.boat.tack = "STBD";
      this.boat.leeway = 0;
      // Mit ein wenig Fahrt im Schiff anfangen - sonst duempelt ein
      // Linienschiff zwei Minuten lang vor sich hin, bevor etwas passiert.
      this.boat.speed = polarSpeedAt(
         startTwa, this.wind.baseSpeed, 1, 1, V.sail.polar) * 0.55;
      this.boat.groundHeading = this.boat.heading;
   }

   setWind(dir, speed, gusts) {
      this.wind.baseDir = dir;
      this.wind.baseSpeed = speed;
      this.gusts = gusts;
      this.wind.variability = gusts ? 1 : 0;
      this.ocean.windKts = speed;
   }

   // Wellenausbreitung in Rad: Wellen laufen mit dem Wind (dorthin, wohin er weht)
   _waveRad() {
      return normDeg(this.wind.dir + 180) * DEG;
   }

   _seaAmp() {
      return ampForWind(this.wind.speed);
   }

   _updateTrainTarget(c) {
      if (c && c.target) {
         this.trainTarget = c.target;
         this.targetMarker.visible = true;
         this.targetMarker.position.set(c.target.x, 0.2, c.target.z);
      } else {
         this.targetMarker.visible = false;
      }
   }

   _bindMenu() {
      // nix
   }

   _resize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
   }

   step(dt) {
      // --- Menü-Pause: keine Physik, nur Wasser/Boot/Himmel ---
      if (this.menuOpen || this.paused) {
         this.t += dt;
         this.ocean.update(this.t, this.camera.position, this.boat.pos.x, this.boat.pos.z,
            this.wind.baseSpeed, this._waveRad());
         this.renderer.render(this.scene.scene, this.camera);
         return;
      }

      // Zeit
      this.t += dt;
      this.wind.update(dt, this.t);

      // Eingabe
      const inp = this.controls.read(dt);
      this._handleQueue();
      const trim = this.manualTrim ? this.boat.trim : null;
      this.boat.setRudder(inp.rudder);
      if (this.vessel.rig === "square") {
         // W / S setzen bzw. reffen die Segel (mehr Tuch = mehr Fahrt und Krengung)
         if (inp.trimIn) this.boat.sailSet = clamp(this.boat.sailSet + dt * 0.45, 0.25, 1);
         if (inp.trimOut) this.boat.sailSet = clamp(this.boat.sailSet - dt * 0.45, 0.25, 1);
      } else if (!this.manualTrim) {
         if (inp.trimIn) this.boat.trim = clamp(this.boat.trim + dt * 0.4, 0, 1);
         if (inp.trimOut) this.boat.trim = clamp(this.boat.trim - dt * 0.4, 0, 1);
      }

      if (this.boat.isCapsized) {
         if (inp.queue && inp.queue.includes("capsizeRight")) {
            this.boat.rightBoat();
            this.ui.showMessage("Aufgerichtet — weiter segeln!");
         }
         this.boat.step(dt, this._windObj(), trim);
      } else {
         this.boat.step(dt, this._windObj(), trim);
      }

      // 3D-Boot-Position / -Haltung (auf dem Wasser)
      this._placeBoat(dt);

      // Segelstellung zum Wind: Baumwinkel aus dem scheinbaren Wind (AwA).
      // Bei Wind von Steuerbord schwenkt der Baum nach Backbord (Leeseite) und
      // umgekehrt - eng am Wind fast mittschiffs, vor dem Wind fast 90° raus.
      const aw = this.boat.appWind(this._windObj());
      const awaRel = diffDeg(this.boat.heading, aw.from); // + = Wind von Steuerbord
      const awaAbs = Math.abs(awaRel);
      const boomMag = clamp((awaAbs - 30) * 0.72, 4, 88);
      const boomAngleDeg = (awaRel > 0 ? -1 : 1) * boomMag;

      this.yacht.animate(dt, {
         rudderAngle: this.boat.rudder * 35,
         boomAngleDeg,
         luffing: this.boat.luffing ? 1 : 0,
         windKts: this.wind.speed,
         awaRel,
         sailSet: this.boat.sailSet,
         time: this.t,
      });

      // Geschuetze: Rauch, Kugeln, Nachladen
      const wr2 = this._waveRad();
      const amp2 = this._seaAmp();
      this.battery.update(dt, {
         windDir: this.wind.dir,
         windSpeed: this.wind.speed,
         seaHeight: (x, z) => seaHeight(x, z, this.t, wr2, amp2) * 0.9,
      });

      // Ozean (See/Wellen folgen dem Boot und der Windrichtung)
      this.ocean.update(this.t, this.camera.position, this.boat.pos.x, this.boat.pos.z,
         this.wind.speed, this._waveRad());

      // Kamera
      this.cam.update(dt, {
         heading: this.boat.heading,
         pos: this.boat.pos,
         heel: this.boat.heel,
      });

      // Modus-spezifische Logik
      let msg = "";
      if (this.mode === "Regatta") {
         const res = this.course.update(this.boat.pos);
         this._courseUI = res;
         if (res.message) msg = res.message;
      } else if (this.mode === "Training") {
         this._updateTraining(dt);
      }

      // UI
      this._updateUI(msg);

      // Render
      this.renderer.render(this.scene.scene, this.camera);
   }

   _windObj() {
      return { dir: this.wind.dir, speedKts: this.wind.speed };
   }

   // Notfall-Rendering: falls ein Frame-Fehler auftritt, trotzdem ein Bild zeigen
   renderOnly() {
      try {
         this.t += 0.016;
         this.ocean.update(this.t, this.camera.position, this.boat.pos.x, this.boat.pos.z,
            this.wind.baseSpeed, this._waveRad());
         this._placeBoat(0.016);
      } catch (e) {
         // Boot-Platzierung überspringen, nur Meer + Himmel rendern
      }
      try {
         this.renderer.render(this.scene.scene, this.camera);
      } catch (e) {
         console.error("[segel-simulator] renderOnly:", e);
      }
   }

   _handleQueue() {
      const q = this.controls.drain();
      for (const ev of q) {
         switch (ev) {
            case "cycleCamera":
               this.cam.cycle();
               break;
            case "camChase":
               this.cam.setMode("CHASE");
               break;
            case "camCockpit":
               this.cam.setMode("COCKPIT");
               break;
            case "camTop":
               this.cam.setMode("TOP");
               break;
            case "camOrbit":
               this.cam.setMode("ORBIT");
               break;
            case "toggleTopdown":
               this.cam.setMode(this.cam.mode === "TOP" ? "CHASE" : "TOP");
               break;
            case "restart":
               this._restartCurrent();
               break;
            case "toggleGusts":
               this.gusts = !this.gusts;
               this.wind.variability = this.gusts ? 1 : 0;
               break;
            case "toggleHud":
               this.hudVisible = !this.hudVisible;
               this.ui.hudVisible = this.hudVisible;
               break;
            case "toggleMenu":
               this.openMenu();
               break;
            case "capsizeRight":
               if (this.boat.isCapsized) {
                  this.boat.rightBoat();
                  this.ui.showMessage("Aufgerichtet — weiter segeln!");
               }
               break;
            case "firePort":
               this._fire("PORT");
               break;
            case "fireStbd":
               this._fire("STBD");
               break;
            case "fireBoth":
               this._fire("PORT");
               this._fire("STBD");
               break;
            case "cycleVessel": {
               const i = VESSELS.findIndex((v) => v.id === this.vesselId);
               const nxt = VESSELS[(i + 1) % VESSELS.length];
               this.setVessel(nxt.id);
               if (this.mode === "Training") {
                  this.trainer.setIndex(0);
                  const c = this.trainer.current;
                  this._updateTrainTarget(c);
                  this.ui.setTraining({ title: c.title, desc: c.desc, hint: c.hint, progress: 0, done: false });
               }
               this.ui.showMessage("An Bord: " + vesselLabel(nxt) + " · " + nxt.rate);
               break;
            }
            default:
               break;
         }
      }
   }

   // Breitseite: nur bewaffnete Schiffe, nicht gekentert, nicht im Menue
   _fire(side) {
      if (!this.vessel.guns) {
         this.ui.showMessage("Die " + this.vessel.name + " führt keine Geschütze.");
         return false;
      }
      if (this.boat.isCapsized) return false;
      if (!this.battery.ready(side)) return false;
      const ok = this.battery.fire(side, {
         windDir: this.wind.dir,
         windSpeed: this.wind.speed,
      });
      if (ok) {
         const n = this.battery.gunsPerSide();
         this.ui.showMessage(
            (side === "PORT" ? "Backbord" : "Steuerbord") + "-Breitseite — " + n + " Rohre!");
      }
      return ok;
   }

   _restartCurrent() {
      this.battery.clear();
      if (this.mode === "Regatta") {
         this.course.reset();
         this._placeAtStart("Regatta");
         this.ui.showMessage("Neuer Kurs!");
      } else if (this.mode === "Training") {
         this.trainer.reset();
         const c = this.trainer.current;
         this._updateTrainTarget(c);
         this.ui.setTraining({
            title: c.title,
            desc: c.desc,
            hint: c.hint,
            progress: 0,
            done: false,
         });
         this._placeAtStart("Training");
         this.ui.showMessage("Übung zurückgesetzt: " + c.title);
      }
   }

   _updateTraining(dt) {
      const boat = this.boat;
      const state = {
         boat: {
            twa: boat.twa,
            twaSigned: boat.twaSigned,
            tack: boat.tack,
            luffing: boat.luffing,
            speed: boat.speed,
            capsize: boat.isCapsized,
            heading: boat.heading,
            pos: boat.pos,
         },
         wind: { dir: this.wind.dir, speed: this.wind.speed },
         t: this.t,
      };
      this.trainState = this.trainer.update(state, dt);
      const tr = this.trainState;
      if (tr.done && this.trainDoneTimer <= 0) {
         this.ui.showMessage("✅ " + tr.title + " — geschafft! Nächste folgt…");
         this.trainDoneTimer = 2.5;
         this.trainer.next();
         const nc = this.trainer.current;
         this._updateTrainTarget(nc);
         this.ui.setTraining({
            title: nc.title,
            desc: nc.desc,
            hint: nc.hint,
            progress: 0,
            done: false,
         });
         this._placeAtStart("Training");
      }
      if (this.trainDoneTimer > 0) this.trainDoneTimer -= dt;
      this.ui.setTraining({
         title: tr.title,
         desc: tr.desc,
         hint: tr.hint,
         progress: tr.progress,
         done: tr.done,
      });
   }

   _placeBoat(dt) {
      const p = this.boat.pos;
      const wr = this._waveRad();
      const amp = this._seaAmp();

      // Auftrieb: exakt auf der sichtbaren Gerstner-Welle
      const hy = seaHeight(p.x, p.z, this.t, wr, amp) * 0.9;
      this.yacht.position.set(p.x, hy, p.z);
      this.yacht.rotation.y = this.boat.heading * DEG;

      // Krängung: Wind von Steuerbord -> Schiff krängt nach Backbord (Lee)
      const heelSide = this.boat.twaSigned > 0 ? 1 : -1;

      // Schiffsmasse: grosse Rahsegler reagieren traeger auf die Seegangsneigung
      const loa = this.vessel.hull.loa;
      const halfBeam = this.vessel.hull.beam / 2;
      const probe = loa * 0.36;
      const massDamp = clamp(11 / loa, 0.32, 1); // Yacht = 1, Linienschiff ~0.32

      // Roll aus dem Wellenhang querab (echte Wellenneigung, nicht Zufall)
      const port = dirVec(this.boat.heading - 90);
      const stbd = dirVec(this.boat.heading + 90);
      const hP = seaHeight(p.x + port.x * halfBeam, p.z + port.z * halfBeam, this.t, wr, amp);
      const hS = seaHeight(p.x + stbd.x * halfBeam, p.z + stbd.z * halfBeam, this.t, wr, amp);
      const waveRoll = (hS - hP) * 0.18 * massDamp;

      // Rückstoss der Breitseite: kurzer Krengungsstoss zur Gegenseite
      const kick = this.battery.rollKick * this.battery.rollKickSide;
      this.recoilRoll = lerp(this.recoilRoll || 0, kick, clamp(dt * 9, 0, 1));

      this.yacht.userData.heeler.rotation.z =
         heelSide * THREE.MathUtils.degToRad(this.boat.heel)
         + waveRoll
         + THREE.MathUtils.degToRad(this.recoilRoll);

      // Pitch aus dem Wellenhang vor dem Bug / hinter dem Heck
      const ahead = dirVec(this.boat.heading);
      const astern = dirVec(this.boat.heading + 180);
      const hA = seaHeight(p.x + ahead.x * probe, p.z + ahead.z * probe, this.t, wr, amp);
      const hB = seaHeight(p.x + astern.x * probe, p.z + astern.z * probe, this.t, wr, amp);
      this.yacht.userData.heeler.rotation.x =
         clamp(-(hA - hB) * 1.4 * massDamp / Math.max(probe / 4, 1), -0.18, 0.18);
   }

   _updateUI(msg) {
      const b = this.boat;
      const wind = this._windObj();
      const aw = b.appWind(wind);
      const state = {
         mode: this.mode,
         wind: {
            dir: wind.dir,
            speed: wind.speedKts,
            bft: beaufortOf(wind.speedKts),
            name: beaufortName(wind.speedKts),
         },
         awa: { from: aw.from, speed: aw.speed },
         boat: {
            speed: b.speed,
            twa: b.twa,
            tack: b.tack,
            luffing: b.luffing,
            heading: b.heading,
            capsize: b.isCapsized,
            rudder: b.rudder,
            vmgUp: vmgUp(b.twa, b.speed),
            vmgDown: vmgDown(b.twa, b.speed),
         },
         pos: pointOfSail(b.twa, b.luffing, this.vessel.rig, this.vessel.sail.noGo),
         noGo: this.vessel.sail.noGo,
         vessel: this.vessel,
         guns: this.battery.status(),
         sailSet: b.sailSet,
         camera: CAM_LABEL[this.cam.mode],
         gusts: this.gusts,
         message: msg || (this._courseUI && this._courseUI.message) || "",
         course: this.mode === "Regatta" ? this._courseUI : null,
      };
      this.ui.update(state);
      this.ui.hudVisible = this.hudVisible;
   }

   togglePause() {
      this.paused = !this.paused;
      if (this.paused) this.openMenu();
      else this.ui.closeMenu();
   }
}

// ---------- Aufraeumen beim Schiffswechsel ----------
function disposeTree(root) {
   root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
      else if (m && m.dispose) m.dispose();
   });
}

// ---------- Wasser-Ziel-Marker (Ring + Boje) ----------
function makeTargetMarker() {
   const g = new THREE.Group();
   const ring = new THREE.Mesh(
      new THREE.TorusGeometry(8, 0.4, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0xffe680, emissive: 0xffcc00, emissiveIntensity: 0.4 })
   );
   ring.rotation.x = Math.PI / 2;
   ring.position.y = 0.5;
   g.add(ring);
   const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.3, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0xd23b3b })
   );
   pole.position.y = 2;
   g.add(pole);
   return g;
}