import * as THREE from "three";
import { Ship } from "./src/ship.js";
import { Captain } from "./src/fleet.js";
import { DebrisField } from "./src/debris.js";
import { getVessel } from "./src/vessels.js";
import { seaHeight, ampForWind } from "./src/ocean.js";

export async function battle(aId, bId, opts = {}) {
   const scene = new THREE.Scene();
   const debris = new DebrisField(scene, { max: 500 });
   const all = [];
   const targets = () => all.map((s) => s.targetInfo());
   let hitsA = 0, hitsB = 0;
   const onHit = (h) => { if (h.target.ship === all[0]) hitsA++; else hitsB++; h.target.ship.takeHit(h); };
   const mk = (id, x, z, hd) => {
      const s = new Ship({ vessel: getVessel(id), scene, debris, targets, onHit, sound: false });
      s.place(x, z, hd, 4); all.push(s); return s;
   };
   const A = mk(aId, 0, 0, opts.hA ?? 90);
   const B = mk(bId, opts.dx ?? 420, opts.dz ?? 120, opts.hB ?? 270);
   const capA = new Captain(A, { doctrine: "hull", skill: 1.05, engage: opts.engA ?? 150 });
   const capB = new Captain(B, { doctrine: opts.docB ?? "rig", skill: 0.85, engage: opts.engB ?? 220 });
   const wind = { dir: 20, speedKts: opts.wind ?? 16 };
   const anchorOf = (id, local, out) => { const s = all.find((a) => a.id === id); return s && s.alive ? s.anchorPoint(local, out) : null; };
   let t = 0; const dt = 1 / 30;
   const amp = ampForWind(wind.speedKts), waveRad = Math.PI;
   const gunCtx = { windDir: wind.dir, windSpeed: wind.speedKts, seaHeight: (x, z) => seaHeight(x, z, t, waveRad, amp) * 0.9 };
   const log = []; let maxDebris = 0; let minDist = 1e9;
   while (t < (opts.max ?? 600) && A.alive && B.alive && !A.dmg.struck && !B.dmg.struck) {
      const ctx = { wind, t, waveRad, amp, gunCtx };
      capA.update(dt, { wind, target: B }); capB.update(dt, { wind, target: A });
      A.update(dt, ctx); B.update(dt, ctx);
      A.battery.update(dt, gunCtx); B.battery.update(dt, gunCtx);
      debris.update(dt, { seaHeight: gunCtx.seaHeight, windSpeed: wind.speedKts, windVec: { x: 0, z: 1 }, anchorOf });
      maxDebris = Math.max(maxDebris, debris.count());
      minDist = Math.min(minDist, Math.hypot(A.pos.x - B.pos.x, A.pos.z - B.pos.z));
      for (const e of [...A.drainEvents(), ...B.drainEvents()])
         log.push(t.toFixed(0) + "s " + e.ship.name + ": " + e.type + (e.mast ? " (" + e.mast + (e.cause ? ", " + e.cause : "") + ")" : ""));
      t += dt;
   }
   return { t, A, B, hitsA, hitsB, log, maxDebris, minDist, debris };
}
