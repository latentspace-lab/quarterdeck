// fx.js - gemeinsam genutzte Effekt-Texturen (Canvas, keine Assets).
// Die Texturen werden einmal erzeugt und von guns.js und debris.js geteilt.
// Ohne DOM (Node-Tests) liefern die Funktionen null - die Aufrufer muessen
// damit umgehen koennen.
import * as THREE from "three";

const _cache = {};
const hasDom = () => typeof document !== "undefined";

function canvasTex(key, size, draw) {
   if (_cache[key] !== undefined) return _cache[key];
   if (!hasDom()) { _cache[key] = null; return null; }
   const c = document.createElement("canvas");
   c.width = c.height = size;
   draw(c.getContext("2d"), size);
   const t = new THREE.CanvasTexture(c);
   t.needsUpdate = true;
   _cache[key] = t;
   return t;
}

// powderrauch / Gischt: weiche, unregelmaessige Ballen
export function puffTexture() {
   return canvasTex("puff", 64, (g) => {
      for (let i = 0; i < 10; i++) {
         const x = 16 + Math.random() * 32, y = 16 + Math.random() * 32;
         const r = 8 + Math.random() * 16;
         const rg = g.createRadialGradient(x, y, 0, x, y, r);
         rg.addColorStop(0, "rgba(255,255,255,0.85)");
         rg.addColorStop(0.55, "rgba(235,235,230,0.35)");
         rg.addColorStop(1, "rgba(220,220,215,0)");
         g.fillStyle = rg;
         g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
   });
}

// Muendungsfeuer
export function flashTexture() {
   return canvasTex("flash", 64, (g) => {
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      rg.addColorStop(0, "rgba(255,250,220,1)");
      rg.addColorStop(0.3, "rgba(255,190,90,0.9)");
      rg.addColorStop(0.7, "rgba(230,120,40,0.35)");
      rg.addColorStop(1, "rgba(180,80,20,0)");
      g.fillStyle = rg;
      g.fillRect(0, 0, 64, 64);
   });
}

// impactloch mit aufgerissenen planken - dunkles Zentrum, ausgefranster Rand
export function holeTexture() {
   return canvasTex("hole", 96, (g, S) => {
      g.clearRect(0, 0, S, S);
      const cx = S / 2, cy = S / 2;
      // ausgesplitterter Rand (heller Holzbruch)
      g.fillStyle = "rgba(196,168,118,0.95)";
      g.beginPath();
      for (let i = 0; i <= 26; i++) {
         const a = (i / 26) * Math.PI * 2;
         const r = S * (0.30 + 0.12 * Math.abs(Math.sin(i * 2.7)) + 0.05 * Math.random());
         const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
         if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
      // Loch
      g.fillStyle = "rgba(10,9,8,0.98)";
      g.beginPath();
      for (let i = 0; i <= 20; i++) {
         const a = (i / 20) * Math.PI * 2;
         const r = S * (0.20 + 0.05 * Math.sin(i * 3.1) + 0.02 * Math.random());
         const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
         if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.closePath(); g.fill();
   });
}

// fire / fireherd
export function fireTexture() {
   return canvasTex("fire", 64, (g) => {
      const rg = g.createRadialGradient(32, 40, 2, 32, 32, 30);
      rg.addColorStop(0, "rgba(255,245,200,0.95)");
      rg.addColorStop(0.35, "rgba(255,160,50,0.8)");
      rg.addColorStop(0.75, "rgba(190,60,20,0.35)");
      rg.addColorStop(1, "rgba(120,30,10,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
   });
}

export function disposeFx() {
   for (const k of Object.keys(_cache)) {
      if (_cache[k] && _cache[k].dispose) _cache[k].dispose();
      delete _cache[k];
   }
}

export default { puffTexture, flashTexture, holeTexture, fireTexture };
