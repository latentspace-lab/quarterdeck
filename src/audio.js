// audio.js - Kommandostimme: kurze Zurufe zu Spielereignissen.
//
// Die Dateien liegen unter public/sounds/ und werden ueber die Vite-Basis-URL
// geladen. Ein fester Pfad wie "/sounds/x.mp3" ginge auf GitHub Pages ins
// Leere, weil die Seite dort unter /sailing/ ausgeliefert wird.

const BASE = import.meta.env?.BASE_URL ?? "/";

// Sperrzeit in Sekunden: verhindert, dass ein Zuruf im Gefecht im Sekundentakt
// wiederholt wird. 0 = jederzeit.
const VOICE = {
   ahoi:            { file: "ahoi.mp3",                    cooldown: 0 },
   battlestations:  { file: "battlestations.mp3",          cooldown: 8 },
   braceforimpact:  { file: "braceforimpact.mp3",          cooldown: 6 },
   ceasefire:       { file: "ceasefire.mp3",               cooldown: 5 },
   fireatwill:      { file: "fireatwill.mp3",              cooldown: 2 },
   makesail:        { file: "makesail.mp3",                cooldown: 3 },
   pumps:           { file: "manthepumps_takingwater.mp3", cooldown: 15 },
   pointouttheguns: { file: "pointouttheguns.mp3",         cooldown: 10 },
   sunk:            { file: "sunk.mp3",                    cooldown: 8 },
   takethatvessel:  { file: "takethatvessel.mp3",          cooldown: 5 },
   victory:         { file: "victory.mp3",                 cooldown: 15 },
};

// Ereignisnamen fuer die Aufrufstellen. Der Umweg ueber diese Tabelle haelt
// die Dateinamen aus dem Spielcode heraus.
export const TRIGGER = {
   MENU_OPEN: "ahoi",
   BATTLE_STATIONS: "battlestations",
   COLLISION: "braceforimpact",
   CEASE_FIRE: "ceasefire",
   FIRE_AT_WILL: "fireatwill",
   MAKE_SAIL: "makesail",
   FLOODING: "pumps",
   TARGET_ACQUIRED: "pointouttheguns",
   SHIP_SUNK: "sunk",
   HIT_CONFIRMED: "takethatvessel",
   VICTORY: "victory",
};

export class VoiceAudio {
   constructor() {
      this.enabled = true;
      this.gain = 0.9;
      this._buffers = {};
      this._ctx = null;
      this._lastPlayed = {};
   }

   _ensure() {
      if (!this.enabled) return null;
      if (this._ctx) return this._ctx;
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.enabled = false; return null; }
      try { this._ctx = new AC(); } catch { this.enabled = false; return null; }
      return this._ctx;
   }

   async _fetch(key) {
      const ctx = this._ensure();
      if (!ctx || this._buffers[key]) return;
      try {
         const res = await fetch(BASE + "sounds/" + VOICE[key].file);
         if (!res.ok) return;
         this._buffers[key] = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch { /* Datei fehlt oder laesst sich nicht dekodieren - dann bleibt es still */ }
   }

   async preload() {
      await Promise.all(Object.keys(VOICE).map((k) => this._fetch(k)));
   }

   play(key) {
      const entry = VOICE[key];
      // Ein unbekannter Schluessel bliebe sonst stumm, ohne dass es auffaellt.
      if (!entry) { console.warn("audio: unbekannter Zuruf", key); return false; }
      const ctx = this._ensure();
      if (!ctx || !this._buffers[key]) return false;
      const now = performance.now() / 1000;
      if (entry.cooldown > 0 && now - (this._lastPlayed[key] || 0) < entry.cooldown) return false;

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
}

export const voiceAudio = new VoiceAudio();

export function voiceAnnounce(key) { return voiceAudio.play(key); }
