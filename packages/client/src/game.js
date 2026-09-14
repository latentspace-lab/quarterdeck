// game.js - Simulation: wires up scene, boat, physics, camera, controls, modes, UI
import * as THREE from "three";
import { createOcean, seaHeight, ampForWind, waveHeightForWind, seaStateName } from "./ocean.js";
import { SeaState, SIM_DT, makeRng } from "@quarterdeck/shared";
import { createScene } from "./scene.js";
import { getVessel, VESSELS, vesselLabel } from "./vessels.js";
import { Ship } from "./ship.js";
import { Fleet, SCENARIOS, scenarioFor } from "./fleet.js";
import { battleWind, battleSpawns } from "./battleStart.js";
import { DebrisField } from "./debris.js";
import { createTerrain, isOpenWater, findOpenWater } from "./terrain.js";
import * as collide from "./collide.js";
import { AMMO, AMMO_ORDER } from "./damage.js";
import { BoatDynamics, pointOfSail, vmgUp, vmgDown, polarSpeedAt } from "./physics.js";
import { Wind, beaufortName, beaufortOf } from "./wind.js";
import { CameraRig } from "./camera.js";
import { Controls } from "./controls.js";
import { Course } from "./marks.js";
import { makeTrainer } from "./trainer.js";
import { UI } from "./ui.js";
// Missing since the voice announcements were merged in: game.js calls
// voiceAnnounce()/TRIGGER without importing them. openMenu() runs in the
// constructor - the ReferenceError aborted Simulator construction and
// with it the whole game.
import { voiceAnnounce, TRIGGER } from "./audio.js";
import { DEG, clamp, lerp, normDeg, dirVec, diffDeg } from "./utils.js";
import { MultiplayerSession } from "./net/MultiplayerSession.js";
import { defaultServerUrl, listRooms } from "./net/NetClient.js";
import {
   readStyleFromParams, storeStyle, nextStyle, setCurrentStyle, applyStyleToDocument, palette,
} from "./style.js";
import { createAquatint } from "./aquatint.js";
import { applySailPalette } from "./warship.js";

const CAM_LABEL = {
   CHASE: "Chase",
   COCKPIT: "Cockpit",
   TOP: "Top-Down",
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

      // Rendering style (aquatint or plain), decided before anything is
      // built so the stylesheet, the world palette and the sails agree.
      this.style = readStyleFromParams(typeof location !== "undefined" ? location.search : "", safeStorage());
      setCurrentStyle(this.style);
      applyStyleToDocument(this.style, document);

      // Renderer
      this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      viewport.appendChild(this.renderer.domElement);
      this.renderer.domElement.style.cssText = "position:fixed;inset:0;width:100%;height:100%";

      // Scene
      const scene = createScene();
      this.scene = scene;
      scene.setSunDir(55, 48);

      // Camera
      this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.5, 12000);
      this.camera.position.set(0, 8, -18);
      this.camera.lookAt(0, 1, 0);

      // The aquatint pass draws the scene through its own target; the plain
      // style bypasses it (see _draw).
      this.aquatint = createAquatint(this.renderer, scene.scene, this.camera);

      // Ocean
      this.ocean = createOcean({ sunDir: new THREE.Vector3(0.4, 0.6, 0.7) });
      scene.add(this.ocean.mesh);
      this.ocean.mesh.receiveShadow = false;

      // Pass the sun direction to the sea (the sun is fixed)
      this.sunDir = scene.sunLight.position.clone().normalize();
      this.ocean.uniforms.uSunDir.value.copy(this.sunDir);

      // Target marker (for training) — ring on the water
      this.targetMarker = makeTargetMarker();
      this.targetMarker.visible = false;
      scene.add(this.targetMarker);

      // Wreckage (its own rigid-body simulation)
      this.debris = new DebrisField(scene.scene, { max: 420 });

      // Land and shoals
      this.terrain = createTerrain(scene.scene);
      this.terrain.setVisible(false);
      this._applyPalette();

      // Wind
      this.wind = new Wind({ dir: 0, speed: 12, gust: 0.5, veer: 0.4, variability: 1 });
      this.manualTrim = false;

      // Camera rig
      this.cam = new CameraRig(this.camera, this.renderer.domElement);
      this.cam.mode = "CHASE";

      // Input
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

      // Enemy ships
      this.fleet = new Fleet({
         scene,
         debris: this.debris,
         targets: this._targets,
         onHit: this._onHit,
      });

      // Player ship
      this.player = null;
      this.vessel = null;
      this.vesselId = null;
      this.scenarioId = "single";
      this.setVessel("yacht");

      // Regatta course
      this.course = new Course(scene.scene, { x: 0, z: 0 });

      // Trainer (adapted to the ship by setVessel)
      this.trainState = null;
      this.trainDoneTimer = 0;

      // Mode
      // The sea state follows the wind only sluggishly: a sea builds up and
      // subsides more slowly. Otherwise every gust would pump the waves.
      // Phase 0: the state (lagging wind + wave phase) lives in SeaState and
      // is integrated with a fixed step. In Phase 1 it comes from the server
      // (SeaSync) - hit detection and the picture must sit on the same
      // wave.
      this.sea = new SeaState(12);
      this._groundMsg = 0;
      this._battleOver = false;
      this._lockMsg = false;
      this._uiMsg = "";
      this.mode = "Freeride";
      this.gusts = true;
      this.hudVisible = true;
      // Battle opening: random wind and enemy bearing (issue #6). ?seed= replays one.
      this.randomStart = true;
      this.battleSeed = null;
      this._battle = null;

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
      // ?style=plain|aquatint picks the rendering style (read in the
      // constructor's first lines, see style.js).
      const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
      if (q.get("seed") !== null && q.get("seed") !== "") this.battleSeed = Number(q.get("seed")) | 0;
      if (q.get("random") === "0") this.randomStart = false;
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

   // Switch ship: 3D model, physics profile, camera, battery, trainer.
   // Convenient shortcuts so the rest of the code stays unchanged
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

      // Pass the sun direction to every sail shader
      for (const sail of this.player.model.userData.sails || []) {
         const u = sail.material && sail.material.uniforms;
         if (u && u.uSunDir) u.uSunDir.value.copy(this.sunDir);
      }

      this.cam.setVessel(v.cam);
      this.trainer = makeTrainer(v);
      return v;
   }

   // ------------------------------------------------------------------
   // Hit: the struck ship books the damage and throws splinters
   // ------------------------------------------------------------------
   _handleHit(hit) {
      const ship = hit.target && hit.target.ship;
      if (!ship || !ship.alive) return;
      const res = ship.takeHit(hit);
      if (!res) return;
      if (ship === this.player) {
         // The player should feel that they were hit
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
         // Live preview: the ship is already switched in the menu
         scenarioId: this.scenarioId,
         scenarios: SCENARIOS,
         onScenarioChange: (id) => { this.scenarioId = id; },
         randomStart: this.randomStart,
         onRandomChange: (on) => { this.randomStart = !!on; },
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
           <h2>Help & Controls</h2>
           <h3>Basic Rules of Sailing Physics</h3>
           <p>The <b>point of sail (TWA)</b> is the angle between the boat's heading and the wind.
           Sailing against the wind (upwind), you never point at 0° — you sail in <i>luffing</i> (~45°) and tack.
           The fastest point of sail is <i>beam reach</i> (~90°).
           Downwind you sail deeper (~135°) than directly before the wind (180°).</p>
           <h3>Royal Navy Square-Rigged Ships</h3>
           <p>A square-rigged ship (Sloop, Frigate, Ship of the Line) can only point about
           <b>six points</b> — roughly 65° — into the wind; below that the sails
           go aback and the ship loses way. The <b>yards are braced</b>:
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
           <p>In <b>Battle</b> mode the wind and the enemy's bearing are rolled afresh each
           fight (switch it off in the menu for the classic start dead to windward; add <i>?seed=N</i> to the address to replay a battle).
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
             <b>R</b> : Restart course/training · <b>G</b> : Gusts · <b>P</b> : Aquatint / plain rendering</li>
             <li><b>Q / E / F</b> : Port / Starboard / Both broadsides</li>
             <li><b>Z</b> : Change load &nbsp;·&nbsp; <b>X</b> : Cut away wreck</li>
             <li><b>V</b> : Change ship &nbsp;·&nbsp; <b>W / S</b> : set / reef sails on square-riggers</li>
             <li><b>Space</b> : Right the boat after capsize</li>
             <li><b>Mouse wheel</b> : Zoom · <b>Drag</b> : Rotate view</li>
             <li><b>Orders panel</b> (bottom right) : every command as a button — hold the helm and sail buttons.</li>
           </ul>
           <p style="margin-top:12px"><b class="prim">Tip:</b> Watch the compass.
           The red arrow = ship, the blue = wind (from where), the turquoise = apparent wind.</p>
           <button class="help-close">Got it</button>
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
      if (mode === "Battle") this._rollBattle();
      this._placeAtStart(mode);
      this.battery.clear();
      this.debris.clear();
      this.course.setVisible(mode === "Regatta");
      if (mode !== "Battle") {
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
      if (mode === "Battle") {
         this.ui.setTraining(null);
         this.trainState = null;
         this.targetMarker.visible = false;
         this.yacht.visible = true;
         this._startBattle();
      }
   }

   _placeAtStart(mode) {
      const V = this.vessel;
      // No starting head to wind: a square-rigger would never get out of irons there.
      // Regatta starts close-hauled on the best tacking angle, otherwise on a broad reach.
      const startTwa = mode === "Regatta"
         ? V.sail.noGo + 8
         : mode === "Battle" ? 100
         : (V.rig === "square" ? 110 : 90);
      // twa = windDir - heading  ->  heading = windDir - twa (wind from starboard)
      this.boat.heading = normDeg(this.wind.baseDir - startTwa);
      this.boat.heel = 0;
      this.boat.pos.x = 0;
      this.boat.pos.z = mode === "Regatta" ? -30 - V.hull.loa * 1.2 : 0;
      this.boat.sailSet = 1;
      this.boat.tack = "STBD";
      this.boat.leeway = 0;
      // Start with a bit of way on - otherwise a ship of the line
      // wallows for two minutes before anything happens.
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

   // Wave propagation in radians: waves travel with the wind (toward where it blows)
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
      // nothing
   }

   _resize() {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.aquatint) this.aquatint.setSize(window.innerWidth, window.innerHeight);
   }

   // ------------------------------------------------------------------
   // Rendering style. Everything visual reads the palette for the current
   // style; switching re-tints the sky, sea, land and every sail in place.
   // ------------------------------------------------------------------
   setStyle(name) {
      this.style = setCurrentStyle(name);
      applyStyleToDocument(this.style, document);
      storeStyle(this.style, safeStorage());
      this._applyPalette();
      return this.style;
   }

   _applyPalette() {
      const world = palette(this.style).world;
      this.scene.setPalette(world);
      this.ocean.setPalette(world.sea);
      this.terrain.setPalette(world.terrain);
      const ships = [this.player, ...(this.fleet ? this.fleet.ships : []),
         ...(this.session ? this.session.remoteShips() : [])];
      for (const s of ships) if (s && s.model) applySailPalette(s.model, world);
   }

   /** One frame onto the canvas: through the aquatint pass or straight. */
   _draw() {
      if (this.style === "aquatint" && this.aquatint) this.aquatint.render();
      else this.renderer.render(this.scene.scene, this.camera);
   }

   // =====================================================================
   // Simulation - ALWAYS with a fixed step (SIM_DT).
   //
   // Everything that changes game state lives here. None of it depends on
   // the frame rate: the same command stream at the same step size produces
   // the same state - on this machine, on a slower one, and later on the
   // server. Rendering happens separately in render().
   // =====================================================================
   stepFixed(dt) {
      // --- Menu pause: no physics, but the water keeps moving ---
      if (this.menuOpen || this.paused) {
         this.t += dt;
         this.sea.step(dt, this.wind.speed, this.wind.dir);
         return;
      }

      // Time
      this.t += dt;
      this.wind.update(dt, this.t);

      // Input
      const inp = this.controls.read(dt);
      this._handleQueue();
      // Rudder smoothing has lived entirely inside BoatDynamics.step() since
      // Phase 0B' - only the raw command goes in here now.
      this.boat.setRudder(inp.rudder);
      if (this.vessel.rig === "square") {
         // W / S set or reef the sails (more canvas = more speed and heel)
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
         this.ui.showMessage("Righted — sail on!");
      }

      // ------------------------------------------------------------------
      // World step: player, enemies, wreckage, collisions, ground
      // ------------------------------------------------------------------
      // First the water: the boat, wreckage and projectiles then compute
      // against exactly the same surface as the shader.
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

      if (this.mode === "Battle") {
         // Only animate crew on ships that can actually be made out
         for (const e of this.fleet.ships) {
            e._crewNear = Math.hypot(e.pos.x - this.boat.pos.x, e.pos.z - this.boat.pos.z) < 420;
         }
         this.fleet.update(dt, { ...worldCtx, target: this.player });
      }

      // Collisions between all ships
      const ships = this.allShips();
      if (ships.length > 1) {
         for (const ev of collide.step(ships, dt)) this._onWorldEvent(ev);
      }

      // Ground contact (only where there is land)
      if (this.terrain.visible) {
         for (const sh of ships) {
            const g = collide.groundStep(sh, this.terrain.depthAt, dt);
            if (g && sh === this.player && this._groundMsg <= 0) {
               this._groundMsg = 6;
               this.ui.showMessage(g.hard
                  ? "AGROUND! The keel is stuck fast — water is coming in."
                  : "Ground contact! Bear away immediately, the water is too shallow.");
            }
         }
      }
      if (this._groundMsg > 0) this._groundMsg -= dt;

      // Wreckage drifts, sinks, drags
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

      // Messages from the damage model
      for (const ev of this.player.drainEvents()) this._onShipEvent(ev);
      if (this.mode === "Battle") {
         for (const ev of this.fleet.drainEvents()) this._onShipEvent(ev);
      }

      // Mode-specific logic
      let msg = "";
      if (this.mode === "Battle") {
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
   // Rendering - at screen rate, never changes state.
   //
   // alpha is the remaining fraction of the current simulation step: 0 = the
   // last step, 1 = the current one. Ships are interpolated in between,
   // otherwise you would see the simulation's 30 Hz at a 120 Hz frame rate.
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

         // Camera: purely visual, may run at frame rate and benefits from it.
         this.cam.update(frameDt, {
            heading: this.boat.heading,
            pos: this.boat.pos,
            heel: this.boat.heel,
         });

         this._updateUI(this._uiMsg);
         this._uiMsg = "";
      }

      this._draw();
   }

   /**
    * Old single-step interface. Only still used by callers that have no
    * accumulator (tests, tools); the game loop in main.js
    * uses stepFixed()/render().
    */
   step(dt = SIM_DT) {
      this.stepFixed(dt);
      this.render(0, dt);
   }

   _windObj() {
      return { dir: this.wind.dir, speedKts: this.wind.speed };
   }

   // Emergency rendering: show a frame anyway even if a frame error occurs
   renderOnly() {
      try {
         this.sea.step(SIM_DT, this.wind.speed, this.wind.dir);
         this.ocean.sync(this.sea, this.camera.position, this.boat.pos.x, this.boat.pos.z);
         if (this.player) this.player.applyPose(0);
      } catch (e) {
         // Skip boat placement, render ocean + sky only
      }
      try {
         this._draw();
      } catch (e) {
         console.error("[quarterdeck] renderOnly:", e);
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
            case "toggleStyle":
               this.setStyle(nextStyle(this.style));
               this.ui.showMessage(this.style === "aquatint" ? "Aquatint" : "Plain rendering");
               break;
            case "toggleMenu":
               this.openMenu();
               break;
            case "capsizeRight":
               if (this.boat.isCapsized) {
                  this.boat.rightBoat();
                  this.ui.showMessage("Righted — sail on!");
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
               this.ui.showMessage("Now aboard: " + vesselLabel(nxt) + " · " + nxt.rate);
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

   // Broadside: only armed ships, not capsized, not in the menu
   _fire(side) {
      if (!this.vessel.guns) {
         this.ui.showMessage("The " + this.vessel.name + "  has no guns.");
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
   // Battle
   // ------------------------------------------------------------------
   /**
    * A fresh battle: seed the dice and, unless switched off in the menu, roll
    * the wind. Runs before the player is placed, because the start heading
    * is laid relative to the wind.
    */
   _rollBattle() {
      const seed = this.battleSeed ?? ((Math.random() * 0x7fffffff) | 0);
      this._battle = { seed, rng: makeRng(seed) };
      if (this.randomStart) {
         const w = battleWind(this._battle.rng);
         this.wind.baseDir = w.dir;
         this.wind.baseSpeed = w.speed;
      }
      console.info("Battle seed " + seed + " (replay with ?seed=" + seed + ")");
   }

   _startBattle() {
      this.fleet.clear();
      this.debris.clear();
      const sc = scenarioFor(this.scenarioId);
      const list = sc.forces[this.vesselId] || [];
      this.terrain.setVisible(true);
      // The sea state follows the wind only sluggishly: a sea builds up and
      // subsides more slowly. Otherwise every gust would pump the waves.
      this.sea.snapTo(this.wind.baseSpeed);
      this._groundMsg = 0;
      this._battleOver = false;

      if (!list.length) {
         this.ui.showMessage("The " + this.vessel.name + " is not a warship — no enemy in sight.");
         return;
      }
      if (!this._battle) this._rollBattle();
      // Classic: a line abreast dead upwind. Random: somewhere on the horizon.
      const spawns = battleSpawns({
         enemies: list, player: this.player.pos, windDir: this.wind.baseDir,
         random: this.randomStart, rng: this._battle.rng,
      });
      for (const s of spawns) {
         if (!isOpenWater(s.x, s.z)) {
            const safe = findOpenWater({
               rng: this._battle.rng,
               near: { x: s.x, z: s.z },
               minDist: 0,
               maxDist: 800,
            });
            s.x = safe.x;
            s.z = safe.z;
         }
      }
      for (const { id, ...o } of spawns) this.fleet.spawn(id, o);
      const names = this.fleet.ships.map((s) => s.name).join(" and ");
      this.ui.showMessage("Sails in sight: " + names + " — clear ship for action!");
   }

   _updateBattle(dt) {
      const enemies = this.fleet.ships;
      const fighting = this.fleet.fighting();
      let msg = "";
      if (this._battleOver) return "";   // result was already reported
      if (this.player.dmg.sunk) {
         msg = "The " + this.vessel.name + " has sunk. R for a new battle.";
         this._battleOver = true;
      } else if (this.player.dmg.beaten() && this.player.dmg.mastsStanding() <= 1) {
         msg = "Badly damaged — R resets the battle.";
         this._battleOver = true;
      } else if (enemies.length && fighting.length === 0) {
         const struck = enemies.filter((s) => s.dmg.struck).length;
         const sunk = enemies.filter((s) => s.dmg.sunk).length;
         msg = "Battle won! " + (struck ? struck + " struck" : "")
            + (struck && sunk ? ", " : "") + (sunk ? sunk + " sunk" : "") + ".";
         this._battleOver = true;
      }
      return msg;
   }

   _onShipEvent(ev) {
      const who = ev.ship === this.player ? "We" : ev.ship.name;
      const isUs = ev.ship === this.player;
      const M = {
         fore: "Foremast", main: "Mainmast", mizzen: "Mizzenmast",
      };
      switch (ev.type) {
         case "mastLost": {
            const cause = ev.cause === "overpress" ? " — too much sail in the storm!"
               : ev.cause === "ram" ? " — in the collision" : "";
            this.ui.showMessage((isUs ? "The " : ev.ship.name + ": ") + M[ev.mast]
               + " goes overboard" + cause + (isUs ? " — X cuts the wreck." : ""));
            if (isUs) this.cam.shake(1.2);
            break;
         }
         case "casualties": {
            if (isUs && ev.n >= 4) {
               const R = { gun: "at the guns", top: "aloft",
                  marine: "among the marines", officer: "among the officers",
                  carpenter: "among the carpenters", powder: "among the powder boys" };
               this.ui.showMessage(ev.n + " men " + (R[ev.worst] || "on deck")
                  + " killed or wounded!");
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
            if (isUs) this.ui.showMessage(M[ev.mast] + " damaged — take in sail!");
            break;
         case "holed":
            if (isUs && Math.random() < 0.4) this.ui.showMessage("Leak below the waterline — the pumps!");
            break;
         case "rudder":
            if (isUs) this.ui.showMessage("The rudder has been hit!");
            break;
         case "struck":
            this.ui.showMessage(ev.ship.name + " strikes her colours!");
            break;
         case "sunk":
            this.ui.showMessage(isUs ? "We are sinking." : ev.ship.name + " sinks.");
            break;
         case "exploded":
            this.ui.showMessage(ev.ship.name + " blows up!");
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
            this.ui.showMessage("The ships have become entangled in the rigging.");
         }
      }
   }

   _restartCurrent() {
      this.battery.clear();
      if (this.mode === "Battle") {
         this.debris.clear();
         this.setVessel(this.vesselId, true);
         this._rollBattle();
         this._placeAtStart("Battle");
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
         : this.mode === "Battle" ? this.fleet.ships.map((sh) => {
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

// ---------- Cleanup on ship change ----------
function disposeTree(root) {
   root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
      else if (m && m.dispose) m.dispose();
   });
}

// localStorage can be missing or throw (private mode, blocked storage).
function safeStorage() {
   try {
      return typeof window !== "undefined" ? window.localStorage : null;
   } catch {
      return null;
   }
}

// ---------- Water target marker (ring + buoy) ----------
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