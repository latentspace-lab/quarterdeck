// crewview.js - die men an deck.
//
// Ein ship dieser time war ein Ameisenhaufen: an jedem gun eine Bedienung,
// topmen in den shrouds, ein helmsman am wheel, carpenters an den
// pumps. Genau diese stations werden hier besetzt und bewegt - die figures
// sind bewusst simpel, aber ihr VERHALTEN haengt am gamezustand: die
// gun crews arbeiten im rhythm des reloadings, die pumps gehen
// schneller, je mehr water im ship steht, und wer gefallen ist, steht
// nicht mehr da.
//
// rendering: two InstancedMeshes (hull + head) for the whole crew,
// also zwei draw calls unabhaengig von der Kopfzahl.

import * as THREE from "three";
import { clamp } from "./utils.js";

const ROLE_COLOR = {
   officer: 0x1b2338,     // dunkelblauer Rock
   gun: 0x39506e,         // Matrosenjacke
   top: 0x44618a,
   marine: 0x8c2b2b,      // rote Roecke
   carpenter: 0x5a4a34,
   powder: 0x6b7f9c,
};

function figureGeometry(scale) {
   // hull: Kapsel; Kopf: smalle ball. Fuesse bei y = 0.
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

   // ---------------------------------------------------------------- stations
   // 1) gun crews - nur am obersten batterydeck, dort stehen sie
   //    auf dem Wetterdeck und sind auch sichtbar.
   if (u.gunDecks && u.gunDecks.length) {
      const deck = u.gunDecks[u.gunDecks.length - 1]; // oberstes
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

   // 2) topmen: am mast foot und in den shrouds
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
      // einer in den shrouds
      add({
         role: "top", mast: key, climbing: true,
         x: BEAM * 0.30, y, z: m.z,
         climbTop: m.H * 0.42, face: Math.PI, phase: Math.random() * 6.28,
      });
   }

   // 3) helmsman und Offizier auf dem quarterdeck
   {
      const s = 0.80, y = u.deckAt(s), z = u.zAt(s);
      add({ role: "officer", helm: true, x: -0.55 * scale, y, z, face: 0, phase: 0 });
      add({ role: "officer", helm: true, x: 0.55 * scale, y, z, face: 0, phase: 1.7 });
      add({ role: "officer", conn: true, x: BEAM * 0.22, y, z: z + 3.5 * scale, face: 0.5, phase: 2.4 });
   }

   // 4) pumps mittschiffs
   {
      const s = 0.55, y = u.deckAt(s), z = u.zAt(s);
      for (let k = 0; k < 2; k++) {
         add({ role: "carpenter", pump: true, x: (k ? 1 : -1) * 0.9 * scale, y, z,
               face: k ? -Math.PI / 2 : Math.PI / 2, phase: k * Math.PI });
      }
   }

   // 5) marines an der railing, powder boys unterwegs
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

   // how many per role are still standing (aus dem crew model)
   const strength = {};
   for (const k in ROLE_COLOR) strength[k] = 1;

   const _m = new THREE.Matrix4();
   const _q = new THREE.Quaternion();
   const _p = new THREE.Vector3();
   const _s = new THREE.Vector3(1, 1, 1);
   const _hidden = new THREE.Matrix4().makeScale(0, 0, 0);

   // Reihenfolge je role, damit beim Ausduennen immer dieselben verschwinden
   const rank = {};
   for (const st of stations) {
      rank[st.role] = (rank[st.role] || 0);
      st.rank = rank[st.role]++;
   }
   const roleCount = { ...rank };

   const api = {
      group, stations, count: N,

      // crewschaftsstaerke je role 0..1 - daraus ergibt sich, wie viele
      // figures noch an ihren stations stehen.
      setStrength(status) {
         if (!status || !status.roles) return;
         for (const r of status.roles) strength[r.id] = clamp(r.frac, 0, 1);
      },

      // o: { dt, time, reload:{PORT,STBD}, ready:{PORT,STBD}, rudder, flooding,
      //      sailWork, lostmasts:Set, struck }
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
               // rhythm des reloadings: ausrennen, laden, zuruecktreten
               const rl = o.reload ? (o.reload[st.side] ?? 0) : 0;   // 1 = frisch gefeuert
               const work = clamp(rl, 0, 1);
               // kurz nach dem Schuss weichen sie zurueck, dann holen sie das gun ein
               const step = Math.sin(work * Math.PI) * 0.55 + work * 0.25;
               x -= st.out * step * (0.7 + st.slot * 0.3);
               y += Math.abs(Math.sin(t * 5 + st.phase)) * 0.05 * work;
               // beim Wischen und Laden buecken sie sich
               const crouch = 0.85 + 0.15 * Math.cos(t * 4.5 + st.phase);
               _s.set(1, work > 0.05 ? crouch : 1, 1);
            } else if (st.climbing) {
               // Toppsgast entert auf und ab, wenn sail bedient werden
               const w = clamp(o.sailWork ?? 0, 0, 1);
               const h = (0.5 + 0.5 * Math.sin(t * 0.55 + st.phase)) * w;
               y += h * st.climbTop;
               _s.set(1, 1, 1);
            } else if (st.helm) {
               yaw = st.face + (o.rudder || 0) * 0.28;
               x = st.x + (o.rudder || 0) * 0.12;
               _s.set(1, 1, 1);
            } else if (st.pump) {
               // pumps: je mehr water, desto haerter wird gearbeitet
               const f = clamp(o.flooding ?? 0, 0, 1);
               const rate = 1.6 + f * 5;
               y += Math.sin(t * rate + st.phase) * 0.16 * (0.3 + f);
               _s.set(1, 1 - 0.12 * Math.abs(Math.sin(t * rate + st.phase)), 1);
            } else if (st.runner) {
               // powderjunge laeuft zwischen hatch und battery hin und her
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
