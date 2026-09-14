// ship.js - a ship as a whole: 3D model, sailing dynamics, damage model and
// battery in one unit. Player and enemies use the same class; the only
// difference is who works the helm.
//
// The class also connects the consequences: what the damage model
// determines affects the sailing dynamics here (sail power, rudder, drag,
// heel) and the appearance (holes, fallen masts, fire, struck colours).

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
import { shipPose, swampStep, lerpPose, lerpVec, systemRng, deriveRng } from "@quarterdeck/shared";
import { DebrisField, RHO } from "./debris.js";

let _nextId = 1;

export class Ship {
   constructor(opts = {}) {
      this.id = opts.id || ("ship" + _nextId++);
      this.vessel = opts.vessel;
      this.isPlayer = !!opts.isPlayer;
      this.scene = opts.scene;             // scene API (add/remove) or THREE.Scene
      this.debris = opts.debris || null;
      this.name = opts.name || this.vessel.name;

      // Random source (Phase 0D). Whoever passes a seed gets a fully
      // repeatable ship: damage rolls, crew losses and salvoes then depend
      // only on the seed. Without a seed it stays Math.random - the
      // single-player path.
      this.rng = opts.rng
         ? opts.rng
         : opts.seed !== undefined
           ? deriveRng(opts.seed, this.id)
           : systemRng;

      // --- 3D model ---
      this.model = this.vessel.rig === "square" ? buildWarship(this.vessel) : buildSailboat();
      this._addToScene(this.model);

      // --- Sailing dynamics ---
      this.dyn = new BoatDynamics({
         vessel: this.vessel,
         heading: opts.heading ?? 0,
         x: opts.x ?? 0,
         z: opts.z ?? 0,
         autoTrim: true,
      });

      // --- Damage ---
      this.faction = opts.faction || null;   // entry from factions.js
      this.gunnery = this.faction ? this.faction.gunnery : 1;
      this.dmg = new DamageModel(this.vessel, {
         isPlayer: this.isPlayer,
         neverStrikes: !!(this.faction && this.faction.neverStrikes),
         rng: this.rng,
      });

      // Freeboard up to the top of the bulwark - the threshold beyond which
      // the sea runs over the deck. The yacht has no bulwark, a flat value
      // is enough there.
      this.freeboard = this.model.userData.FB
         ?? (this.vessel.rig === "square" ? freeboardOf(this.vessel)
            : this.vessel.hull.draft * 0.55);
      this.railClear = this.freeboard;
      // Water-over-the-rail bookkeeping; the check itself is shared with the server.
      this._swamp = { swampT: 0, railClear: this.freeboard };

      // --- Crew ---
      this.crew = new Crew(this.vessel, { isPlayer: this.isPlayer, rng: this.rng });
      // The people on deck (only warships have enough of them)
      this.crewView = null;
      if (this.vessel.rig === "square" && this.model.userData.deckAt) {
         this.crewView = buildCrewView(this.model, this.vessel);
         this.model.userData.heeler.add(this.crewView.group);
         this.crewView.setStrength(this.crew.status());
      }
      this._sailWork = 0;
      this._lastSailSet = 1;

      // --- Battery ---
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

      // Multiplayer: when set, the server owns damage and its effect on the
      // dynamics. update() then takes these multipliers instead of computing
      // them from the local damage model, and skips what the server does
      // (rig stress, water over the rail, striking).
      this.serverDriven = null;
      // Multiplayer: a correction the picture still has to absorb - added to
      // the drawn position and heading, decays to zero (see Predictor).
      this.viewOffset = null;
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

   // Description for the guns' hit detection
   targetInfo() {
      const u = this.model.userData;
      return {
         id: this.id,
         ship: this,
         heeler: u.heeler,
         // Live reference: Three.js keeps writing the matrix in place. That
         // way the shared hit detection gets exactly the matrix the renderer
         // also uses - and later the server the same one from shipPose().
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
   // Take a hit: book the damage and update the visuals afterwards
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
      // Book casualties aboard
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

   /**
    * Multiplayer: a hit the server resolved (HitEvent). Effects only - the
    * damage values come with the state, the mast with its own event.
    */
   showHit(ev) {
      if (!this.alive) return;
      const hit = {
         world: new THREE.Vector3(ev.world.x, ev.world.y, ev.world.z),
         dir: new THREE.Vector3(ev.dir.x, ev.dir.y, ev.dir.z),
         inRig: !!ev.inRig, s: ev.s, y: ev.y,
      };
      const res = {
         splinters: ev.splinters || 0, holed: !!ev.holed, below: !!ev.below,
         side: ev.side, s: ev.s, y: ev.y, mastBroken: null,
      };
      this.lastHitAt = 0;
      this._spawnHitFx(hit, res);
   }

   /**
    * Multiplayer: take the damage detail from a ShipState so the plan, the
    * masts, the guns and the ensign show what the server knows.
    */
   applyDamageState(s) {
      const D = this.dmg;
      D.hull.PORT_BOW = s.hullPortBow; D.hull.PORT_MID = s.hullPortMid; D.hull.PORT_QUARTER = s.hullPortQuarter;
      D.hull.STBD_BOW = s.hullStbdBow; D.hull.STBD_MID = s.hullStbdMid; D.hull.STBD_QUARTER = s.hullStbdQuarter;
      D.rigging = s.rigging;
      D.sails = s.sails;
      D.rudder = s.rudderState;
      D.guns.PORT = s.gunsPort;
      D.guns.STBD = s.gunsStbd;
      D.flooding = s.flooding;
      D.afire = s.afire;
      const ST = ["sound", "wounded", "gone"];
      for (const [key, integ, st] of [["fore", s.mastFore, s.mastForeState], ["main", s.mastMain, s.mastMainState], ["mizzen", s.mastMizzen, s.mastMizzenState]]) {
         const m = D.masts[key];
         if (!m) continue;
         m.integrity = integ;
         m.state = ST[st] || "sound";
      }
      const was = `${D.struck}|${D.sunk}|${D.afire > 0.02}|${D.guns.PORT}|${D.guns.STBD}|${D.sails}`;
      D.struck = !!s.struck;
      D.sunk = !!s.sunk;
      const now = `${D.struck}|${D.sunk}|${D.afire > 0.02}|${D.guns.PORT}|${D.guns.STBD}|${D.sails}`;
      if (was !== now) this._syncAppearance();
      this.wreckDrag = s.wreckDrag;
   }

   _spawnHitFx(hit, res) {
      const D = this.debris;
      if (!D) return;
      const world = hit.world || this._tmp.set(0, 0, 0);
      const outward = hit.dir ? hit.dir.clone().negate() : new THREE.Vector3(0, 1, 0);

      if (hit.inRig) {
         // The hit goes into a particular sail - the canvas tears open there
         if (this.model.damageSail) {
            const mast = hit.s < 0.38 ? "fore" : hit.s < 0.72 ? "main" : "mizzen";
            const lvl = hit.y > (this.model.userData.rigTop || 40) * 0.62 ? "topgallant"
               : hit.y > (this.model.userData.rigTop || 40) * 0.36 ? "topsail" : "course";
            this.model.damageSail(mast, lvl, 0.05 + Math.random() * 0.10);
         }
         // Shot-up rigging and torn canvas sail away to leeward
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
         // A hail of splinters from the hull side - inward AND outward
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
   // Mast goes overboard
   // ------------------------------------------------------------------
   _dropMast(key, cause) {
      if (!this.model.detachMast) return null;
      const d = this.model.detachMast(key);
      if (!d) return null;
      // Model and damage model must never diverge: no matter how the mast
      // falls, it counts as lost afterwards.
      if (this.dmg.masts[key] && this.dmg.masts[key].state !== "gone") {
         this.dmg.breakMast(key, cause);
      }

      // A mast doesn't go overboard quietly: the topmen in its shrouds go
      // with it, and falling spars and rigging sweep the deck. That costs
      // lives - even when no shot has been fired.
      const aloft = Math.round(this.crew.total * (0.008 + this.rng() * 0.014));
      if (aloft > 0) this.crew.hit(aloft, "rigging");
      const onDeck = Math.round(this.crew.total * (0.003 + this.rng() * 0.007));
      if (onDeck > 0) this.crew.hit(onDeck, "deck");
      this.crew.shock(0.30);

      // The damage model reports the event - not again here.

      if (!this.debris) {
         this.model.remove(d.group);
         return null;
      }

      // Initial motion: the ship's way plus a tip to leeward. A mast falls
      // in the direction the wind pushes it - that is, to the lee side.
      const leeSign = this.dyn.twaSigned > 0 ? -1 : 1; // leeward = facing away from the wind
      const fwd = dirVec(this.dyn.heading);
      const vel = new THREE.Vector3(
         fwd.x * this.dyn.speed * 0.514444,
         0,
         fwd.z * this.dyn.speed * 0.514444);
      // Rotation axis: fore-and-aft, so it goes over the side crosswise
      const axis = new THREE.Vector3(fwd.x, 0, fwd.z).normalize();
      const omega = axis.multiplyScalar(leeSign * (0.55 + Math.random() * 0.35));

      // The mast is a long spar, not a ball: buoyancy and weight are
      // distributed over its whole length. Otherwise it would stand upright
      // in the water like a spar buoy, instead of tipping over flat.
      const H = d.height;
      const axisLocal = new THREE.Vector3(0, 1, 0);   // mast group: +Y = up
      const probes = DebrisField.probesAlongAxis(
         axisLocal, 0, H, d.volume, 11,
         // Lower mast thick, topgallant mast thin - so the centre of mass sits low
         (u) => Math.pow(1 - 0.72 * u, 2),
         // half the thickness at the foot of the mast; so it floats like a spar
         Math.max(this.vessel.hull.beam * 0.045, 0.30));
      // Centre of mass from the same distribution
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
         // Moment of inertia of a rod about the centre of mass
         inertia: d.mass * H * H / 12,
         cdWater: 1.5,
         angDrag: 0.55,
         life: 999,
         disposable: true,
         tether: {
            owner: this.id,
            local: d.anchorLocal.clone(),
            // It hangs at the mast foot in the standing rigging - that's where the line attaches
            attach: new THREE.Vector3(0, 0, 0),
            len: Math.max(H * 0.10, 4),
         },
      });
      return piece;
   }

   // Cut the wreckage away: axes to the shrouds, the ship is free again
   cutAwayWreckage() {
      if (!this.debris) return 0;
      const n = this.debris.cutTethers(this.id);
      if (n > 0) this._events.push({ type: "cutAway", ship: this, n });
      return n;
   }

   // ------------------------------------------------------------------
   // Ramming and grounding
   // ------------------------------------------------------------------
   takeRam(info) {
      const res = this.dmg.applyRam(info);
      // A collision knocks half the watch off their feet
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
   // Match the appearance to the damage state
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
   // Step
   // ------------------------------------------------------------------
   // ctx: { wind {dir,speedKts}, t, waveRad, amp, dt }
   update(dt, ctx) {
      if (!this.alive) return;
      const D = this.dmg;
      const dyn = this.dyn;
      const u = this.model.userData;

      // --- Advance damage -----------------------------------------
      if (!this.serverDriven) D.update(dt, { heel: dyn.heel });
      if (this.vessel.rig === "square" && !this.serverDriven) {
         const broke = D.stressRig(dt, {
            windKts: ctx.wind.speedKts,
            sailSet: dyn.sailSet,
            twa: dyn.twa,
         });
         if (broke) this._dropMast(broke.mast, "overpress");
      }
      // A bled-out crew won't keep fighting
      if (!this.isPlayer && !this.serverDriven && !D.struck && !D.neverStrikes
            && this.crew.morale() < 0.12 && this.crew.losses > 8) {
         D.struck = true;
         D._event("struck", {});
      }
      for (const ev of D.drainEvents()) {
         this._events.push({ ...ev, ship: this });
         if (ev.type === "struck" || ev.type === "sunk") this._syncAppearance();
      }
      if (D.afire > 0.02 && this.model.setFire) this.model.setFire(D.afire);

      // --- Sails blown from the leeches ---------------------------------
      if (this.model.drainBlownSails) {
         const blown = this.model.drainBlownSails();
         if (blown.length) {
            // to leeward: the wind carries the canvas where it blows
            const lee = dirVec(ctx.wind.dir + 180);
            const leeVec = new THREE.Vector3(lee.x, 0.25, lee.z).normalize();
            const wkt = ctx.wind.speedKts;
            for (const b of blown) {
               this._events.push({ type: "sailBlown", ship: this, level: b.level, mast: b.mastKey });
               if (!this.debris) continue;
               // A whole sail doesn't go overboard in one piece - it tears
               // into several flapping strips.
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

      // --- Effects of damage on the sailing dynamics ----------------------------
      if (this.serverDriven) {
         // The server computed these from its damage and crew; the local
         // prediction must step with exactly the same numbers.
         const o = this.serverDriven;
         dyn.driveMul = o.driveMul;
         dyn.rudderMul = o.rudderMul;
         dyn.dragMul = o.dragMul;
         dyn.turnBias = o.turnBias;
         dyn.heelBias = o.heelBias;
         dyn.stopped = !!o.stopped;
      } else {
         this.wreckDrag = this.debris ? this.debris.tetherLoad(this.id) : 0;
         dyn.driveMul = D.driveFactor();
         dyn.rudderMul = D.rudderFactor() * (1 - 0.35 * this.wreckDrag);
         dyn.dragMul = 1 + 1.8 * this.wreckDrag + 0.7 * D.flooding;
         // Wreckage on one side constantly pulls the ship in that direction
         dyn.turnBias = this.wreckDrag * 7 * (this.dyn.twaSigned > 0 ? -1 : 1);
         dyn.heelBias = D.floodHeel();
         // Crew: manned guns, reload speed, sail handling, rudder
         const gun = this.crew.gunnery();
         this.battery.effectiveness.PORT = D.gunFraction("PORT") * gun.served;
         this.battery.effectiveness.STBD = D.gunFraction("STBD") * gun.served;
         if (this.vessel.guns) {
            this.battery.reloadTime = this.vessel.guns.reload / Math.max(gun.rate, 0.2);
         }
         dyn.driveMul *= 0.55 + 0.45 * this.crew.sailHandling();
         dyn.rudderMul *= this.crew.command();
      }

      // Is sail currently being worked? Then the topmen are in the shrouds.
      const dSet = Math.abs(dyn.sailSet - this._lastSailSet);
      this._lastSailSet = dyn.sailSet;
      this._sailWork = clamp(Math.max(this._sailWork - dt * 0.22, dSet > 1e-4 ? 1 : 0), 0, 1);

      // --- Sailing --------------------------------------------------------
      dyn.step(dt, ctx.wind, null);

      // --- Sinking ---------------------------------------------------------
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

   // Sinking: the ship settles and rolls onto the leaking side
   _sinkStep(dt, ctx) {
      const p = this.pos;
      const hy = seaHeight(p.x, p.z, ctx.waveT ?? ctx.t, ctx.waveRad, ctx.amp, ctx.lambda ?? 1) * 0.9;
      const sink = Math.pow(this.sinkTimer / 16, 1.6) * this.vessel.hull.loa * 0.55;
      this.model.position.set(p.x, hy - sink, p.z);
      this.model.rotation.y = this.dyn.heading * DEG;
      const heeler = this.model.userData.heeler;
      heeler.rotation.z = lerp(heeler.rotation.z, 0.9, Math.min(1, dt * 0.35));
      heeler.rotation.x = lerp(heeler.rotation.x, -0.25, Math.min(1, dt * 0.3));
      // Sinking also supplies poses for interpolation between frames,
      // otherwise a sinking ship would judder at the simulation rate.
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

   // Place on the wave (buoyancy, roll, pitch)
   //
   // The pose itself is computed by shipPose() in @quarterdeck/shared - the same
   // function the server uses to build its hit-detection matrix. Here it is
   // only applied to the Three.js model.
   //
   // This is called with a FIXED simulation step. For the display between
   // two steps there is applyPose(alpha).
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

      // Keep two poses on hand: the previous one and the current one.
      // applyPose() interpolates between them when rendering.
      this._posePrev = this._poseCurr || pose;
      this._poseCurr = pose;
      this._posPrev = this._posCurr || { x: this.pos.x, z: this.pos.z };
      this._posCurr = { x: this.pos.x, z: this.pos.z };

      this._applyPoseExact(pose, this._posCurr);

      // --- Water over the rail --------------------------------------
      if (!this.serverDriven) this._swampCheck(dt, pose);
   }

   /** Write a finished pose onto the model. */
   _applyPoseExact(pose, pos) {
      const vo = this.viewOffset;
      if (vo && vo.active) {
         this.model.position.set(pos.x + vo.x, pose.y, pos.z + vo.z);
         this.model.rotation.y = pose.yawY + vo.yaw * DEG;
      } else {
         this.model.position.set(pos.x, pose.y, pos.z);
         this.model.rotation.y = pose.yawY;
      }
      const heeler = this.model.userData.heeler;
      heeler.rotation.z = pose.rollZ;
      heeler.rotation.x = pose.pitchX;
      // Update the world matrices immediately: the guns' hit detection
      // computes in ship coordinates and must not rely on the renderer
      // having already refreshed them.
      this.model.updateMatrixWorld(true);
   }

   /**
    * Display pose between the last two simulation steps.
    * alpha = 0 -> previous step, 1 -> current. Purely visual: the
    * simulation never reads these values back.
    */
   applyPose(alpha) {
      if (!this._poseCurr) return;
      // Without a second pose there is nothing to blend.
      if (!this._posePrev) {
         this._applyPoseExact(this._poseCurr, this._posCurr);
         return;
      }
      // alpha is the remaining fraction of the current step: 0 means "no
      // time has passed in the current step yet", i.e. the PREVIOUS pose.
      // The picture therefore lags by up to one simulation step (33 ms) -
      // the usual price for never extrapolating and never juddering.
      const a = clamp(alpha, 0, 1);
      this._applyPoseExact(
         lerpPose(this._posePrev, this._poseCurr, a),
         lerpVec(this._posPrev, this._posCurr, a),
      );
   }

   // Water over the lee rail: flooding and casualties. Same function as on
   // the server (@quarterdeck/shared/seamanship), so both book the same water.
   _swampCheck(dt, pose) {
      this.railClear = swampStep(this._swamp, dt, pose, this.freeboard, this.vessel.hull.beam / 2,
         { dmg: this.dmg, crew: this.crew }, this.rng);
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

   // Move the crew at their stations
   updateCrewView(dt, ctx) {
      const cv = this.crewView;
      if (!cv) return;
      // Far-away ships don't need an animated crew
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

   // Anchor point for a line (wreckage in the standing rigging)
   anchorPoint(local, out) {
      const h = this.model.userData.heeler;
      h.updateMatrixWorld();
      out.copy(local);
      h.localToWorld(out);
      return out;
   }

   dispose() {
      if (this.model && this.model.setFire) this.model.setFire(0);
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
