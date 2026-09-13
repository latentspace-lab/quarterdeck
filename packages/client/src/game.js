// game.js - Simulation: bindet Szene, Boot, Physik, Kamera, Steuerung, Modi, UI
import * as THREE from "three";
import { createOcean, seaHeight, ampForWind, waveHeightForWind, seaStateName } from "./ocean.js";
import { SeaState, SIM_DT } from "@segel/shared";
import { createScene } from "./scene.js";
import { getVessel, VESSELS, vesselLabel } from "./vessels.js";
import { Ship } from "./ship.js";
import { Fleet, SCENARIOS, scenarioFor } from "./fleet.js";
import { DebrisField } from "./debris.js";
import { createTerrain } from "./terrain.js";
import * as collide from "./collide.js";
import { AMMO, AMMO_ORDER } from "./damage.js";
import { BoatDynamics, pointOfSail, vmgUp, vmgDown, polarSpeedAt } from "./physics.js";
import { Wind, beaufortName, beaufortOf } from "./wind.js";
import { CameraRig } from "./camera.js";
import { Controls } from "./controls.js";
import { Course } from "./marks.js";
import { makeTrainer } from "./trainer.js";
import { UI } from "./ui.js";
// Fehlte seit dem Zusammenfuehren der Sprachansagen: game.js ruft
// voiceAnnounce()/TRIGGER auf, ohne sie zu importieren. openMenu() laeuft im
// Konstruktor - die ReferenceError hat die Simulator-Erzeugung abgebrochen und
// damit das ganze Spiel.
import { voiceAnnounce, TRIGGER } from "./audio.js";
import { DEG, clamp, lerp, normDeg, dirVec, diffDeg } from "./utils.js";
import { MultiplayerSession } from "./net/MultiplayerSession.js";
import { defaultServerUrl, listRooms } from "./net/NetClient.js";

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

      // Target marker (for training) — ring on the water
      this.targetMarker = makeTargetMarker();
      this.targetMarker.visible = false;
      scene.add(this.targetMarker);

      // Wrackteile (eigene Starrkoerper-Simulation)
      this.debris = new DebrisField(scene.scene, { max: 420 });

      // Land und Untiefen
      this.terrain = createTerrain(scene.scene);
      this.terrain.setVisible(false);

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
      // The orders panel in the HUD speaks the same language as the keyboard.
      this.ui.onCommand = (cmd) => this.controls.queue.push(cmd);
      this.ui.onHold = (code, down) => { this.controls.keys[code] = !!down; };
      this.ui.compass.width = 160;
      this.ui.compass.height = 160;

      // Every ship in the water (player first): battery targets, debris
      // anchors, pose interpolation. In multiplayer the others are the
      // session's remote ships.
      this.session = null;
      this.allShips = () => [
         this.player,
         ...this.fleet.ships,
         ...(this.session ? this.session.remoteShips() : []),
      ].filter((s) => s && s.alive);
      this._targets = () => this.allShips().map((s) => s.targetInfo());
      this._onHit = (h) => this._handleHit(h);

      // Gegnerische Schiffe
      this.fleet = new Fleet({
         scene,
         debris: this.debris,
         targets: this._targets,
         onHit: this._onHit,
      });

      // Spielerschiff
      this.player = null;
      this.vessel = null;
      this.vesselId = null;
      this.scenarioId = "single";
      this.setVessel("yacht");

      // Regatta-Kurs
      this.course = new Course(scene.scene, { x: 0, z: 0 });

      // Trainer (wird von setVessel an das Schiff angepasst)
      this.trainState = null;
      this.trainDoneTimer = 0;

      // Modus
      // Der Seegang folgt dem Wind nur traege: eine See baut sich auf und
      // laeuft langsamer wieder ab. Sonst wuerde jede Boe die Wellen pumpen.
      // Phase 0: der Zustand (nachlaufender Wind + Wellenphase) sitzt in
      // SeaState und wird mit festem Schritt integriert. In Phase 1 kommt er
      // vom Server (SeaSync) - Trefferpruefung und Bild muessen auf derselben
      // Welle stehen.
      this.sea = new SeaState(12);
      this._groundMsg = 0;
      this._battleOver = false;
      this._lockMsg = false;
      this._uiMsg = "";
      this.mode = "Freeride";
      this.gusts = true;
      this.hudVisible = true;

      // Train target buoy anchor for training task 7
      this.trainTarget = { x: 0, z: 500 };

      // Time
      this.t = 0;
      this._last = performance.now();

      this._bindMenu();
      this._onResize = () => this._resize();
      window.addEventListener("resize", this._onResize);

      // Show menu first
      this.openMenu();

      // ?mp=1&server=ws://host:2567&vessel=lydia&name=…&room=…&enemies=a,b
      //   &roomName=…&mode=practice
      // joins a battle straight away - for links and for the browser tests.
      const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
      if (q.get("mp") === "1") {
         this.startMultiplayer({
            url: q.get("server") || defaultServerUrl(location),
            vesselId: q.get("vessel") || "lydia",
            name: q.get("name") || "",
            roomId: q.get("room") || undefined,
            mode: ["practice", "regatta"].includes(q.get("mode")) ? q.get("mode") : "battle",
            create: {
               enemies: q.get("enemies") ? q.get("enemies").split(",") : undefined,
               roomName: q.get("roomName") || undefined,
            },
         }).catch((e) => this.ui.showMessage("Could not join: " + (e && e.message ? e.message : e)));
      }
   }

   // ------------------------------------------------------------------
   // Multiplayer: this Simulator becomes one player's view of a server room.
   // The local ship keeps its own physics for a responsive helm; everything
   // else - other ships, wind, sea, damage - is the server's.
   // ------------------------------------------------------------------
   async startMultiplayer(opts) {
      if (this.session) await this.session.stop();
      this.setVessel(opts.vesselId || this.vesselId);
      this.fleet.clear();
      this.debris.clear();
      this.battery.clear();
      this.course.setVisible(false);
      this.ui.setTraining(null);
      this.trainState = null;
      this.targetMarker.visible = false;
      this._lockMsg = false;
      this._groundMsg = 0;

      this.session = new MultiplayerSession(this);
      this.ui.showMessage("Connecting to " + opts.url + " …");
      try {
         await this.session.start(opts);
      } catch (e) {
         this.session = null;
         throw e;
      }
      this.mode = "Multiplayer";
      this.gusts = this.wind.variability > 0;
      // A regatta room: show its course where the server has it.
      const race = this.session.mode === "regatta";
      if (race && this.session.course) this.course.moveTo(this.session.course.origin);
      this.course.setVisible(race);
      this._courseUI = null;
      this.ui.closeMenu();
      this.menuOpen = false;
      this.paused = false;
      this.yacht.visible = true;
      this.ui.showMessage(vesselLabel(this.vessel) + " has joined "
         + (race ? "the regatta " : "room ") + this.session.net.roomId);
   }

   async leaveMultiplayer() {
      if (!this.session) return;
      const s = this.session;
      this.session = null;
      this.mode = "Freeride";
      await s.stop();
   }

   // Schiff wechseln: 3D-Modell, Physik-Profil, Kamera, Batterie, Trainer.
   // Bequeme Abkuerzungen, damit der uebrige Code unveraendert bleibt
   get boat() { return this.player ? this.player.dyn : null; }
   get yacht() { return this.player ? this.player.model : null; }
   get battery() { return this.player ? this.player.battery : null; }

   setVessel(id, force = false) {
      const v = getVessel(id);
      if (!force && this.vesselId === v.id && this.player) return this.vessel;
      const old = this.player;
      this.vessel = v;
      this.vesselId = v.id;

      this.player = new Ship({
         id: "player",
         vessel: v,
         scene: this.scene,
         debris: this.debris,
         targets: this._targets,
         onHit: this._onHit,
         isPlayer: true,
         heading: old ? old.dyn.heading : 0,
         x: old ? old.pos.x : 0,
         z: old ? old.pos.z : 0,
      });
      if (old) {
         this.debris.cutTethers(old.id);
         old.dispose();
      }

      // Sonnenrichtung an alle Segel-Shader weiterreichen
      for (const sail of this.player.model.userData.sails || []) {
         const u = sail.material && sail.material.uniforms;
         if (u && u.uSunDir) u.uSunDir.value.copy(this.sunDir);
      }

      this.cam.setVessel(v.cam);
      this.trainer = makeTrainer(v);
      return v;
   }

   // ------------------------------------------------------------------
   // Treffer: das getroffene Schiff bucht den Schaden und wirft Splitter
   // ------------------------------------------------------------------
   _handleHit(hit) {
      const ship = hit.target && hit.target.ship;
      if (!ship || !ship.alive) return;
      const res = ship.takeHit(hit);
      if (!res) return;
      if (ship === this.player) {
         // Der Spieler soll spueren, dass er getroffen wurde
         this.cam.shake(hit.inRig ? 0.25 : 0.6);
      }
   }

   openMenu() {
      this.menuOpen = true;
      this.paused = true;
      voiceAnnounce(TRIGGER.ahoi);
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
            this.sea.snapTo(speed);
         },
         // Live-Vorschau: das Schiff wird schon im Menue gewechselt
         scenarioId: this.scenarioId,
         scenarios: SCENARIOS,
         onScenarioChange: (id) => { this.scenarioId = id; },
         onVesselChange: (id) => this.setVessel(id),
         onStart: (mode, dir, speed, gusts, vesselId, scenarioId) => {
            if (scenarioId) this.scenarioId = scenarioId;
            if (this.session) this.leaveMultiplayer();
            this.startMode(mode, dir, speed, gusts, vesselId);
         },
         multiplayer: {
            url: (this.session && this.session.net && this.session.net.url) || defaultServerUrl(location),
            name: this._mpName || "",
            roomId: "",
            roomName: "",
            mode: (this.session && this.session.mode) || "battle",
            connected: !!(this.session && this.session.connected),
         },
         onListRooms: (url) => listRooms(url),
         onJoin: (o) => {
            this._mpName = o.name;
            this.startMultiplayer(o).catch((e) => {
               this.ui.showMessage("Could not join: " + (e && e.message ? e.message : e));
            });
         },
         onResume: () => {
            // Back from the pause menu into the running battle.
            this.ui.closeMenu();
            this.menuOpen = false;
            this.paused = false;
         },
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
           Sailing against the wind (upwind), you never point at 0° — you sail in <i>luffing</i> (~45°) and tack.
           The fastest point of sail is <i>beam reach</i> (~90°).
           Downwind you sail deeper (~135°) than directly before the wind (180°).</p>
           <h3>Royal Navy Square-Rigged Ships</h3>
           <p>A square-rigged ship (Sloop, Frigate, Ship of the Line) can only point about
           <b>six points</b> — roughly 65° — into the wind; darunter liegen die
           Segel back und das Schiff verliert Fahrt. The <b>yards are braced</b>:
           the sharper the wind angle, the more oblique the yards — until at 45° the rigging
           cannot follow. The fastest running point is with the wind
           well aft (backstays' breeze, ~135°). Mass means inertia:
           luffing, bearing away, and tacking take a long time — think ahead.</p>
           <h3>Gunnery</h3>
           <p>The battery fires to the sides. <b>Q</b> fires the port broadside,
           <b>E</b> the starboard, <b>F</b> both. The crews fire in sequence, the ship gets a recoil-heel impulse, and the
           powder smoke drifts with the wind — standing to leeward you are quickly in
           your own smoke. Reloading takes 60 to 75 seconds depending on the ship, longer with a thinned crew.</p>
           <h3>Battle, Damage and Wreck</h3>
           <p>In <b>Battle</b> mode a French enemy stands to windward.
           <b>Z</b> changes the load: <i>Round shot</i> into the hull (leaks, guns,
           eventually sinks), <i>Chain shot</i> into the rigging (masts and sails —
           the French way to cripple a ship and escape),
           <i>Grape shot</i> only at pistol-shot range.</p>
           <p>A fallen mast takes its sail area with it and hangs in the
           standing rigging <b>alongside</b> — the ship slows and lists toward the
           wreck side. <b>X</b> cuts the shrouds and clears the wreck.
           Oak sides swallow many round shot, but a ball at or below the waterline
           opens a leak. The pumps hold a few leaks; too many, and she sinks. Too much sail in a storm carries away the topmasts,
           and on a reef the keel breaks open.</p>
           <h3>Controls</h3>
           <ul style="margin:6px 0 0 18px">
             <li><b>A / D</b> or <b>← / →</b> : Rudder (Port / Starboard)</li>
             <li><b>W / S</b> : Trim sails (in / out) — for manual trimming</li>
             <li><b>C</b> / <b>1–4</b> : Camera (Follow, Cockpit, Top-Down, Orbit)</li>
             <li><b>M</b> / <b>Esc</b> : Menu · <b>H</b> : Hide / show the HUD · 
             <b>R</b> : Restart course/training · <b>G</b> : Gusts</li>
             <li><b>Q / E / F</b> : Port / Starboard / Both broadsides</li>
             <li><b>Z</b> : Change load &nbsp;·&nbsp; <b>X</b> : Cut away wreck</li>
             <li><b>V</b> : Change ship &nbsp;·&nbsp; <b>W / S</b> : set / reef sails on square-riggers</li>
             <li><b>Space</b> : Right the boat after capsize</li>
             <li><b>Mouse wheel</b> : Zoom · <b>Drag</b> : Rotate view</li>
             <li><b>Orders panel</b> (bottom right) : every command as a button — hold the helm and sail buttons.</li>
           </ul>
           <p style="margin-top:12px"><b class="prim">Tipp:</b> Halte dich an den Kompass.
           The red arrow = ship, the blue = wind (from where), the turquoise = apparent wind.</p>
           <button class="help-close" style="margin-top:14px;padding:10px 22px;border-radius:10px;border:0;background:#3da3ff;color:#061019;font-weight:700;cursor:pointer">Got it</button>
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
      this.sea.snapTo(speed);
      this.ui.closeMenu();
      this.menuOpen = false;
      this.paused = false;
      this._placeAtStart(mode);
      this.battery.clear();
      this.debris.clear();
      this.course.setVisible(mode === "Regatta");
      if (mode !== "Gefecht") {
         this.fleet.clear();
         this.terrain.setVisible(false);
      }
      this.ui.showMessage(
         vesselLabel(this.vessel) + " ready to get under way — " + this.vessel.rate);
      if (mode === "Regatta") {
         this.course.reset(this.t);
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
      if (mode === "Gefecht") {
         this.ui.setTraining(null);
         this.trainState = null;
         this.targetMarker.visible = false;
         this.yacht.visible = true;
         this._startBattle();
      }
   }

   _placeAtStart(mode) {
      const V = this.vessel;
      // Kein Start mitten im Wind: ein Rahsegler kaeme dort nie heraus.
      // Regatta beginnt am Wind auf dem besten Kreuzkurs, sonst auf Raumschot.
      const startTwa = mode === "Regatta"
         ? V.sail.noGo + 8
         : mode === "Gefecht" ? 100
         : (V.rig === "square" ? 110 : 90);
      // twa = windDir - heading  ->  heading = windDir - twa (Wind von Starboard)
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
      this.sea.snapTo(speed);
   }

   // Wellenausbreitung in Rad: Wellen laufen mit dem Wind (dorthin, wohin er weht)
   _waveRad() {
      return this.sea.windRad;
   }

   _seaAmp() {
      return this.sea.amp;
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

   // =====================================================================
   // Simulation - IMMER mit festem Schritt (SIM_DT).
   //
   // Alles, was den Spielzustand aendert, steht hier. Nichts davon haengt an
   // der Bildwiederholrate: derselbe Kommandostrom bei derselben Schrittweite
   // ergibt denselben Zustand - auf diesem Rechner, auf einem langsameren und
   // spaeter auf dem Server. Die Darstellung passiert getrennt in render().
   // =====================================================================
   stepFixed(dt) {
      // --- Menu pause: keine Physik, aber das Wasser lebt weiter ---
      if (this.menuOpen || this.paused) {
         this.t += dt;
         this.sea.step(dt, this.wind.speed, this.wind.dir);
         return;
      }

      // Zeit
      this.t += dt;
      this.wind.update(dt, this.t);

      // Eingabe
      const inp = this.controls.read(dt);
      this._handleQueue();
      // Die Ruderglaettung sitzt seit Phase 0B' geschlossen in
      // BoatDynamics.step() - hier geht nur noch das rohe Kommando rein.
      this.boat.setRudder(inp.rudder);
      if (this.vessel.rig === "square") {
         // W / S setzen bzw. reffen die Segel (mehr Tuch = mehr Fahrt und Krengung)
         if (inp.trimIn) {
            this.boat.sailSet = clamp(this.boat.sailSet + dt * 0.45, 0.25, 1);
            voiceAnnounce(TRIGGER.makesail);
         }
         if (inp.trimOut) this.boat.sailSet = clamp(this.boat.sailSet - dt * 0.45, 0.25, 1);
      } else if (!this.manualTrim) {
         if (inp.trimIn) this.boat.trim = clamp(this.boat.trim + dt * 0.4, 0, 1);
         if (inp.trimOut) this.boat.trim = clamp(this.boat.trim - dt * 0.4, 0, 1);
      }

      if (this.boat.isCapsized && inp.queue && inp.queue.includes("capsizeRight")) {
         this.boat.rightBoat();
         this.ui.showMessage("Aufgerichtet — weiter segeln!");
      }

      // ------------------------------------------------------------------
      // Welt-Schritt: Spieler, Gegner, Wrack, Kollisionen, Grund
      // ------------------------------------------------------------------
      // Zuerst das Wasser: Boot, Wrack und Geschosse rechnen danach mit exakt
      // derselben Oberflaeche wie der Shader.
      this.sea.step(dt, this.wind.speed, this.wind.dir);
      const seaFn = this.sea.sampler(0.9);
      const gunCtx = { windDir: this.wind.dir, windSpeed: this.wind.speed, seaHeight: seaFn };
      const worldCtx = {
         wind: this._windObj(), t: this.t, gunCtx,
         waveT: this.sea.phaseT, waveRad: this.sea.windRad,
         amp: this.sea.amp, lambda: this.sea.lambda,
      };

      worldCtx.crewLod = true;
      this.player.update(dt, worldCtx);
      this.player.battery.update(dt, gunCtx);

      if (this.mode === "Multiplayer") {
         this._stepMultiplayer(dt, inp, worldCtx, seaFn);
         return;
      }

      if (this.mode === "Gefecht") {
         // Besatzung nur auf Schiffen animieren, die man auch erkennen kann
         for (const e of this.fleet.ships) {
            e._crewNear = Math.hypot(e.pos.x - this.boat.pos.x, e.pos.z - this.boat.pos.z) < 420;
         }
         this.fleet.update(dt, { ...worldCtx, target: this.player });
      }

      // Kollisionen zwischen allen Schiffen
      const ships = this.allShips();
      if (ships.length > 1) {
         for (const ev of collide.step(ships, dt)) this._onWorldEvent(ev);
      }

      // Grundberuehrung (nur wo es Land gibt)
      if (this.terrain.visible) {
         for (const sh of ships) {
            const g = collide.groundStep(sh, this.terrain.depthAt, dt);
            if (g && sh === this.player && this._groundMsg <= 0) {
               this._groundMsg = 6;
               this.ui.showMessage(g.hard
                  ? "AUFGELAUFEN! Der Kiel sitzt fest — Wasser kommt ein."
                  : "Ground contact! Bear away immediately, the water is too shallow.");
            }
         }
      }
      if (this._groundMsg > 0) this._groundMsg -= dt;

      // Wrackteile treiben, sinken, schleppen
      const wv = dirVec(this.wind.dir + 180);
      this.debris.update(dt, {
         seaHeight: seaFn,
         windSpeed: this.wind.speed,
         windVec: wv,
         anchorOf: (id, local, out) => {
            const sh = this.allShips().find((a) => a.id === id);
            return sh ? sh.anchorPoint(local, out) : null;
         },
      });

      // Meldungen aus dem Schadensmodell
      for (const ev of this.player.drainEvents()) this._onShipEvent(ev);
      if (this.mode === "Gefecht") {
         for (const ev of this.fleet.drainEvents()) this._onShipEvent(ev);
      }

      // Modus-spezifische Logik
      let msg = "";
      if (this.mode === "Gefecht") {
         msg = this._updateBattle(dt);
      } else if (this.mode === "Regatta") {
         const res = this.course.update(this.boat.pos, this.t);
         this._courseUI = res;
         if (res.message) msg = res.message;
      } else if (this.mode === "Training") {
         this._updateTraining(dt);
      }
      this._uiMsg = msg;
   }

   /**
    * The multiplayer half of a step: send input, take in the server's state,
    * let the debris drift, turn server events into messages. Collisions,
    * grounding and enemy AI are the server's business here.
    */
   _stepMultiplayer(dt, inp, worldCtx, seaFn) {
      const S = this.session;
      if (!S) return;
      S.stepFixed(dt, inp);
      S.stepBatteries(dt, worldCtx.gunCtx);

      const wv = dirVec(this.wind.dir + 180);
      this.debris.update(dt, {
         seaHeight: seaFn,
         windSpeed: this.wind.speed,
         windVec: wv,
         anchorOf: (id, local, out) => {
            const sh = this.allShips().find((a) => a.id === id);
            return sh ? sh.anchorPoint(local, out) : null;
         },
      });

      // Our own ship's local model events (sails blown, mast wounded ...)
      for (const ev of this.player.drainEvents()) this._onShipEvent(ev);
      // What the server reports about everyone
      for (const ev of S.drainEvents()) {
         if (ev.kind === "ship" && (ev.type === "mark" || ev.type === "lap")) {
            if (ev.shipId === S.shipId) this.ui.showMessage(ev.message);
            else if (ev.type === "lap") {
               const who = S.findShip(ev.shipId);
               this.ui.showMessage((who ? who.name : "A rival") + " completes lap " + ev.lap + " in " + ev.lapTime.toFixed(1) + " s");
            }
         } else if (ev.kind === "ship") {
            const ship = ev.shipId === S.shipId ? this.player : S.findShip(ev.shipId);
            if (ship) this._onShipEvent({ ...ev, ship });
         } else if (ev.kind === "hit") {
            if (ev.shipId === S.shipId) {
               this.cam.shake(ev.inRig ? 0.25 : 0.6);
            } else if (ev.from === S.shipId) {
               const target = S.findShip(ev.shipId);
               const where = ev.inRig ? "in the rigging" : ev.below ? "below the waterline" : "in the hull";
               this.ui.showMessage("Hit on " + (target ? target.name : "the enemy") + " " + where + "!");
            }
         } else if (ev.kind === "salvo" && ev.shipId === S.shipId) {
            this.ui.showMessage((ev.side === "PORT" ? "Port" : "Starboard") + " broadside — "
               + ev.count + " guns " + (AMMO[ev.ammo] ? AMMO[ev.ammo].short : ev.ammo) + "!");
         } else if (ev.kind === "world") {
            const a = ev.a === S.shipId ? this.player : S.findShip(ev.a);
            const b = ev.b === S.shipId ? this.player : S.findShip(ev.b);
            if (a && b) this._onWorldEvent({ ...ev, a, b });
         }
      }
      if (S.mode === "regatta") this._courseUI = S.raceStatus(this.boat.pos);
      if (S.closed && !this._mpClosedMsg) {
         this._mpClosedMsg = true;
         this._uiMsg = "Connection to the server lost.";
      }
   }

   // =====================================================================
   // Darstellung - mit Bildschirmrate, nie zustandsaendernd.
   //
   // alpha ist der Restanteil im laufenden Simulationsschritt: 0 = letzter
   // Schritt, 1 = aktueller. Die Schiffe werden dazwischen interpoliert, sonst
   // saehe man bei 120 Hz Bildrate die 30 Hz der Simulation.
   // =====================================================================
   render(alpha = 0, frameDt = SIM_DT) {
      this.ocean.sync(this.sea, this.camera.position, this.boat.pos.x, this.boat.pos.z);
      if (this.terrain.visible) this.terrain.update(this.t);

      if (!this.menuOpen && !this.paused) {
         for (const sh of this.allShips()) sh.applyPose(alpha);
         if (this.session) {
            this.session.render({
               wind: this._windObj(), t: this.t,
               waveT: this.sea.phaseT, waveRad: this.sea.windRad,
               amp: this.sea.amp, lambda: this.sea.lambda,
               seaFull: this.sea.sampler(1), crewLod: true,
            }, frameDt);
         }

         // Kamera: rein visuell, darf mit Bildrate laufen und profitiert davon.
         this.cam.update(frameDt, {
            heading: this.boat.heading,
            pos: this.boat.pos,
            heel: this.boat.heel,
         });

         this._updateUI(this._uiMsg);
         this._uiMsg = "";
      }

      this.renderer.render(this.scene.scene, this.camera);
   }

   /**
    * Alte Einzelschritt-Schnittstelle. Nur noch fuer Aufrufer, die keinen
    * Akkumulator haben (Tests, Werkzeuge); die Spielschleife in main.js
    * benutzt stepFixed()/render().
    */
   step(dt = SIM_DT) {
      this.stepFixed(dt);
      this.render(0, dt);
   }

   _windObj() {
      return { dir: this.wind.dir, speedKts: this.wind.speed };
   }

   // Notfall-Rendering: falls ein Frame-Fehler auftritt, trotzdem ein Bild zeigen
   renderOnly() {
      try {
         this.sea.step(SIM_DT, this.wind.speed, this.wind.dir);
         this.ocean.sync(this.sea, this.camera.position, this.boat.pos.x, this.boat.pos.z);
         if (this.player) this.player.applyPose(0);
      } catch (e) {
         // Skip boat placement, render ocean + sky only
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
         if (typeof ev === "string" && ev.startsWith("ammo:")) { this._setAmmo(ev.slice(5)); continue; }
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
               if (this.session) break;
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
            case "cycleAmmo": {
               if (!this.vessel.guns) break;
               const a = this.battery.cycleAmmo();
               if (this.session) this.session.setAmmo(a);
               const spec = AMMO[a];
               this.ui.showMessage("Loaded: " + spec.name + " — " + spec.desc);
               break;
            }
            case "cutWreck": {
               if (this.session) {
                  this.session.cutWreck();
                  this.player.cutAwayWreckage();
               } else if (this.debris.hasWreckage(this.player.id)) this.player.cutAwayWreckage();
               else this.ui.showMessage("No wreck in tow.");
               break;
            }
            case "cycleVessel": {
               if (this.session) {
                  this.ui.showMessage("The ship cannot be changed in a multiplayer battle.");
                  break;
               }
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

   /** Load a specific ammunition (orders panel); Z still cycles. */
   _setAmmo(id) {
      if (!this.vessel.guns || !AMMO[id]) return;
      if (this.battery.ammo === id) return;
      this.battery.setAmmo(id);
      if (this.session) this.session.setAmmo(id);
      this.ui.showMessage("Loaded: " + AMMO[id].name + " — " + AMMO[id].desc);
   }

   // Breitseite: nur bewaffnete Schiffe, nicht gekentert, nicht im Menue
   _fire(side) {
      if (!this.vessel.guns) {
         this.ui.showMessage("Die " + this.vessel.name + "  has no guns.");
         return false;
      }
      if (this.boat.isCapsized) return false;
      if (this.session) {
         // The server fires the guns; the order goes out with the next input.
         // The message comes back with the salvo event.
         this.session.fire(side);
         return true;
      }
      if (!this.battery.ready(side)) return false;
      const n = this.battery.gunsReady(side);
      if (n <= 0) {
         this.ui.showMessage(
            (side === "PORT" ? "Port" : "Starboard") + " battery is knocked out!");
         return false;
      }
      const ok = this.battery.fire(side, {
         windDir: this.wind.dir,
         windSpeed: this.wind.speed,
         gunnery: 1.0,
      });
      if (ok) {
         this.ui.showMessage((side === "PORT" ? "Port" : "Starboard")
            + "- broadside — " + n + "  guns " + this.battery.ammoSpec().short + "!");
      }
      return ok;
   }

   // ------------------------------------------------------------------
   // Gefecht
   // ------------------------------------------------------------------
   _startBattle() {
      this.fleet.clear();
      this.debris.clear();
      const sc = scenarioFor(this.scenarioId);
      const list = sc.forces[this.vesselId] || [];
      this.terrain.setVisible(true);
      // Der Seegang folgt dem Wind nur traege: eine See baut sich auf und
      // laeuft langsamer wieder ab. Sonst wuerde jede Boe die Wellen pumpen.
      this.sea.snapTo(12);
      this._groundMsg = 0;
      this._battleOver = false;

      if (!list.length) {
         this.ui.showMessage("Die " + this.vessel.name + " ist kein Kriegsschiff — kein Gegner in Sicht.");
         return;
      }
      // Gegner in Luv aufstellen, gestaffelt, gut zwei Kilometer entfernt
      const windDir = this.wind.baseDir;
      const up = dirVec(windDir);       // Richtung, aus der es weht
      list.forEach((id, i) => {
         const spread = (i - (list.length - 1) / 2) * 420;
         const across = dirVec(windDir + 90);
         const x = this.player.pos.x + up.x * 900 + across.x * spread;
         const z = this.player.pos.z + up.z * 900 + across.z * spread;
         const heading = normDeg(Math.atan2(this.player.pos.x - x, this.player.pos.z - z) * 180 / Math.PI);
         this.fleet.spawn(id, {
            x, z, heading, speed: 4,
            doctrine: "rig",
            skill: 0.80 + Math.random() * 0.25,
            engage: 170 + Math.random() * 120,
         });
      });
      const names = this.fleet.ships.map((s) => s.name).join(" und ");
      this.ui.showMessage("Segel in Sicht: " + names + " — klar Schiff zum Gefecht!");
   }

   _updateBattle(dt) {
      const enemies = this.fleet.ships;
      const fighting = this.fleet.fighting();
      let msg = "";
      if (this._battleOver) return "";   // Ergebnis wurde schon gemeldet
      if (this.player.dmg.sunk) {
         msg = "Die " + this.vessel.name + " has sunk. R for a new battle.";
         this._battleOver = true;
      } else if (this.player.dmg.beaten() && this.player.dmg.mastsStanding() <= 1) {
         msg = "Badly damaged — R resets the battle.";
         this._battleOver = true;
      } else if (enemies.length && fighting.length === 0) {
         const struck = enemies.filter((s) => s.dmg.struck).length;
         const sunk = enemies.filter((s) => s.dmg.sunk).length;
         msg = "Gefecht wins! " + (struck ? struck + " gestrichen" : "")
            + (struck && sunk ? ", " : "") + (sunk ? sunk + " gesunken" : "") + ".";
         this._battleOver = true;
      }
      return msg;
   }

   _onShipEvent(ev) {
      const who = ev.ship === this.player ? "Wir" : ev.ship.name;
      const isUs = ev.ship === this.player;
      const M = {
         fore: "Foremast", main: "Mainmast", mizzen: "Mizzenmast",
      };
      switch (ev.type) {
         case "mastLost": {
            const cause = ev.cause === "overpress" ? " — zu viel Tuch im Sturm!"
               : ev.cause === "ram" ? " — in the collision" : "";
            this.ui.showMessage((isUs ? "Der " : ev.ship.name + ": ") + M[ev.mast]
               + " goes overboard" + cause + (isUs ? " — X cuts the wreck." : ""));
            if (isUs) this.cam.shake(1.2);
            break;
         }
         case "casualties": {
            if (isUs && ev.n >= 4) {
               const R = { gun: "at the guns", top: "aloft",
                  marine: "unter den Marines", officer: "unter den Offizieren",
                  carpenter: "bei den Zimmerleuten", powder: "unter den Powder Boys" };
               this.ui.showMessage(ev.n + " Mann " + (R[ev.worst] || "an Deck")
                  + " gefallen oder verwundet!");
            }
            break;
         }
         case "sailBlown": {
            const L = { course: "Coursesail", topsail: "Topsail", topgallant: "Topgallant" };
            const nm = { fore: "Fore", main: "Main", mizzen: "Mizzen" }[ev.mast] || "";
            this.ui.showMessage((isUs ? "Our " : ev.ship.name + ": ")
               + nm + (L[ev.level] || "sail").toLowerCase() + " has blown from the clews!");
            break;
         }
         case "mastWounded":
            if (isUs) this.ui.showMessage(M[ev.mast] + " damaged — Tuch wegnehmen!");
            break;
         case "holed":
            if (isUs && Math.random() < 0.4) this.ui.showMessage("Leak below the waterline — the pumps!");
            break;
         case "rudder":
            if (isUs) this.ui.showMessage("Das Ruder ist getroffen!");
            break;
         case "struck":
            this.ui.showMessage(ev.ship.name + " streicht die Flagge!");
            break;
         case "sunk":
            this.ui.showMessage(isUs ? "Wir sinken." : ev.ship.name + " sinkt.");
            break;
         case "exploded":
            this.ui.showMessage(ev.ship.name + " fliegt in die Luft!");
            break;
         case "aground":
            if (isUs) this.ui.showMessage("Ground contact — the keel scrapes on the rock!");
            break;
         case "cutAway":
            if (isUs) this.ui.showMessage("Wreck cut free — the ship is loose again.");
            break;
         default: break;
      }
   }

   _onWorldEvent(ev) {
      if (ev.type === "collision") {
         const us = ev.a === this.player || ev.b === this.player;
         if (us) {
            this.cam.shake(1.6);
            this.ui.showMessage("Collision! " + ev.closing.toFixed(1) + " kn closing.");
         }
      } else if (ev.type === "locked") {
         const us = ev.a === this.player || ev.b === this.player;
         if (us && this._lockMsg !== true) {
            this._lockMsg = true;
            this.ui.showMessage("Die Schiffe haben sich im Tauwerk verhakt.");
         }
      }
   }

   _restartCurrent() {
      this.battery.clear();
      if (this.mode === "Gefecht") {
         this.debris.clear();
         this.setVessel(this.vesselId, true);
         this._placeAtStart("Gefecht");
         this._startBattle();
         return;
      }
      if (this.mode === "Regatta") {
         this.course.reset(this.t);
         this._placeAtStart("Regatta");
         this.ui.showMessage("New course!");
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
         this.ui.showMessage("Training reset: " + c.title);
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
         this.ui.showMessage("✅ " + tr.title + " — done! Next follows…");
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
         sea: { hs: this.sea.waveHeight, name: seaStateName(this.sea.seaWind) },
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
         guns: this.session ? this.session.gunStatus() : this.battery.status(),
         sailSet: b.sailSet,
         damage: this.player.dmg.status(),
         crew: this.player.crew.status(),
         wreck: this.debris.hasWreckage(this.player.id),
         wreckDrag: this.player.wreckDrag,
         multiplayer: !!this.session,
         depth: this.terrain.visible ? this.terrain.depthAt(b.pos.x, b.pos.z) : null,
         enemies: this.session ? this.session.others(b.pos)
         : this.mode === "Gefecht" ? this.fleet.ships.map((sh) => {
            const dx = sh.pos.x - b.pos.x, dz = sh.pos.z - b.pos.z;
            return {
               name: sh.name,
               dist: Math.hypot(dx, dz),
               bearing: normDeg(Math.atan2(dx, dz) * 180 / Math.PI),
               hull: sh.dmg.integrity(),
               masts: sh.dmg.mastsStanding(),
               struck: sh.dmg.struck,
               sunk: sh.dmg.sunk,
               rate: sh.vessel.rate,
            };
         }) : null,
         camera: CAM_LABEL[this.cam.mode],
         gusts: this.gusts,
         message: msg || (this._courseUI && this._courseUI.message) || "",
         course: this.mode === "Regatta" || (this.session && this.session.mode === "regatta") ? this._courseUI : null,
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