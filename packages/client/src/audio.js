// audio.js - Voice announcements + UI sounds
//
// Voices are nation-specific: British (GB) or French (FR).
// The correct voice set is selected at play time based on the player's vessel nation.
import { clamp } from "./utils.js";

const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

// ---------------------------------------------------------------------------
// Sound catalogue — GB (English) and FR (French) voices
// ---------------------------------------------------------------------------
const VOICE_GB = {
   ahoi:              { key: "ahoi",              src: BASE + "sounds/voice/ahoi.ogg",              cooldown: 0  },
   battlestations:    { key: "battlestations",    src: BASE + "sounds/voice/battlestations.ogg",    cooldown: 8  },
   braceforimpact:    { key: "braceforimpact",    src: BASE + "sounds/voice/braceforimpact.ogg",    cooldown: 6  },
   ceasefire:         { key: "ceasefire",         src: BASE + "sounds/voice/ceasefire.ogg",         cooldown: 5  },
   fireatwill:        { key: "fireatwill",        src: BASE + "sounds/voice/fireatwill.ogg",        cooldown: 2  },
   makesail:          { key: "makesail",          src: BASE + "sounds/voice/makesail.ogg",          cooldown: 3  },
   pumps:             { key: "pumps",             src: BASE + "sounds/voice/manthepumps_takingwater.ogg", cooldown: 15 },
   pointouttheguns:   { key: "pointouttheguns",   src: BASE + "sounds/voice/pointouttheguns.ogg",   cooldown: 10 },
   sunk:              { key: "sunk",              src: BASE + "sounds/voice/sunk.ogg",              cooldown: 8  },
   takethatvessel:    { key: "takethatvessel",    src: BASE + "sounds/voice/takethatvessel.ogg",   cooldown: 5  },
   victory:           { key: "victory",           src: BASE + "sounds/voice/victory.ogg",           cooldown: 15 },
};

const VOICE_ES = {
   ahoi:              { key: "ahoi",              src: BASE + "sounds/voice/ahoi_es.ogg",           cooldown: 0  },
   battlestations:    { key: "battlestations",    src: BASE + "sounds/voice/battlestations_es.ogg",cooldown: 8  },
   braceforimpact:    { key: "braceforimpact",    src: BASE + "sounds/voice/braceforimpact_es.ogg",cooldown: 6  },
   ceasefire:         { key: "ceasefire",         src: BASE + "sounds/voice/ceasefire_es.ogg",     cooldown: 5  },
   fireatwill:        { key: "fireatwill",        src: BASE + "sounds/voice/fireatwill_es.ogg",    cooldown: 2  },
   makesail:          { key: "makesail",          src: BASE + "sounds/voice/makesail_es.ogg",      cooldown: 3  },
   pumps:             { key: "pumps",             src: BASE + "sounds/voice/pumps_es.ogg",         cooldown: 15 },
   pointouttheguns:   { key: "pointouttheguns",   src: BASE + "sounds/voice/pointouttheguns_es.ogg",cooldown: 10 },
   sunk:              { key: "sunk",              src: BASE + "sounds/voice/sunk_es.ogg",          cooldown: 8  },
   takethatvessel:    { key: "takethatvessel",    src: BASE + "sounds/voice/takethatvessel_es.ogg",cooldown: 5  },
   victory:           { key: "victory",           src: BASE + "sounds/voice/victory_es.ogg",       cooldown: 15 },
};

const VOICE_FR = {
   ahoi:              { key: "ahoi",              src: BASE + "sounds/voice/ahoi_fr.ogg",           cooldown: 0  },
   battlestations:    { key: "battlestations",    src: BASE + "sounds/voice/battlestations_fr.ogg",cooldown: 8  },
   braceforimpact:    { key: "braceforimpact",    src: BASE + "sounds/voice/braceforimpact_fr.ogg",cooldown: 6  },
   ceasefire:         { key: "ceasefire",         src: BASE + "sounds/voice/ceasefire_fr.ogg",     cooldown: 5  },
   fireatwill:        { key: "fireatwill",        src: BASE + "sounds/voice/fireatwill_fr.ogg",    cooldown: 2  },
   makesail:          { key: "makesail",          src: BASE + "sounds/voice/makesail_fr.ogg",      cooldown: 3  },
   pumps:             { key: "pumps",             src: BASE + "sounds/voice/pumps_fr.ogg",         cooldown: 15 },
   pointouttheguns:   { key: "pointouttheguns",   src: BASE + "sounds/voice/pointouttheguns_fr.ogg",cooldown: 10 },
   sunk:              { key: "sunk",              src: BASE + "sounds/voice/sunk_fr.ogg",          cooldown: 8  },
   takethatvessel:    { key: "takethatvessel",    src: BASE + "sounds/voice/takethatvessel_fr.ogg",cooldown: 5  },
   victory:           { key: "victory",           src: BASE + "sounds/voice/victory_fr.ogg",       cooldown: 15 },
};

export const NATIONS = { GB: "GB", FR: "FR", ES: "ES" };

// ---------------------------------------------------------------------------
// Audio player
// ---------------------------------------------------------------------------
export class VoiceAudio {
   constructor() {
      this.enabled = true;
      this.gain = 0.9;
      this._buffers = {};      // `${nation}:${key}` -> AudioBuffer
      this._ctx = null;
      this._lastPlayed = {};   // `${nation}:${key}` -> timestamp
      this._preloaded = {};    // nation -> Set of loaded keys
   }

   _ensure() {
      if (!this.enabled) return null;
      if (this._ctx) return this._ctx;
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.enabled = false; return null; }
      try { this._ctx = new AC(); } catch { this.enabled = false; return null; }
      return this._ctx;
   }

   _voiceFor(nation) {
      if (nation === "FR") return VOICE_FR;
      if (nation === "ES") return VOICE_ES;
      return VOICE_GB;
   }

   // Pre-load a single sound file
   async _fetch(nation, key) {
      const ctx = this._ensure();
      if (!ctx) return;
      const bkey = `${nation}:${key}`;
      if (this._buffers[bkey]) return;
      const voice = this._voiceFor(nation);
      const entry = voice[key];
      if (!entry) return;
      try {
         const res = await fetch(entry.src);
         if (!res.ok) return;
         const buf = await res.arrayBuffer();
         this._buffers[bkey] = await ctx.decodeAudioData(buf);
      } catch { /* asset missing or decode failed */ }
   }

   // Pre-load all voices for a given nation
   async preloadNation(nation = "GB") {
      const voice = this._voiceFor(nation);
      await Promise.all(Object.keys(voice).map((k) => this._fetch(nation, k)));
      this._preloaded[nation] = true;
   }

   // Pre-load both nations (call at init)
   async preload() {
      await Promise.all([
         this.preloadNation("GB"),
         this.preloadNation("FR"),
      ]);
   }

   // Play a voice line for the given nation
   play(key, nation = "GB") {
      const ctx = this._ensure();
      if (!ctx) return false;
      const bkey = `${nation}:${key}`;
      const buf = this._buffers[bkey];
      if (!buf) return false;

      const now = performance.now() / 1000;
      const voice = this._voiceFor(nation);
      const entry = voice[key];
      const cooldown = entry ? entry.cooldown : 0;
      if (cooldown > 0 && now - (this._lastPlayed[bkey] || 0) < cooldown) return false;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = this.gain;
      src.connect(g);
      g.connect(ctx.destination);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      src.start(0);
      this._lastPlayed[bkey] = now;
      return true;
   }

   // Play using the current nation's voice
   announce(key, nation = "GB") { return this.play(key, nation); }
}

// Singleton instance
export const voiceAudio = new VoiceAudio();

// ---------------------------------------------------------------------------
// Trigger helpers
// ---------------------------------------------------------------------------
export function voiceAnnounce(key, nation = "GB") {
   voiceAudio.announce(key, nation);
}

// Triggers (mapped to game events):
export const TRIGGER = {
   MENU_OPEN:        "ahoi",           // menu opens
   BATTLE_STATIONS: "battlestations", // Q/E/F pressed (broadside fire)
   COLLISION:       "braceforimpact", // collision detected
   CEASE_FIRE:      "ceasefire",      // guns finished reloading
   FIRE_AT_WILL:    "fireatwill",     // first broadside shot
   MAKE_SAIL:       "makesail",       // W key pressed (sails set/reefed)
   FLOODING:        "pumps",          // flooding starts
   TARGET_ACQUIRED: "pointouttheguns",// target in range
   ENEMY_SUNK:      "sunk",           // enemy ship sunk
   HIT_CONFIRMED:   "takethatvessel", // hit registered on enemy
   VICTORY:         "victory",        // all enemies destroyed
};
