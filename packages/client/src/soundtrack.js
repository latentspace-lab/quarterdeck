// soundtrack.js - Background music playback (non-looping, with shuffle queue)
import { clamp } from "./utils.js";
import { audioContext, unlockAudio } from "./audioContext.js";

const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

// MP3 only: it is the one format every browser decodes in Web Audio. Safari
// cannot decode Opus or Vorbis here, and AAC depends on OS decoders.
const TRACKS = [
   { id: "the-royal-navy", src: BASE + "sounds/music/the-royal-navy.mp3", title: "The Royal Navy" },
   { id: "spanish-navy-theme", src: BASE + "sounds/music/spanish-navy-theme.mp3", title: "Spanish Navy Theme" },
   { id: "blue-waters-silent-threat", src: BASE + "sounds/music/blue-waters-silent-threat.mp3", title: "Blue Waters, Silent Threat" },
   { id: "calme-de-la-mer", src: BASE + "sounds/music/calme-de-la-mer.mp3", title: "Calme de la Mer" },
];

const warn = (msg, err) => console.warn("[soundtrack] " + msg, err !== undefined ? err : "");

export function trackTitle(id) {
   const t = TRACKS.find((x) => x.id === id);
   return t ? t.title : id;
}

export class Soundtrack {
   constructor() {
      this.enabled = true;
      this.volume = 0.5;
      this._ctx = null;
      this._gain = null;
      this._raw = {};            // id -> ArrayBuffer (fetched, not yet decoded)
      this._buffers = {};       // id -> AudioBuffer
      this._current = null;     // { id, source } of the playing track
      this._queue = [];          // shuffled ids still to play
      this._preloaded = false;
      this._loading = null;
   }

   _ensure() {
      if (!this.enabled) return null;
      if (this._ctx) return this._ctx;
      const ctx = audioContext();
      if (!ctx) { this.enabled = false; return null; }
      this._ctx = ctx;
      this._gain = ctx.createGain();
      this._gain.gain.value = this.volume;
      this._gain.connect(ctx.destination);
      return ctx;
   }

   preload() {
      if (!this._loading) this._loading = this._doPreload();
      return this._loading;
   }

   async _doPreload() {
      await Promise.all(TRACKS.map(async (t) => {
         if (this._raw[t.id]) return;
         try {
            const res = await fetch(t.src);
            if (!res.ok) { warn("HTTP " + res.status + " for " + t.src); return; }
            this._raw[t.id] = await res.arrayBuffer();
         } catch (e) { warn("could not fetch " + t.src, e); }
      }));
      this._preloaded = true;
   }

   async _decode(id) {
      if (this._buffers[id]) return this._buffers[id];
      const ctx = this._ensure();
      const raw = this._raw[id];
      if (!ctx) return null;
      if (!raw) { warn("track " + id + " was not fetched"); return null; }
      try {
         this._buffers[id] = await ctx.decodeAudioData(raw.slice(0));
      } catch (e) { warn("could not decode " + id + " (codec unsupported?)", e); return null; }
      return this._buffers[id];
   }

   setVolume(v) {
      this.volume = clamp(v, 0, 1);
      if (this._gain) this._gain.gain.value = this.volume;
   }

   async play(id) {
      const ctx = this._ensure();
      if (!ctx) return false;
      const buf = await this._decode(id);
      if (!buf) return false;

      this.stop();

      if (ctx.state === "suspended") await ctx.resume().catch((e) => warn("resume failed", e));
      if (ctx.state !== "running") {
         warn("AudioContext is " + ctx.state + " - the browser has not unlocked audio yet");
      }
      const source = ctx.createBufferSource();
      source.buffer = buf;
      source.loop = false;
      source.connect(this._gain);
      source.onended = () => {
         if (this._current && this._current.source === source) {
            this._current = null;
            this._playNext();
         }
      };
      source.start(0);
      this._current = { id, source };
      console.info("[soundtrack] playing " + id + " (" + buf.duration.toFixed(0) + " s, context " + ctx.state + ")");
      return true;
   }

   stop() {
      if (this._current) {
         try { this._current.source.onended = null; this._current.source.stop(); } catch {}
         this._current = null;
      }
   }

   get playing() { return !!this._current; }
   get currentTrack() { return this._current ? this._current.id : null; }

   // --- Shuffle queue ---
   // Builds a shuffled playlist from all tracks except the one just played,
   // then plays through it. When exhausted, reshuffles.

   _buildQueue(exclude) {
      const ids = TRACKS.map((t) => t.id).filter((id) => id !== exclude);
      for (let i = ids.length - 1; i > 0; i--) {
         const j = Math.floor(Math.random() * (i + 1));
         [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      return ids;
   }

   async _playNext() {
      if (!this.enabled) return;
      if (this._queue.length === 0) {
         this._queue = this._buildQueue(this._current ? this._current.id : null);
      }
      if (this._queue.length === 0) return;
      const next = this._queue.shift();
      await this.play(next);
   }

   // Start the soundtrack: play a specific opening track, then continue
   // with shuffled playback of the remaining catalogue.
   async start(openingId) {
      unlockAudio();   // synchronously, before the first await
      await this.preload();
      if (openingId) {
         this._queue = this._buildQueue(openingId);
         return this.play(openingId);
      }
      this._queue = this._buildQueue(null);
      await this._playNext();
      return this.playing;
   }
}

export const soundtrack = new Soundtrack();

export { TRACKS };
