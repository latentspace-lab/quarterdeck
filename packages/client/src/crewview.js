// crewview.js - the people on deck.
//
// A ship of this era was an anthill: a crew at every gun, topmen in the
// shrouds, a helmsman at the wheel, carpenters at the pumps. These are
// exactly the stations populated and animated here - the figures are
// deliberately simple, but their BEHAVIOUR is tied to the game state: the
// gun crews work to the rhythm of reloading, the pumps go faster the more
// water is in the ship, and whoever has fallen no longer stands there.
//
// Rendering: two InstancedMeshes (body + head) for the whole crew, so two
// draw calls regardless of headcount.

import * as THREE from "three";
import { clamp } from "./utils.js";

const ROLE_COLOR = {
   officer: 0x1b2338,     // dark blue coat
   gun: 0x39506e,         // sailor's jacket
   top: 0x44618a,
   marine: 0x8c2b2b,      // red coats
   carpenter: 0x5a4a34,
   powder: 0x6b7f9c,
};

function figureGeometry(scale) {
   // Body: capsule; head: small sphere. Feet at y = 0.
   const body = new THREE.CapsuleGeometry(0.20 * scale, 0.80 * scale, 3, 7);
   body.translate(0, 0.60 * scale, 0);
   const head = new THREE.SphereGeometry(0.155 * scale, 7, 6);
   head.translate(0, 1.34 * scale, 0);
   return { body, head };
}

export function buildCrewView(shipModel, vessel, opts = {}) {
   const u = shipModel.userData;
   const LOA = u.LOA, BEAM = u.BEAM, FB = u.FB;
   const scale = opts.scale ?? 1;
   const group = new THREE.Group();

   const stations = [];
   const add = (st) => { stations.push(st); return st; };

   // ---------------------------------------------------------------- Stations
   // 1) Gun crews - only on the topmost gun deck, where they stand on the
   //    weather deck and are actually visible.
   if (u.gunDecks && u.gunDecks.length) {
      const deck = u.gunDecks[u.gunDecks.length - 1]; // topmost
      for (let i = 0; i < deck.count; i++) {
         const s = THREE.MathUtils.lerp(deck.from, deck.to, deck.count === 1 ? 0.5 : i / (deck.count - 1));
         const y = u.deckAt(s);
         const z = u.zAt(s);
         const hb = u.halfBeamAt(s, y);
         for (const sx of [1, -1]) {
            for (let k = 0; k < 2; k++) {
               add({
                  role: "gun", side: sx > 0 ? "PORT" : "STBD",
                  x: sx * (hb - (0.9 + k * 0.75) * scale),
                  y, z: z + (k === 0 ? 0.35 : -0.4) * scale,
                  face: sx > 0 ? Math.PI / 2 : -Math.PI / 2,
                  out: sx, phase: Math.random() * 6.28, slot: k,
               });
            }
         }
      }
   }

   // 2) Topmen: at the mast foot and in the shrouds
   const mastKeys = Object.keys(u.masts || {});
   for (const key of mastKeys) {
      const m = u.masts[key];
      const s = (LOA / 2 - m.z) / LOA;
      const y = u.deckAt(s);
      for (let k = 0; k < 2; k++) {
         add({
            role: "top", mast: key,
            x: (k ? 1 : -1) * BEAM * 0.20, y, z: m.z + (k ? -1 : 1) * 1.1 * scale,
            face: 0, phase: Math.random() * 6.28, slot: k,
         });
      }
      // one in the shrouds
      add({
         role: "top", mast: key, climbing: true,
         x: BEAM * 0.30, y, z: m.z,
         climbTop: m.H * 0.42, face: Math.PI, phase: Math.random() * 6.28,
      });
   }

   // 3) Helmsmen and officer on the quarterdeck
   {
      const s = 0.80, y = u.deckAt(s), z = u.zAt(s);
      add({ role: "officer", helm: true, x: -0.55 * scale, y, z, face: 0, phase: 0 });
      add({ role: "officer", helm: true, x: 0.55 * scale, y, z, face: 0, phase: 1.7 });
      add({ role: "officer", conn: true, x: BEAM * 0.22, y, z: z + 3.5 * scale, face: 0.5, phase: 2.4 });
   }

   // 4) Pumps amidships
   {
      const s = 0.55, y = u.deckAt(s), z = u.zAt(s);
      for (let k = 0; k < 2; k++) {
         add({ role: "carpenter", pump: true, x: (k ? 1 : -1) * 0.9 * scale, y, z,
               face: k ? -Math.PI / 2 : Math.PI / 2, phase: k * Math.PI });
      }
   }

   // 5) Marines at the rail, powder monkeys running
   for (let k = 0; k < 4; k++) {
      const s = 0.30 + k * 0.14, y = u.deckAt(s), z = u.zAt(s);
      const hb = u.halfBeamAt(s, y);
      add({ role: "marine", x: (k % 2 ? 1 : -1) * (hb - 0.7 * scale), y, z,
            face: (k % 2 ? 1 : -1) * Math.PI / 2, phase: Math.random() * 6.28 });
   }
   for (let k = 0; k < 3; k++) {
      add({ role: "powder", runner: true, x: (k - 1) * BEAM * 0.16,
            y: 0, z: 0, s0: 0.25 + k * 0.2, face: 0, phase: Math.random() * 6.28,
            dir: k % 2 ? 1 : -1 });
   }

   // ---------------------------------------------------------------- Meshes
   const N = stations.length;
   const { body, head } = figureGeometry(scale);
   const matBody = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.02 });
   const matHead = new THREE.MeshStandardMaterial({ color: 0xc7a480, roughness: 0.9 });
   const bodies = new THREE.InstancedMesh(body, matBody, N);
   const heads = new THREE.InstancedMesh(head, matHead, N);
   bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
   heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
   bodies.frustumCulled = false;
   heads.frustumCulled = false;
   bodies.castShadow = true;
   const col = new THREE.Color();
   for (let i = 0; i < N; i++) {
      col.set(ROLE_COLOR[stations[i].role] || 0x3a4a63);
      col.offsetHSL(0, 0, (Math.random() - 0.5) * 0.06);
      bodies.setColorAt(i, col);
   }
   if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
   group.add(bodies, heads);

   // How many of each role are still present (from the crew model)
   const strength = {};
   for (const k in ROLE_COLOR) strength[k] = 1;

   const _m = new THREE.Matrix4();
   const _q = new THREE.Quaternion();
   const _p = new THREE.Vector3();
   const _s = new THREE.Vector3(1, 1, 1);
   const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

   // Order within each role, so thinning out always removes the same ones
   const rank = {};
   for (const st of stations) {
      rank[st.role] = (rank[st.role] || 0);
      st.rank = rank[st.role]++;
   }
   const roleCount = { ...rank };

   const api = {
      group, stations, count: N,

      // Crew strength per role 0..1 - this determines how many figures
      // still stand at their stations.
      setStrength(status) {
         if (!status || !status.roles) return;
         for (const r of status.roles) strength[r.id] = clamp(r.frac, 0, 1);
      },

      // o: { dt, time, reload:{PORT,STBD}, ready:{PORT,STBD}, rudder, flooding,
      //      sailWork, lostMasts:Set, struck }
      update(dt, o = {}) {
         const t = o.time || 0;
         const lost = o.lostMasts || new Set();
         for (let i = 0; i < N; i++) {
            const st = stations[i];
            const have = Math.ceil((roleCount[st.role] || 1) * (strength[st.role] ?? 1));
            let visible = st.rank < have;
            if (st.mast && lost.has(st.mast)) visible = false;
            if (!visible) {
               bodies.setMatrixAt(i, _hidden);
               heads.setMatrixAt(i, _hidden);
               continue;
            }

            let x = st.x, y = st.y, z = st.z, yaw = st.face;
            const bob = Math.sin(t * 2.1 + st.phase) * 0.02;

            if (st.role === "gun") {
               // Rhythm of reloading: run out, load, step back
               const rl = o.reload ? (o.reload[st.side] ?? 0) : 0;   // 1 = just fired
               const work = clamp(rl, 0, 1);
               // shortly after firing they step back, then haul the gun back in
               const step = Math.sin(work * Math.PI) * 0.55 + work * 0.25;
               x -= st.out * step * (0.7 + st.slot * 0.3);
               y += Math.abs(Math.sin(t * 5 + st.phase)) * 0.05 * work;
               // they crouch while sponging and loading
               const crouch = 0.85 + 0.15 * Math.cos(t * 4.5 + st.phase);
               _s.set(1, work > 0.05 ? crouch : 1, 1);
            } else if (st.climbing) {
               // Topman climbs up and down while sails are being worked
               const w = clamp(o.sailWork ?? 0, 0, 1);
               const h = (0.5 + 0.5 * Math.sin(t * 0.55 + st.phase)) * w;
               y += h * st.climbTop;
               _s.set(1, 1, 1);
            } else if (st.helm) {
               yaw = st.face + (o.rudder || 0) * 0.28;
               x = st.x + (o.rudder || 0) * 0.12;
               _s.set(1, 1, 1);
            } else if (st.pump) {
               // Pumps: the more water, the harder they work
               const f = clamp(o.flooding ?? 0, 0, 1);
               const rate = 1.6 + f * 5;
               y += Math.sin(t * rate + st.phase) * 0.16 * (0.3 + f);
               _s.set(1, 1 - 0.12 * Math.abs(Math.sin(t * rate + st.phase)), 1);
            } else if (st.runner) {
               // Powder monkey runs back and forth between hatch and battery
               const u2 = 0.5 + 0.5 * Math.sin(t * 0.42 * st.dir + st.phase);
               const s2 = clamp(st.s0 + (u2 - 0.5) * 0.32, 0.08, 0.92);
               z = u.zAt(s2);
               y = u.deckAt(s2);
               yaw = Math.cos(t * 0.42 * st.dir + st.phase) * st.dir > 0 ? 0 : Math.PI;
               y += Math.abs(Math.sin(t * 7 + st.phase)) * 0.05;
               _s.set(1, 1, 1);
            } else {
               _s.set(1, 1, 1);
            }
            y += bob;
            if (o.struck && st.role !== "officer") y -= 0.0;

            _p.set(x, y, z);
            _q.setFromAxisAngle(UP, yaw);
            _m.compose(_p, _q, _s);
            bodies.setMatrixAt(i, _m);
            heads.setMatrixAt(i, _m);
         }
         bodies.instanceMatrix.needsUpdate = true;
         heads.instanceMatrix.needsUpdate = true;
      },

      dispose() {
         body.dispose(); head.dispose();
         matBody.dispose(); matHead.dispose();
      },
   };
   return api;
}

const UP = new THREE.Vector3(0, 1, 0);

export default { buildCrewView };
