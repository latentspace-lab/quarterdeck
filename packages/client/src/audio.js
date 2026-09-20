// audio.js - Voice announcements
//
// Voices are nation-specific: British (GB), French (FR) or Spanish (ES).
// The set is chosen at play time from the player's faction.
import { audioContext } from "./audioContext.js";

const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

// MP3 only - see soundtrack.js.
const VOICE_DIR = BASE + "sounds/voice/";

// key -> { file stem per nation, cooldown in seconds }
const LINES = {
   ahoi:            { gb: "ahoi",                    es: "ahoi_es",            fr: "ahoi_fr",            cooldown: 0  },
   battlestations:  { gb: "battlestations",          es: "battlestations_es",  fr: "battlestations_fr",  cooldown: 8  },
   braceforimpact:  { gb: "braceforimpact",          es: "braceforimpact_es",  fr: "braceforimpact_fr",  cooldown: 6  },
   ceasefire:       { gb: "ceasefire",               es: "ceasefire_es",       fr: "ceasefire_fr",       cooldown: 5  },
   fireatwill:      { gb: "fireatwill",              es: "fireatwill_es",      fr: "fireatwill_fr",      cooldown: 2  },
   makesail:        { gb: "makesail",                es: "makesail_es",        fr: "makesail_fr",        cooldown: 3  },
   pumps:           { gb: "manthepumps_takingwater", es: "pumps_es",           fr: "pumps_fr",           cooldown: 15 },
   pointouttheguns: { gb: "pointouttheguns",         es: "pointouttheguns_es", fr: "pointouttheguns_fr", cooldown: 10 },
   sunk:            { gb: "sunk",                    es: "sunk_es",            fr: "sunk_fr",            cooldown: 8  },
   takethatvessel:  { gb: "takethatvessel",          es: "takethatvessel_es",  fr: "takethatvessel_fr",  cooldown: 5  },
   victory:         { gb: "victory",                 es: "victory_es",         fr: "victory_fr",         cooldown: 15 },
};

export const NATIONS = { GB: "GB", FR: "FR", ES: "ES" };

// Off until the lines are less intrusive; ?voice=1 turns them on.
export const VOICE_ENABLED = typeof location !== "undefined"
   && new URLSearchParams(location.search).get("voice") === "1";

export function voiceSrc(key, nation = "GB") {
   const line = LINES[key];
   if (!line) return null;
   const stem = line[nation.toLowerCase()] || line.gb;
   return VOICE_DIR + stem + ".mp3";
}

export const VOICE_KEYS = Object.keys(LINES);

const warn = (msg, err) => console.warn("[voice] " + msg, err !== undefined ? err : "");

// ---------------------------------------------------------------------------
// Audio player
// ---------------------------------------------------------------------------
export class VoiceAudio {
   constructor() {
      this.enabled = VOICE_ENABLED;
      this.gain = 0.9;
      this._buffers = {};      // `${nation}:${key}` -> AudioBuffer
      this._lastPlayed = {};   // `${nation}:${key}` -> timestamp
      this._loading = {};      // nation -> Promise
   }

   _ensure() {
      if (!this.enabled) return null;
      const ctx = audioContext();
      if (!ctx) this.enabled = false;
      return ctx;
   }

   async _fetch(nation, key) {
      const ctx = this._ensure();
      if (!ctx) return;
      const bkey = `${nation}:${key}`;
      if (this._buffers[bkey]) return;
      const src = voiceSrc(key, nation);
      try {
         const res = await fetch(src);
         if (!res.ok) { warn("HTTP " + res.status + " for " + src); return; }
         const buf = await res.arrayBuffer();
         this._buffers[bkey] = await ctx.decodeAudioData(buf);
      } catch (e) { warn("could not load " + src, e); }
   }

   preloadNation(nation = "GB") {
      if (!this._loading[nation]) {
         this._loading[nation] = Promise.all(VOICE_KEYS.map((k) => this._fetch(nation, k)));
      }
      return this._loading[nation];
   }

   preload() {
      return Promise.all(Object.values(NATIONS).map((n) => this.preloadNation(n)));
   }

   loaded(nation = "GB") {
      return VOICE_KEYS.every((k) => !!this._buffers[`${nation}:${k}`]);
   }

   // Play a voice line; false if unknown, not loaded, or still in cooldown.
   play(key, nation = "GB") {
      const ctx = this._ensure();
      if (!ctx) return false;
      const bkey = `${nation}:${key}`;
      const buf = this._buffers[bkey];
      if (!buf) return false;

      const now = performance.now() / 1000;
      const cooldown = LINES[key] ? LINES[key].cooldown : 0;
      if (cooldown > 0 && now - (this._lastPlayed[bkey] || 0) < cooldown) return false;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = this.gain;
      src.connect(g);
      g.connect(ctx.destination);
      src.start(0);
      this._lastPlayed[bkey] = now;
      return true;
   }

   announce(key, nation = "GB") { return this.play(key, nation); }
}

export const voiceAudio = new VoiceAudio();

export function voiceAnnounce(key, nation = "GB") {
   return voiceAudio.announce(key, nation);
}

// Triggers (mapped to game events):
export const TRIGGER = {
   MENU_OPEN:       "ahoi",           // menu opens
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
