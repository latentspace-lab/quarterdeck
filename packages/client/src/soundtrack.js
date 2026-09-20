// soundtrack.js - Background music playback (non-looping, with shuffle queue)
import { clamp } from "./utils.js";

const BASE = (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.BASE_URL) || "/";

const TRACKS = [
   { id: "the-royal-navy", src: BASE + "sounds/music/the-royal-navy.m4a", title: "The Royal Navy" },
];

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
      const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
      if (!AC) { this.enabled = false; return null; }
      try {
         this._ctx = new AC();
         this._gain = this._ctx.createGain();
         this._gain.gain.value = this.volume;
         this._gain.connect(this._ctx.destination);
      } catch { this.enabled = false; return null; }
      return this._ctx;
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
            if (!res.ok) return;
            this._raw[t.id] = await res.arrayBuffer();
         } catch { /* asset missing */ }
      }));
      this._preloaded = true;
   }

   async _decode(id) {
      if (this._buffers[id]) return this._buffers[id];
      const ctx = this._ensure();
      const raw = this._raw[id];
      if (!ctx || !raw) return null;
      try {
         this._buffers[id] = await ctx.decodeAudioData(raw.slice(0));
      } catch { return null; }
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

      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
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
      await this.preload();
      if (openingId) {
         this._queue = this._buildQueue(openingId);
         this.play(openingId);
      } else {
         this._queue = this._buildQueue(null);
         this._playNext();
      }
   }
}

export const soundtrack = new Soundtrack();

export { TRACKS };
