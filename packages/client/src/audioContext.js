// audioContext.js - the one AudioContext behind voices and music.
//
// Browsers only let audio start after the page has been interacted with, and
// Safari is strict about it: the context must be created or resumed
// synchronously inside a click, keydown or touchend handler (pointerdown does
// not count). unlockAudio() is called from such a handler; everything else
// just asks for the context.

let ctx = null;
let unavailable = false;

export function audioContext() {
   if (ctx || unavailable) return ctx;
   const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
   if (!AC) { unavailable = true; console.warn("[audio] no AudioContext in this browser"); return null; }
   try {
      ctx = new AC();
   } catch (e) {
      unavailable = true;
      console.warn("[audio] AudioContext could not be created", e);
   }
   return ctx;
}

export function unlockAudio() {
   const c = audioContext();
   if (!c) return null;
   if (c.state === "suspended") c.resume().catch((e) => console.warn("[audio] resume failed", e));
   // Starting a silent buffer inside the gesture primes the context on WebKit.
   try {
      const s = c.createBufferSource();
      s.buffer = c.createBuffer(1, 1, c.sampleRate);
      s.connect(c.destination);
      s.start(0);
   } catch (e) { console.warn("[audio] priming buffer failed", e); }
   return c;
}
