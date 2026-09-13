// game.js - Simulation: bindet Szene, Boot, Physik, Kamera, Steuerung, Modi, UI
import * as THREE from "three";
import { createOcean, seaHeight, ampForWind, waveHeightForWind, seaStateName } from "./ocean.js";
import { createScene } from "./scene.js";
import { getVessel, VESSELS, vesselLabel, shipsOfFaction } from "./vessels.js";
import { getFaction, enemyFactionFor } from "./factions.js";
import { Ship } from "./ship.js";
import { Fleet, SCENARIOS, scenarioFor, forcesFor } from "./fleet.js";
import { DebrisField } from "./debris.js";
import { createTerrain, findOpenWater, makeRng, worldInfo } from "./terrain.js";
import * as collide from "./collide.js";
import { AMMO, AMMO_ORDER } from "./damage.js";
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

      // Wrackteile (eigene Starrkoerper-Simulation)
      this.debris = new DebrisField(scene.scene, { max: 420 });

      // Land und Untiefen
      this.terrain = createTerrain(scene.scene);
      this.terrain.setVisible(false);
      this.worldSeed = null;   // null = bei jedem Start neu auswuerfeln

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

      // Alle Schiffe im Wasser (Spieler zuerst) - Ziele fuer alle Batterien
      this.allShips = () => [this.player, ...this.fleet.ships].filter((s) => s && s.alive);
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
      this.factionId = "gb";
      this.faction = getFaction("gb");
      this.setVessel("lydia");

      // Regatta-Kurs
      this.course = new Course(scene.scene, { x: 0, z: 0 });

      // Trainer (wird von setVessel an das Schiff angepasst)
      this.trainState = null;
      this.trainDoneTimer = 0;

      // Modus
      // Der Seegang folgt dem Wind nur traege: eine See baut sich auf und
      // laeuft langsamer wieder ab. Sonst wuerde jede Boe die Wellen pumpen.
      this.seaWind = 12;
      this._groundMsg = 0;
      this._battleOver = false;
      this._lockMsg = false;
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
   // Bequeme Abkuerzungen, damit der uebrige Code unveraendert bleibt
   get boat() { return this.player ? this.player.dyn : null; }
   get yacht() { return this.player ? this.player.model : null; }
   get battery() { return this.player ? this.player.battery : null; }

   // Partei wechseln: Schiffsliste, Anstrich, Flagge und Gegner haengen daran
   setFaction(id, vesselId) {
      const f = getFaction(id);
      if (f.id === this.factionId && !vesselId) return f;
      this.factionId = f.id;
      this.faction = f;
      const list = shipsOfFaction(f.id);
      let want = vesselId || this.vesselId;
      if (want !== "yacht" && !list.some((v) => v.id === want)) {
         want = list.length ? list[0].id : "yacht";
      }
      this.setVessel(want, true);
      return f;
   }

   setVessel(id, force = false) {
      const v = getVessel(id);
      if (!force && this.vesselId === v.id && this.player) return this.vessel;
      const old = this.player;
      this.vessel = v;
      this.vesselId = v.id;

      this.player = new Ship({
         id: "player",
         vessel: v,
         faction: this.faction,
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
      this.ui.openMenu({
         mode: this.mode,
         vesselId: this.vesselId,
         factionId: this.factionId,
         forcesFor,
         onFactionChange: (fid, vid) => this.setFaction(fid, vid),
         windDir: this.wind.baseDir,
         windSpeed: this.wind.baseSpeed,
         gusts: this.gusts,
         onWindChange: (dir, speed, gusts) => {
            this.wind.baseDir = dir;
            this.wind.baseSpeed = speed;
            this.gusts = gusts;
            this.wind.variability = gusts ? 1 : 0;
            this.seaWind = speed;
            this.ocean.windKts = speed;
         },
         // Live-Vorschau: das Schiff wird schon im Menue gewechselt
         scenarioId: this.scenarioId,
         scenarios: SCENARIOS,
         onScenarioChange: (id) => { this.scenarioId = id; },
         onVesselChange: (id) => this.setVessel(id),
         onStart: (mode, dir, speed, gusts, vesselId, scenarioId, factionId) => {
            if (scenarioId) this.scenarioId = scenarioId;
            if (factionId && factionId !== this.factionId) this.setFaction(factionId, vesselId);
            this.startMode(mode, dir, speed, gusts, vesselId);
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
           <h3>Gefecht, Schäden und Wrack</h3>
           <p>Im Modus <b>Gefecht</b> steht ein französischer Gegner in Luv.
           <b>Z</b> wechselt die Ladung: <i>Vollkugel</i> in den Rumpf (Lecks, Rohre,
           am Ende sinkt er), <i>Kettenkugel</i> in die Takelage (Masten und Segel —
           die französische Art, einen Gegner manövrierunfähig zu machen),
           <i>Kartätsche</i> nur auf Pistolenschussweite.</p>
           <p>Ein gefallener Mast nimmt seine Segelfläche mit und hängt im
           stehenden Gut <b>längsseit</b> — das Schiff wird langsam und zieht zur
           Wrackseite. <b>X</b> kappt die Wanten und macht sie wieder frei.
           Lecks unter Wasser lassen sich von den Pumpen nur begrenzt halten;
           zu viele, und sie sinkt. Zu viel Tuch im Sturm kostet die Stengen,
           und auf einem Riff bricht der Kiel auf.</p>
           <h3>Steuerung</h3>
           <ul style="margin:6px 0 0 18px">
             <li><b>A / D</b> oder <b>← / →</b> : Ruder (Backbord / Steuerbord)</li>
             <li><b>W / S</b> : Segel trimmen (ein / aus) — bei manueller Trimmung</li>
             <li><b>C</b> / <b>1–4</b> : Kamera (Verfolger, Cockpit, Draufsicht, Orbit)</li>
             <li><b>M</b> / <b>Esc</b> : Menü · <b>R</b> : Kurs/Training neu · <b>G</b> : Gusts</li>
             <li><b>Q / E / F</b> : Breitseite Backbord / Steuerbord / beide</li>
             <li><b>Z</b> : Ladung wechseln &nbsp;·&nbsp; <b>X</b> : Wrack kappen</li>
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
      this.seaWind = speed;
      this.ocean.windKts = speed;
      this.ui.closeMenu();
      this.menuOpen = false;
      this.paused = false;
      // Erst die Welt, dann die Schiffe: der Startplatz haengt von den Inseln ab.
      if (mode === "Regatta" || mode === "Training") {
         this.terrain.setVisible(false);
      } else {
         this._newWorld();
         this.terrain.setVisible(true);
      }
      this._placeAtStart(mode);
      this.battery.clear();
      this.debris.clear();
      this.course.setVisible(mode === "Regatta");
      if (mode !== "Gefecht") {
         this.fleet.clear();
      }
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
      if (mode === "Gefecht") {
         this.ui.setTraining(null);
         this.trainState = null;
         this.targetMarker.visible = false;
         this.yacht.visible = true;
         this._startBattle();
      }
   }

   // Neue Seekarte auswuerfeln (oder den gesetzten Seed wiederholen).
   _newWorld(seed) {
      const s = seed ?? this.worldSeed ?? ((Math.random() * 1e9) | 0);
      const w = this.terrain.regenerate(s);
      this.worldSeed = w.seed;
      if (this.ui && this.ui.setSeed) this.ui.setSeed(w.seed);
      return w;
   }

   // Feste Seekarte vorgeben; null = jedes Mal neu wuerfeln.
   setSeed(seed) {
      this.worldSeed = seed == null ? null : (seed >>> 0);
   }

   _placeAtStart(mode) {
      const V = this.vessel;
      // Kein Start mitten im Wind: ein Rahsegler kaeme dort nie heraus.
      // Regatta beginnt am Wind auf dem besten Kreuzkurs, sonst auf Raumschot.
      const startTwa = mode === "Regatta"
         ? V.sail.noGo + 8
         : mode === "Gefecht" ? 100
         : (V.rig === "square" ? 110 : 90);
      // twa = windDir - heading  ->  heading = windDir - twa (Wind von Steuerbord)
      this.boat.heading = normDeg(this.wind.baseDir - startTwa);
      this.boat.heel = 0;
      this.boat.pos.x = 0;
      this.boat.pos.z = mode === "Regatta" ? -30 - V.hull.loa * 1.2 : 0;
      // Im Archipel nicht blind auf dem Nullpunkt starten, sondern auf einem
      // Platz mit genug Wasser unterm Kiel und Raum zum Manoevrieren.
      if (this.terrain.visible) {
         const rng = makeRng((worldInfo().seed ^ 0x5f3a) >>> 0);
         const p = findOpenWater({
            rng, maxDist: 700, minDepth: 22,
            clearance: Math.max(240, V.hull.loa * 4),
         });
         this.boat.pos.x = p.x;
         this.boat.pos.z = p.z;
      }
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
      this.seaWind = speed;
      this.ocean.windKts = speed;
   }

   // Wellenausbreitung in Rad: Wellen laufen mit dem Wind (dorthin, wohin er weht)
   _waveRad() {
      return normDeg(this.wind.dir + 180) * DEG;
   }

   _seaAmp() {
      return ampForWind(this.seaWind);
   }

   // Seegang dem Wind nachfuehren (Aufbau schneller als Abklingen)
   _updateSeaState(dt) {
      const target = this.wind.speed;
      const tau = target > this.seaWind ? 45 : 95;
      this.seaWind += (target - this.seaWind) * (1 - Math.exp(-dt / tau));
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
            this.seaWind, this._waveRad());
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

      if (this.boat.isCapsized && inp.queue && inp.queue.includes("capsizeRight")) {
         this.boat.rightBoat();
         this.ui.showMessage("Aufgerichtet — weiter segeln!");
      }

      // ------------------------------------------------------------------
      // Welt-Schritt: Spieler, Gegner, Wrack, Kollisionen, Grund
      // ------------------------------------------------------------------
      // Zuerst das Wasser: Boot, Wrack und Geschosse rechnen danach mit exakt
      // derselben Oberflaeche wie der Shader.
      this._updateSeaState(dt);
      this.ocean.update(this.t, this.camera.position, this.boat.pos.x, this.boat.pos.z,
         this.seaWind, this._waveRad());
      const wr2 = this._waveRad();
      const amp2 = this.ocean.amp;
      const lam2 = this.ocean.lambda;
      const waveT = this.ocean.waveTime;
      const seaFn = (x, z) => seaHeight(x, z, waveT, wr2, amp2, lam2) * 0.9;
      const gunCtx = { windDir: this.wind.dir, windSpeed: this.wind.speed, seaHeight: seaFn };
      const worldCtx = {
         wind: this._windObj(), t: this.t, gunCtx,
         waveT, waveRad: wr2, amp: amp2, lambda: lam2,
      };

      worldCtx.crewLod = true;
      this.player.update(dt, worldCtx);
      this.player.battery.update(dt, gunCtx);

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
                  : "Grundberührung! Sofort abfallen, hier ist es zu flach.");
            }
         }
         this.terrain.update(this.t);
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

      // Kamera
      this.cam.update(dt, {
         heading: this.boat.heading,
         pos: this.boat.pos,
         heel: this.boat.heel,
      });

      // Modus-spezifische Logik
      let msg = "";
      if (this.mode === "Gefecht") {
         msg = this._updateBattle(dt);
      } else if (this.mode === "Regatta") {
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
            this.seaWind, this._waveRad());
         if (this.player) this.player.placeOnSea(0.016, {
            waveT: this.ocean.waveTime, waveRad: this._waveRad(),
            amp: this.ocean.amp, lambda: this.ocean.lambda });
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
            case "cycleAmmo": {
               if (!this.vessel.guns) break;
               const a = this.battery.cycleAmmo();
               const spec = AMMO[a];
               this.ui.showMessage("Geladen: " + spec.name + " — " + spec.desc);
               break;
            }
            case "cutWreck": {
               if (this.debris.hasWreckage(this.player.id)) this.player.cutAwayWreckage();
               else this.ui.showMessage("Kein Wrack im Schlepp.");
               break;
            }
            case "cycleVessel": {
               const roster = shipsOfFaction(this.factionId).concat([getVessel("yacht")]);
               const i = roster.findIndex((v) => v.id === this.vesselId);
               const nxt = roster[(i + 1) % roster.length];
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
      const n = this.battery.gunsReady(side);
      if (n <= 0) {
         this.ui.showMessage(
            (side === "PORT" ? "Backbord" : "Steuerbord") + "-Batterie ist ausgeschlagen!");
         return false;
      }
      const ok = this.battery.fire(side, {
         windDir: this.wind.dir,
         windSpeed: this.wind.speed,
         gunnery: this.faction.gunnery,
      });
      if (ok) {
         this.ui.showMessage((side === "PORT" ? "Backbord" : "Steuerbord")
            + "-Breitseite — " + n + " Rohre " + this.battery.ammoSpec().short + "!");
      }
      return ok;
   }

   // ------------------------------------------------------------------
   // Gefecht
   // ------------------------------------------------------------------
   _startBattle() {
      this.fleet.clear();
      this.debris.clear();
      const foeFaction = enemyFactionFor(this.factionId);
      const list = forcesFor(this.scenarioId, this.vessel, foeFaction);
      // Der Seegang folgt dem Wind nur traege: eine See baut sich auf und
      // laeuft langsamer wieder ab. Sonst wuerde jede Boe die Wellen pumpen.
      this.seaWind = 12;
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
         let x = this.player.pos.x + up.x * 900 + across.x * spread;
         let z = this.player.pos.z + up.z * 900 + across.z * spread;
         // Auch der Gegner braucht Wasser unterm Kiel: den Idealplatz nur als
         // Ausgangspunkt nehmen und den naechsten freien Fleck dazu suchen.
         if (this.terrain.visible) {
            const rng = makeRng((worldInfo().seed + 977 * (i + 1)) >>> 0);
            const p = findOpenWater({
               rng, near: { x, z }, maxDist: 420, minDepth: 20, clearance: 260,
               avoid: [{ x: this.player.pos.x, z: this.player.pos.z, r: 400 }],
            });
            x = p.x; z = p.z;
         }
         const heading = normDeg(Math.atan2(this.player.pos.x - x, this.player.pos.z - z) * 180 / Math.PI);
         this.fleet.spawn(id.id, {
            x, z, heading, speed: 4,
            faction: foeFaction,
            skill: foeFaction.gunnery * (0.88 + Math.random() * 0.24),
            engage: 170 + Math.random() * 120,
         });
      });
      const names = this.fleet.ships.map((s) => s.name).join(" und ");
      this.ui.showMessage(foeFaction.short === "☠"
         ? "Totenkopf in Sicht: " + names + " — klar Schiff zum Gefecht!"
         : "Segel in Sicht: " + names + " (" + foeFaction.country + ") — klar Schiff zum Gefecht!");
   }

   _updateBattle(dt) {
      const enemies = this.fleet.ships;
      const fighting = this.fleet.fighting();
      let msg = "";
      if (this._battleOver) return "";   // Ergebnis wurde schon gemeldet
      if (this.player.dmg.sunk) {
         msg = "Die " + this.vessel.name + " ist gesunken. R für ein neues Gefecht.";
         this._battleOver = true;
      } else if (this.player.dmg.beaten() && this.player.dmg.mastsStanding() <= 1) {
         msg = "Schwer angeschlagen — R setzt das Gefecht zurück.";
         this._battleOver = true;
      } else if (enemies.length && fighting.length === 0) {
         const struck = enemies.filter((s) => s.dmg.struck).length;
         const sunk = enemies.filter((s) => s.dmg.sunk).length;
         msg = "Gefecht gewonnen! " + (struck ? struck + " gestrichen" : "")
            + (struck && sunk ? ", " : "") + (sunk ? sunk + " gesunken" : "") + ".";
         this._battleOver = true;
      }
      return msg;
   }

   _onShipEvent(ev) {
      const who = ev.ship === this.player ? "Wir" : ev.ship.name;
      const isUs = ev.ship === this.player;
      const M = {
         fore: "Fockmast", main: "Großmast", mizzen: "Kreuzmast",
      };
      switch (ev.type) {
         case "mastLost": {
            const cause = ev.cause === "overpress" ? " — zu viel Tuch im Sturm!"
               : ev.cause === "ram" ? " — beim Zusammenstoß" : "";
            this.ui.showMessage((isUs ? "Der " : ev.ship.name + ": ") + M[ev.mast]
               + " geht über Bord" + cause + (isUs ? " — X kappt das Wrack." : ""));
            if (isUs) this.cam.shake(1.2);
            break;
         }
         case "casualties": {
            if (isUs && ev.n >= 4) {
               const R = { gun: "an den Geschützen", top: "in der Takelage",
                  marine: "unter den Seesoldaten", officer: "unter den Offizieren",
                  carpenter: "bei den Zimmerleuten", powder: "unter den Pulverjungen" };
               this.ui.showMessage(ev.n + " Mann " + (R[ev.worst] || "an Deck")
                  + " gefallen oder verwundet!");
            }
            break;
         }
         case "sailBlown": {
            const L = { course: "Untersegel", topsail: "Marssegel", topgallant: "Bramsegel" };
            const nm = { fore: "Fock", main: "Groß", mizzen: "Kreuz" }[ev.mast] || "";
            this.ui.showMessage((isUs ? "Unser " : ev.ship.name + ": ")
               + nm + (L[ev.level] || "Segel").toLowerCase() + " ist aus den Lieken geflogen!");
            break;
         }
         case "mastWounded":
            if (isUs) this.ui.showMessage(M[ev.mast] + " angeschlagen — Tuch wegnehmen!");
            break;
         case "holed":
            if (isUs && Math.random() < 0.4) this.ui.showMessage("Leck unter Wasser — die Pumpen!");
            break;
         case "shattered": {
            const SEC = { BOW: "Bug", MID: "Mittschiffs", QUARTER: "Achterschiff" };
            const SD = { PORT: "backbord", STBD: "steuerbord" };
            this.ui.showMessage((isUs ? "Die Bordwand " : ev.ship.name + ": Bordwand ")
               + SD[ev.side] + " " + (SEC[ev.sec] || "") + " ist aufgerissen!");
            if (isUs) this.cam.shake(1.4);
            break;
         }
         case "swamped":
            if (isUs) this.ui.showMessage("See kommt über die Reling — Wasser in der Batterie!");
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
            if (isUs) this.ui.showMessage("Grundberührung — der Kiel schrammt über den Fels!");
            break;
         case "cutAway":
            if (isUs) this.ui.showMessage("Wrack gekappt — das Schiff ist wieder frei.");
            break;
         default: break;
      }
   }

   _onWorldEvent(ev) {
      if (ev.type === "collision") {
         const us = ev.a === this.player || ev.b === this.player;
         if (us) {
            this.cam.shake(1.6);
            this.ui.showMessage("Zusammenstoß! " + ev.closing.toFixed(1) + " kn Annäherung.");
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
         sea: { hs: waveHeightForWind(this.seaWind), name: seaStateName(this.seaWind) },
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
         faction: this.faction,
         guns: this.battery.status(),
         sailSet: b.sailSet,
         damage: this.player.dmg.status(),
         crew: this.player.crew.status(),
         wreck: this.debris.hasWreckage(this.player.id),
         wreckDrag: this.player.wreckDrag,
         depth: this.terrain.visible ? this.terrain.depthAt(b.pos.x, b.pos.z) : null,
         enemies: this.mode === "Gefecht" ? this.fleet.ships.map((sh) => {
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