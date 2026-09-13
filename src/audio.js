// audio.js - Voice announcements + UI sounds (static files from /sounds/)
//
// Voice lines: triggered by game events.
// Each entry: { key, src, cooldown }  — cooldown prevents spam in seconds.
import { clamp } from "./utils.js";

// ---------------------------------------------------------------------------
// Sound catalogue
// ---------------------------------------------------------------------------
const VOICE = {
   ahoi:              { key: "ahoi",              src: "/sounds/ahoi.ogg",              cooldown: 0 },
   battlestations:    { key: "battlestations",    src: "/sounds/battlestations.ogg",    cooldown: 8 },
   braceforimpact:    { key: "braceforimpact",    src: "/sounds/braceforimpact.ogg",    cooldown: 6 },
   ceasefire:         { key: "ceasefire",         src: "/sounds/ceasefire.ogg",         cooldown: 5 },
   fireatwill:        { key: "fireatwill",        src: "/sounds/fireatwill.ogg",        cooldown: 2 },
   makesail:          { key: "makesail",          src: "/sounds/makesail.ogg",          cooldown: 3 },
   pumps:             { key: "pumps",             src: "/sounds/manthepumps_takingwater.ogg", cooldown: 15 },
   pointouttheguns:   { key: "pointouttheguns",   src: "/sounds/pointouttheguns.ogg",   cooldown: 10 },
   sunk:              { key: "sunk",              src: "/sounds/sunk.ogg",              cooldown: 8 },
   takethatvessel:    { key: "takethatvessel",    src: "/sounds/takethatvessel.ogg",   cooldown: 5 },
   victory:           { key: "victory",           src: "/sounds/victory.ogg",          cooldown: 15 },
};

// ---------------------------------------------------------------------------
// Audio player
// ---------------------------------------------------------------------------
export class VoiceAudio {
   constructor() {
      this.enabled = true;
      this.gain = 0.9;
      this._buffers = {};      // key -> AudioBuffer
      this._ctx = null;
      this._lastPlayed = {};   // key -> timestamp
   }

   _ensure() {
      if (!this.enabled) return null;
      if (this._ctx) return this._ctx;
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.enabled = false; return null; }
      try { this._ctx = new AC(); } catch { this.enabled = false; return null; }
      return this._ctx;
   }

   // Pre-load a sound file into a buffer (call once at init)
   async _fetch(key) {
      const ctx = this._ensure();
      if (!ctx || this._buffers[key]) return;
      const entry = Object.values(VOICE).find((v) => v.key === key);
      if (!entry) return;
      try {
         const res = await fetch(entry.src);
         if (!res.ok) return;
         const buf = await res.arrayBuffer();
         this._buffers[key] = await ctx.decodeAudioData(buf);
      } catch { /* asset missing or decode failed */ }
   }

   // Pre-load all voice files
   async preload() {
      await Promise.all(Object.keys(VOICE).map((k) => this._fetch(k)));
   }

   // Play a voice line by key, respecting cooldown
   play(key) {
      const ctx = this._ensure();
      if (!ctx || !this._buffers[key]) return false;
      const now = performance.now() / 1000;
      const entry = Object.values(VOICE).find((v) => v.key === key);
      const cooldown = entry ? entry.cooldown : 0;
      if (cooldown > 0 && now - (this._lastPlayed[key] || 0) < cooldown) return false;

      const src = ctx.createBufferSource();
      src.buffer = this._buffers[key];
      const g = ctx.createGain();
      g.gain.value = this.gain;
      src.connect(g);
      g.connect(ctx.destination);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      src.start(0);
      this._lastPlayed[key] = now;
      return true;
   }

   // Convenience: play by voice key
   announce(key) { return this.play(key); }
}

// Singleton instance
export const voiceAudio = new VoiceAudio();

// ---------------------------------------------------------------------------
// Trigger helpers — call these from game.js / guns.js / damage.js
// ---------------------------------------------------------------------------
export function voiceAnnounce(key) { voiceAudio.announce(key); }

// Triggers (mapped to game events):
export const TRIGGER = {
   MENU_OPEN:          "ahoi",           // menu opens / start screen
   BATTLE_STATIONS:    "battlestations", // Q/E/F pressed (broadside fire)
   COLLISION:          "braceforimpact", // collision detected
   CEASE_FIRE:         "ceasefire",      // guns finished reloading
   FIRE_AT_WILL:       "fireatwill",     // first broadside shot
   MAKE_SAIL:          "makesail",       // W key pressed (sails set/reefed)
   FLOODING:           "pumps",          // flooding starts
   TARGET_ACQUIRED:    "pointouttheguns",// target in range
   ENEMY_SUNK:         "sunk",           // enemy ship sunk
   HIT_CONFIRMED:      "takethatvessel", // hit registered on enemy
   VICTORY:            "victory",        // all enemies destroyed
};
