// ship.js - ein Schiff als Ganzes: 3D-Modell, Fahrdynamik, Schadensmodell und
// Batterie in einer Einheit. Spieler und Gegner benutzen dieselbe Klasse; der
// Unterschied ist nur, wer das Ruder bedient.
//
// Die Klasse verbindet auch die Folgen: was das Schadensmodell feststellt,
// wirkt hier auf die Fahrdynamik (Segelkraft, Ruder, Widerstand, Schlagseite)
// und auf das Aussehen (Loecher, gefallene Masten, Brand, gestrichene Flagge).

import * as THREE from "three";
import { buildSailboat } from "./boat.js";
import { buildWarship, freeboardOf } from "./warship.js";
import { BoatDynamics } from "./physics.js";
import { DamageModel } from "./damage.js";
import { Crew } from "./crew.js";
import { buildCrewView } from "./crewview.js";
import { Battery } from "./guns.js";
import { seaHeight } from "./ocean.js";
import { clamp, lerp, DEG, dirVec, normDeg, diffDeg } from "./utils.js";
import { shipPose, railClearance, lerpPose, lerpVec, systemRng, deriveRng } from "@segel/shared";
import { DebrisField, RHO } from "./debris.js";

let _nextId = 1;

export class Ship {
   constructor(opts = {}) {
      this.id = opts.id || ("ship" + _nextId++);
      this.vessel = opts.vessel;
      this.isPlayer = !!opts.isPlayer;
      this.scene = opts.scene;             // Szene-API (add/remove) oder THREE.Scene
      this.debris = opts.debris || null;
      this.name = opts.name || this.vessel.name;

      // Zufallsquelle (Phase 0D). Wer einen Seed uebergibt, bekommt ein
      // vollstaendig wiederholbares Schiff: Schadenswuerfe, Mannschafts-
      // verluste und Salven haengen dann nur noch am Seed. Ohne Seed bleibt es
      // Math.random - der Einzelspielerpfad.
      this.rng = opts.rng
         ? opts.rng
         : opts.seed !== undefined
           ? deriveRng(opts.seed, this.id)
           : systemRng;

      // --- 3D-Modell ---
      this.model = this.vessel.rig === "square" ? buildWarship(this.vessel) : buildSailboat();
      this._addToScene(this.model);

      // --- Fahrdynamik ---
      this.dyn = new BoatDynamics({
         vessel: this.vessel,
         heading: opts.heading ?? 0,
         x: opts.x ?? 0,
         z: opts.z ?? 0,
         autoTrim: true,
      });

      // --- Schaden ---
      this.faction = opts.faction || null;   // Eintrag aus factions.js
      this.gunnery = this.faction ? this.faction.gunnery : 1;
      this.dmg = new DamageModel(this.vessel, {
         isPlayer: this.isPlayer,
         neverStrikes: !!(this.faction && this.faction.neverStrikes),
         rng: this.rng,
      });

      // Freibord bis Oberkante Schanzkleid - Grenze, ab der die See ueber Deck
      // laeuft. Die Yacht hat kein Schanzkleid, dort reicht ein flacher Wert.
      this.freeboard = this.model.userData.FB
         ?? (this.vessel.rig === "square" ? freeboardOf(this.vessel)
            : this.vessel.hull.draft * 0.55);
      this.railClear = this.freeboard;
      this._swampT = 0;

      // --- Mannschaft ---
      this.crew = new Crew(this.vessel, { isPlayer: this.isPlayer, rng: this.rng });
      // Die Leute an Deck (nur Kriegsschiffe haben genug davon)
      this.crewView = null;
      if (this.vessel.rig === "square" && this.model.userData.deckAt) {
         this.crewView = buildCrewView(this.model, this.vessel);
         this.model.userData.heeler.add(this.crewView.group);
         this.crewView.setStrength(this.crew.status());
      }
      this._sailWork = 0;
      this._lastSailSet = 1;

      // --- Batterie ---
      this.battery = new Battery(this._rawScene(), {
         sound: opts.sound !== false,
         ownerId: this.id,
         rng: this.rng,
         targets: opts.targets || (() => []),
         onHit: opts.onHit || null,
         onReloadDone: opts.onReloadDone || null,
      });
      this.battery.setShip(this.model, this.vessel);

      this.alive = true;
      this.sinkTimer = 0;
      this.wreckDrag = 0;
      this.recoilRoll = 0;
      this.groundedFor = 0;
      this.lastHitAt = -99;
      this._tmp = new THREE.Vector3();
      this._events = [];
   }

   _rawScene() { return this.scene && this.scene.scene ? this.scene.scene : this.scene; }
   _addToScene(o) { if (this.scene && this.scene.add) this.scene.add(o); }
   _removeFromScene(o) { if (this.scene && this.scene.remove) this.scene.remove(o); }

   get pos() { return this.dyn.pos; }
   get heading() { return this.dyn.heading; }
   get speed() { return this.dyn.speed; }
   get tons() { return this.vessel.hull.displacement || 100; }
   get armed() { return !!this.vessel.guns; }

   drainEvents() { const e = this._events; this._events = []; return e; }

   // Beschreibung fuer die Trefferpruefung der Geschuetze
   targetInfo() {
      const u = this.model.userData;
      return {
         id: this.id,
         ship: this,
         heeler: u.heeler,
         // Live-Referenz: Three.js schreibt die Matrix in place fort. Die
         // geteilte Trefferpruefung bekommt damit genau die Matrix, die auch
         // der Renderer benutzt - und der Server spaeter dieselbe aus
         // shipPose().
         matrixWorld: u.heeler.matrixWorld,
         LOA: this.vessel.hull.loa,
         BEAM: this.vessel.hull.beam,
         DRAFT: this.vessel.hull.draft,
         FB: u.FB ?? this.vessel.hull.draft,
         rigTop: u.rigTop || 0,
         rigHalfWidth: u.rigHalfWidth || this.vessel.hull.beam,
      };
   }

   place(x, z, heading, speed = 0) {
      this.dyn.pos.x = x;
      this.dyn.pos.z = z;
      this.dyn.heading = normDeg(heading);
      this.dyn.groundHeading = this.dyn.heading;
      this.dyn.speed = speed;
      this.dyn.heel = 0;
      this.dyn.heelLerp = 0;
      this.dyn.leeway = 0;
      return this;
   }

   // ------------------------------------------------------------------
   // Treffer einstecken: Schaden buchen und das Bild danach herstellen
   // ------------------------------------------------------------------
   takeHit(hit) {
      if (!this.alive) return null;
      const u = this.model.userData;
      const res = this.dmg.applyHit({
         side: hit.side,
         s: hit.s,
         y: hit.y,
         ammo: hit.ammo,
         lb: hit.lb,
         range01: hit.range01,
         freeboard: u.FB ?? 4,
      });
      if (!res) return null;
      // Verluste an Bord buchen
      if (res.crew && res.crew.n > 0) {
         const c = this.crew.hit(res.crew.n, res.crew.where);
         res.crewHurt = c.hurt;
         res.crewKilled = c.killed;
      }
      this.lastHitAt = 0;
      this._spawnHitFx(hit, res);
      this._syncAppearance();
      return res;
   }

   _spawnHitFx(hit, res) {
      const D = this.debris;
      if (!D) return;
      const world = hit.world || this._tmp.set(0, 0, 0);
      const outward = hit.dir ? hit.dir.clone().negate() : new THREE.Vector3(0, 1, 0);

      if (hit.inRig) {
         // Der Treffer geht in ein bestimmtes Segel - dort reisst das Tuch auf
         if (this.model.damageSail) {
            const mast = hit.s < 0.38 ? "fore" : hit.s < 0.72 ? "main" : "mizzen";
            const lvl = hit.y > (this.model.userData.rigTop || 40) * 0.62 ? "topgallant"
               : hit.y > (this.model.userData.rigTop || 40) * 0.36 ? "topsail" : "course";
            this.model.damageSail(mast, lvl, 0.05 + Math.random() * 0.10);
         }
         // Zerschossenes Tauwerk und Tuchfetzen segeln nach Lee weg
         const n = Math.round(1 + Math.random() * 3);
         for (let i = 0; i < n; i++) {
            D.spawnCanvas(world, outward, 0.8 + Math.random() * 2.2, 0.7 + Math.random() * 1.8,
               { speed: 4 + Math.random() * 6 });
         }
         if (Math.random() < 0.35) {
            D.spawnSpar(world, outward, 1.5 + Math.random() * 4, 0.07 + Math.random() * 0.06,
               { speed: 5 + Math.random() * 5 });
         }
      } else {
         // Splitterhagel aus der Bordwand - nach innen UND nach aussen
         if (res.splinters > 0) {
            D.spawnSplinters(world, outward, Math.ceil(res.splinters * 0.55),
               { speed: 13 + Math.random() * 10, color: 0xa98b5c, scale: this.vessel.hull.loa / 43 });
            D.spawnSplinters(world, hit.dir || outward, Math.floor(res.splinters * 0.45),
               { speed: 9 + Math.random() * 8, color: 0x7d6238, scale: this.vessel.hull.loa / 43 });
         }
         if (res.holed && this.model.addHole) {
            this.model.addHole(res.side, res.s, res.y, res.below ? 0.5 : 0.3);
         }
         if (res.holed && Math.random() < 0.4) {
            D.spawnPlank(world, outward, {
               l: 1.2 + Math.random() * 2.0, color: 0x6b5433, speed: 7 + Math.random() * 6,
            });
         }
      }
      if (res.mastBroken) this._dropMast(res.mastBroken.mast, "shot");
   }

   // ------------------------------------------------------------------
   // Mast geht ueber Bord
   // ------------------------------------------------------------------
   _dropMast(key, cause) {
      if (!this.model.detachMast) return null;
      const d = this.model.detachMast(key);
      if (!d) return null;
      // Modell und Schadensmodell duerfen nie auseinanderlaufen: egal ueber
      // welchen Weg der Mast faellt, er gilt danach als verloren.
      if (this.dmg.masts[key] && this.dmg.masts[key].state !== "gone") {
         this.dmg.breakMast(key, cause);
      }

      // Ein Mast geht nicht lautlos ueber Bord: die Toppsgasten in seinen
      // Wanten gehen mit, und herabstuerzendes Rundholz und Tauwerk fegen das
      // Deck. Das kostet Leute - auch wenn kein Schuss gefallen ist.
      const aloft = Math.round(this.crew.total * (0.008 + this.rng() * 0.014));
      if (aloft > 0) this.crew.hit(aloft, "rigg");
      const onDeck = Math.round(this.crew.total * (0.003 + this.rng() * 0.007));
      if (onDeck > 0) this.crew.hit(onDeck, "deck");
      this.crew.shock(0.30);

      // Das Ereignis meldet das Schadensmodell - hier nicht noch einmal.

      if (!this.debris) {
         this.model.remove(d.group);
         return null;
      }

      // Startbewegung: Schiffsfahrt plus Kippen nach Lee. Ein Mast faellt
      // dorthin, wohin der Wind drueckt - also auf die Leeseite.
      const leeSign = this.dyn.twaSigned > 0 ? -1 : 1; // Lee = dem Wind abgewandt
      const fwd = dirVec(this.dyn.heading);
      const vel = new THREE.Vector3(
         fwd.x * this.dyn.speed * 0.514444,
         0,
         fwd.z * this.dyn.speed * 0.514444);
      // Drehachse: laengsschiffs, damit er quer ueber Bord geht
      const axis = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const omega = axis.multiplyScalar(leeSign * (0.55 + Math.random() * 0.35));

      // Der Mast ist ein langes Rundholz, kein Ball: Auftrieb und Gewicht
      // werden ueber die ganze Laenge verteilt. Sonst stellt er sich im Wasser
      // senkrecht auf wie eine Spierentonne, statt flach umzukippen.
      const H = d.height;
      const axisLocal = new THREE.Vector3(0, 1, 0);   // Mastgruppe: +Y = nach oben
      const probes = DebrisField.probesAlongAxis(
         axisLocal, 0, H, d.volume, 11,
         // Untermast dick, Bramstenge duenn - daher liegt der Schwerpunkt tief
         (u) => Math.pow(1 - 0.72 * u, 2),
         // halbe Dicke am Mastfuss; damit schwimmt er wie ein Rundholz auf
         Math.max(this.vessel.hull.beam * 0.045, 0.30));
      // Schwerpunkt aus derselben Verteilung
      let wsum = 0, wy = 0;
      for (const pr of probes) { wsum += pr.vol; wy += pr.vol * pr.p.y; }
      const com = new THREE.Vector3(0, wy / Math.max(wsum, 1e-6), 0);

      const piece = this.debris.capture(d.group, {
         vel,
         omega,
         mass: d.mass,
         volume: d.volume,
         radius: H * 0.06,
         com,
         probes,
         // Traegheitsmoment eines Stabs um den Schwerpunkt
         inertia: d.mass * H * H / 12,
         cdWater: 1.5,
         angDrag: 0.55,
         life: 999,
         disposable: true,
         tether: {
            owner: this.id,
            local: d.anchorLocal.clone(),
            // Er haengt am Mastfuss im stehenden Gut - dort greift die Trosse an
            attach: new THREE.Vector3(0, 0, 0),
            len: Math.max(H * 0.10, 4),
         },
      });
      return piece;
   }

   // Wrack kappen: Beile an die Wanten, das Schiff ist wieder frei
   cutAwayWreckage() {
      if (!this.debris) return 0;
      const n = this.debris.cutTethers(this.id);
      if (n > 0) this._events.push({ type: "cutAway", ship: this, n });
      return n;
   }

   // ------------------------------------------------------------------
   // Rammstoss und Grundberuehrung
   // ------------------------------------------------------------------
   takeRam(info) {
      const res = this.dmg.applyRam(info);
      // Ein Zusammenstoss wirft die halbe Wache von den Beinen
      const n = Math.round(this.crew.total * clamp(Math.abs(info.closingKts || 0) * 0.0016, 0, 0.05));
      if (n > 0) this.crew.hit(n, "deck");
      this.crew.shock(0.22);
      if (this.debris) {
         const p = this._tmp.set(this.pos.x, (this.model.userData.FB || 3) * 0.5, this.pos.z);
         this.debris.spawnSplinters(p, new THREE.Vector3(0, 0.5, 0), res.splinters,
            { speed: 12, color: 0x8e7245, scale: this.vessel.hull.loa / 43 });
      }
      if (res.holed || res.below) this.model.addHole && this.model.addHole(res.side, res.s ?? 0.3, 0.4, 0.6);
      if (res.mastBroken) this._dropMast(res.mastBroken.mast, "ram");
      this._syncAppearance();
      return res;
   }

   takeGrounding(info) {
      const d = this.dmg.applyGrounding(info);
      if (d > 0.04) {
         const n = Math.round(this.crew.total * clamp(d * 0.12, 0, 0.04));
         if (n > 0) this.crew.hit(n, "deck");
         this.crew.shock(0.18);
      }
      if (d > 0.02 && this.debris) {
         const p = this._tmp.set(this.pos.x, 0.2, this.pos.z);
         this.debris.spawnSplinters(p, new THREE.Vector3(0, 1, 0), 14, { speed: 9, color: 0x6f5836 });
      }
      return d;
   }

   // ------------------------------------------------------------------
   // Erscheinungsbild an den Schadenszustand angleichen
   // ------------------------------------------------------------------
   _syncAppearance() {
      const m = this.model;
      if (m.setGunFraction) {
         m.setGunFraction("PORT", this.dmg.guns.PORT);
         m.setGunFraction("STBD", this.dmg.guns.STBD);
      }
      if (m.setSailDamage) m.setSailDamage(this.dmg.sails);
      if (m.setFire) m.setFire(this.dmg.afire);
      if (m.setStruck) m.setStruck(this.dmg.struck);
   }

   // ------------------------------------------------------------------
   // Schritt
   // ------------------------------------------------------------------
   // ctx: { wind {dir,speedKts}, t, waveRad, amp, dt }
   update(dt, ctx) {
      if (!this.alive) return;
      const D = this.dmg;
      const dyn = this.dyn;
      const u = this.model.userData;

      // --- Schaden fortschreiben -----------------------------------------
      D.update(dt, { heel: dyn.heel });
      if (this.vessel.rig === "square") {
         const broke = D.stressRig(dt, {
            windKts: ctx.wind.speedKts,
            sailSet: dyn.sailSet,
            twa: dyn.twa,
         });
         if (broke) this._dropMast(broke.mast, "overpress");
      }
      // Eine ausgeblutete Besatzung kaempft nicht weiter
      if (!this.isPlayer && !D.struck && !D.neverStrikes
            && this.crew.morale() < 0.12 && this.crew.losses > 8) {
         D.struck = true;
         D._event("struck", {});
      }
      for (const ev of D.drainEvents()) {
         this._events.push({ ...ev, ship: this });
         if (ev.type === "struck" || ev.type === "sunk") this._syncAppearance();
      }
      if (D.afire > 0.02 && this.model.setFire) this.model.setFire(D.afire);

      // --- Aus den Lieken geflogene Segel ---------------------------------
      if (this.model.drainBlownSails) {
         const blown = this.model.drainBlownSails();
         if (blown.length) {
            // nach Lee: der Wind traegt das Tuch dorthin, wohin er weht
            const lee = dirVec(ctx.wind.dir + 180);
            const leeVec = new THREE.Vector3(lee.x, 0.25, lee.z).normalize();
            const wkt = ctx.wind.speedKts;
            for (const b of blown) {
               this._events.push({ type: "sailBlown", ship: this, level: b.level, mast: b.mastKey });
               if (!this.debris) continue;
               // Ein ganzes Segel geht nicht am Stueck ueber Bord - es reisst
               // in mehrere flatternde Bahnen.
               const strips = 3 + Math.floor(Math.random() * 3);
               for (let k = 0; k < strips; k++) {
                  const p = b.pos.clone().add(new THREE.Vector3(
                     (Math.random() - 0.5) * b.w * 0.7,
                     (Math.random() - 0.5) * b.h * 0.6,
                     (Math.random() - 0.5) * b.w * 0.3));
                  this.debris.spawnCanvas(p, leeVec,
                     b.w * (0.18 + Math.random() * 0.22),
                     b.h * (0.35 + Math.random() * 0.45),
                     { speed: wkt * 0.35 + 3 + Math.random() * 5 });
               }
            }
         }
      }

      // --- Schadensfolgen auf die Fahrdynamik ----------------------------
      this.wreckDrag = this.debris ? this.debris.tetherLoad(this.id) : 0;
      dyn.driveMul = D.driveFactor();
      dyn.rudderMul = D.rudderFactor() * (1 - 0.35 * this.wreckDrag);
      dyn.dragMul = 1 + 1.8 * this.wreckDrag + 0.7 * D.flooding;
      // Ein Wrack an einer Seite zieht das Schiff staendig in diese Richtung
      dyn.turnBias = this.wreckDrag * 7 * (this.dyn.twaSigned > 0 ? -1 : 1);
      dyn.heelBias = D.floodHeel();
      // Mannschaft: bediente Rohre, Ladegeschwindigkeit, Segelmanoever, Ruder
      const gun = this.crew.gunnery();
      this.battery.effectiveness.PORT = D.gunFraction("PORT") * gun.served;
      this.battery.effectiveness.STBD = D.gunFraction("STBD") * gun.served;
      if (this.vessel.guns) {
         this.battery.reloadTime = this.vessel.guns.reload / Math.max(gun.rate, 0.2);
      }
      dyn.driveMul *= 0.55 + 0.45 * this.crew.sailHandling();
      dyn.rudderMul *= this.crew.command();

      // Wird gerade Segel bedient? Dann sind die Toppsgasten in den Wanten.
      const dSet = Math.abs(dyn.sailSet - this._lastSailSet);
      this._lastSailSet = dyn.sailSet;
      this._sailWork = clamp(Math.max(this._sailWork - dt * 0.22, dSet > 1e-4 ? 1 : 0), 0, 1);

      // --- Fahren --------------------------------------------------------
      dyn.step(dt, ctx.wind, null);

      // --- Sinken ---------------------------------------------------------
      if (D.sunk) {
         this.sinkTimer += dt;
         this._sinkStep(dt, ctx);
         if (this.sinkTimer > 16) this.alive = false;
         return;
      }

      this.placeOnSea(dt, ctx);
      this.animate(dt, ctx);
      this.updateCrewView(dt, ctx);
   }

   // Untergang: das Schiff sackt weg und rollt dabei auf die Leckseite
   _sinkStep(dt, ctx) {
      const p = this.pos;
      const hy = seaHeight(p.x, p.z, ctx.waveT ?? ctx.t, ctx.waveRad, ctx.amp, ctx.lambda ?? 1) * 0.9;
      const sink = Math.pow(this.sinkTimer / 16, 1.6) * this.vessel.hull.loa * 0.55;
      this.model.position.set(p.x, hy - sink, p.z);
      this.model.rotation.y = this.dyn.heading * DEG;
      const heeler = this.model.userData.heeler;
      heeler.rotation.z = lerp(heeler.rotation.z, 0.9, Math.min(1, dt * 0.35));
      heeler.rotation.x = lerp(heeler.rotation.x, -0.25, Math.min(1, dt * 0.3));
      // Auch der Untergang liefert Lagen fuer die Zwischenbild-Interpolation,
      // sonst ruckelt ein sinkendes Schiff auf Simulationsrate.
      this._posePrev = this._poseCurr || null;
      this._poseCurr = {
         y: hy - sink, rollZ: heeler.rotation.z, pitchX: heeler.rotation.x,
         yawY: this.dyn.heading * DEG, seaY: hy, leeY: hy, sinkIn: sink,
      };
      if (!this._posePrev) this._posePrev = this._poseCurr;
      this._posPrev = this._posCurr || { x: p.x, z: p.z };
      this._posCurr = { x: p.x, z: p.z };
      if (this.debris && Math.random() < dt * 6) {
         this.debris.spawnPlank(
            new THREE.Vector3(p.x + (Math.random() - 0.5) * this.vessel.hull.beam,
               hy + 1, p.z + (Math.random() - 0.5) * this.vessel.hull.loa * 0.6),
            new THREE.Vector3(0, 1, 0),
            { l: 1 + Math.random() * 3, speed: 2, color: 0x6b5433 });
      }
   }

   // Auf der Welle platzieren (Auftrieb, Rollen, Stampfen)
   //
   // Die Lage selbst rechnet shipPose() in @segel/shared - dieselbe Funktion,
   // aus der der Server seine Trefferpruefungs-Matrix baut. Hier wird sie nur
   // auf das Three.js-Modell gesetzt.
   //
   // Aufgerufen wird das mit FESTEM Simulationsschritt. Fuer die Darstellung
   // zwischen zwei Schritten gibt es applyPose(alpha).
   placeOnSea(dt, ctx) {
      const wt = ctx.waveT ?? ctx.t;
      const lam = ctx.lambda ?? 1;
      const sea = (x, z) => seaHeight(x, z, wt, ctx.waveRad, ctx.amp, lam);

      const kick = this.battery.rollKick * this.battery.rollKickSide;
      this.recoilRoll = lerp(this.recoilRoll, kick, clamp(dt * 9, 0, 1));

      const pose = shipPose({
         pos: this.pos,
         heading: this.dyn.heading,
         heel: this.dyn.heel,
         twaSigned: this.dyn.twaSigned,
         flooding: this.dmg.flooding,
         recoilRoll: this.recoilRoll,
         hull: this.vessel.hull,
      }, sea);

      // Zwei Lagen vorhalten: die vorige und die aktuelle. Dazwischen
      // interpoliert applyPose() beim Rendern.
      this._posePrev = this._poseCurr || pose;
      this._poseCurr = pose;
      this._posPrev = this._posCurr || { x: this.pos.x, z: this.pos.z };
      this._posCurr = { x: this.pos.x, z: this.pos.z };

      this._applyPoseExact(pose, this._posCurr);

      // --- Wasser ueber die Reling --------------------------------------
      this._swampCheck(dt, pose);
   }

   /** Eine fertige Lage auf das Modell schreiben. */
   _applyPoseExact(pose, pos) {
      this.model.position.set(pos.x, pose.y, pos.z);
      this.model.rotation.y = pose.yawY;
      const heeler = this.model.userData.heeler;
      heeler.rotation.z = pose.rollZ;
      heeler.rotation.x = pose.pitchX;
      // Weltmatrizen sofort nachziehen: die Trefferpruefung der Geschuetze
      // rechnet in Schiffskoordinaten und darf sich nicht darauf verlassen,
      // dass der Renderer sie schon aktualisiert hat.
      this.model.updateMatrixWorld(true);
   }

   /**
    * Darstellungslage zwischen den letzten beiden Simulationsschritten.
    * alpha = 0 -> vorheriger Schritt, 1 -> aktueller. Rein visuell: die
    * Simulation liest diese Werte nie zurueck.
    */
   applyPose(alpha) {
      if (!this._poseCurr) return;
      // Ohne eine zweite Lage gibt es nichts zu mischen.
      if (!this._posePrev) {
         this._applyPoseExact(this._poseCurr, this._posCurr);
         return;
      }
      // alpha ist der Restanteil im laufenden Schritt: 0 heisst "noch keine
      // Zeit im aktuellen Schritt vergangen", also die VORIGE Lage. Das Bild
      // laeuft damit um bis zu einen Simulationsschritt (33 ms) hinterher -
      // der uebliche Preis dafuer, dass nie extrapoliert und nie geruckt wird.
      const a = clamp(alpha, 0, 1);
      this._applyPoseExact(
         lerpPose(this._posePrev, this._poseCurr, a),
         lerpVec(this._posPrev, this._posCurr, a),
      );
   }

   // Freibord der Lee-Reling ueber der oertlichen Wasserflaeche.
   // Negativ = die See laeuft ueber Deck. Formel in @segel/shared/pose.
   railClearance(rollRad, halfBeam, sinkIn, hy, hLee) {
      return railClearance(this.freeboard, rollRad, halfBeam, sinkIn, hy, hLee);
   }

   _swampCheck(dt, pose) {
      const clear = this.railClearance(
         pose.rollZ, this.vessel.hull.beam / 2, pose.sinkIn, pose.seaY, pose.leeY);
      this.railClear = clear;
      if (clear >= 0 || this.dmg.sunk) { this._swampT = 0; return; }
      const depth = Math.min(-clear, 2.5);
      this._swampT = (this._swampT || 0) + dt;
      // Wassereinbruch ueber Deck: als offenes Leck buchen, damit die Pumpen
      // und die Sinkmechanik davon wissen.
      this.dmg.flooding = clamp(
         this.dmg.flooding + depth * 0.022 * dt, 0, 1);
      // Leute, die an Deck arbeiten, gehen ueber Bord
      if (this.crew && this.rng() < depth * 0.18 * dt) {
         this.crew.hit(1 + ((this.rng() * 2) | 0), "deck");
         if (this.crew.shock) this.crew.shock(0.04);
      }
      if (this._swampT > 1.2) {
         this._swampT = 0;
         this.dmg._event("swamped", { depth });
      }
   }

   animate(dt, ctx) {
      const aw = this.dyn.appWind(ctx.wind);
      const awaRel = diffDeg(this.dyn.heading, aw.from);
      const awaAbs = Math.abs(awaRel);
      const boomMag = clamp((awaAbs - 30) * 0.72, 4, 88);
      this.model.animate(dt, {
         rudderAngle: this.dyn.rudder * 35,
         boomAngleDeg: (awaRel > 0 ? -1 : 1) * boomMag,
         luffing: this.dyn.luffing ? 1 : 0,
         windKts: ctx.wind.speedKts,
         awaRel,
         sailSet: this.dyn.sailSet,
         time: ctx.t,
      });
      this.lastHitAt += dt;
   }

   // Die Mannschaft an ihren Stationen bewegen
   updateCrewView(dt, ctx) {
      const cv = this.crewView;
      if (!cv) return;
      // Weit entfernte Schiffe brauchen keine animierte Besatzung
      if (ctx.crewLod === false) { cv.group.visible = false; return; }
      cv.group.visible = true;
      cv.setStrength(this.crew.status());
      const B = this.battery;
      const rt = Math.max(B.reloadTime, 0.1);
      cv.update(dt, {
         time: ctx.t,
         reload: {
            PORT: clamp(B.reload.PORT / rt, 0, 1),
            STBD: clamp(B.reload.STBD / rt, 0, 1),
         },
         rudder: this.dyn.rudder,
         flooding: this.dmg.flooding,
         sailWork: this._sailWork,
         lostMasts: this.model.userData.lostMasts,
         struck: this.dmg.struck,
      });
   }

   // Ankerpunkt fuer eine Trosse (Wrack am stehenden Gut)
   anchorPoint(local, out) {
      const h = this.model.userData.heeler;
      h.updateMatrixWorld();
      out.copy(local);
      h.localToWorld(out);
      return out;
   }

   dispose() {
      this.battery.clear();
      if (this.crewView) this.crewView.dispose();
      this._removeFromScene(this.model);
      this.model.traverse((o) => {
         if (o.geometry) o.geometry.dispose();
         const m = o.material;
         if (Array.isArray(m)) m.forEach((x) => x && x.dispose && x.dispose());
         else if (m && m.dispose) m.dispose();
      });
   }
}

export default { Ship };
