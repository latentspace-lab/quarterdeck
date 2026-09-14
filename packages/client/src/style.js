// style.js - the rendering style of the whole client: "aquatint" (default)
// or "plain".
//
// "aquatint" renders the world like a hand-coloured naval aquatint of about
// 1800 (muted washes, tonal grain, ink outlines, paper tone) and dresses the
// HUD as vellum panes with ink rules. "plain" is the unprocessed modern look
// and stays available for comparison and as a fallback on weak GPUs.
//
// This module has no three.js dependency so that it can be unit-tested in
// Node. World colours are given either as an sRGB hex number (0xRRGGBB) or,
// for values that were authored directly in the shaders and vertex buffers,
// as an array of raw linear floats. rgb() turns both into a linear [r, g, b]
// triple; hex() gives the display colour for CSS and canvas code.

export const STYLES = ["aquatint", "plain"];
export const DEFAULT_STYLE = "aquatint";
export const STORAGE_KEY = "segel.style";

let current = DEFAULT_STYLE;

/** The style the client is currently rendering with. */
export function currentStyle() { return current; }

/** Remember the style for modules that read it lazily (sails, sprites). */
export function setCurrentStyle(name) {
   current = STYLES.includes(name) ? name : DEFAULT_STYLE;
   return current;
}

/**
 * Pick the style from the URL and the stored preference:
 * `?style=plain` wins, then whatever was stored, then the default.
 * Unknown values fall back to the default. `storage` is anything with a
 * getItem(key) (localStorage) and may be missing or throw.
 */
export function readStyleFromParams(search, storage) {
   let q = null;
   try {
      q = new URLSearchParams(search || "").get("style");
   } catch { q = null; }
   if (q && STYLES.includes(q)) return q;
   let stored = null;
   try {
      stored = storage && typeof storage.getItem === "function" ? storage.getItem(STORAGE_KEY) : null;
   } catch { stored = null; }
   if (stored && STYLES.includes(stored)) return stored;
   return DEFAULT_STYLE;
}

/** Persist the choice; silently ignores a missing or blocked storage. */
export function storeStyle(name, storage) {
   try {
      if (storage && typeof storage.setItem === "function") storage.setItem(STORAGE_KEY, name);
   } catch { /* private mode, quota - the choice just does not persist */ }
}

/** The style after `name` in the cycle (P key). */
export function nextStyle(name) {
   const i = STYLES.indexOf(name);
   return STYLES[(i + 1) % STYLES.length];
}

/** Stamp the style on <html> so the stylesheet can skin the HUD. */
export function applyStyleToDocument(name, doc) {
   const root = doc && doc.documentElement;
   if (root && root.dataset) root.dataset.style = name;
}

// ---------------------------------------------------------------- palettes

export const PALETTE = {
   // The look before the aquatint work: every value verbatim from the code
   // it replaced, so that style=plain renders exactly as it always did.
   plain: {
      world: {
         background: 0x8fb8e0,
         fog: 0xbcd6ee, fogNear: 1600, fogFar: 6000,
         skyTop: 0x1f5fa8, skyMid: 0x87b8e0, skyBot: 0xd3e6f2,
         skySun: [1.0, 0.94, 0.78], sunDisc: 0xfff4d6,
         sunLight: 0xfff0d2, sunIntensity: 2.4,
         hemiSky: 0x99bbff, hemiGround: 0x0a1a2a, hemiIntensity: 0.55,
         ambient: 0x404a55, ambientIntensity: 0.35,
         cloud: 0xffffff,
         sea: {
            deep: [0.004, 0.032, 0.068], crest: [0.020, 0.170, 0.200],
            skyLo: [0.66, 0.79, 0.87], skyHi: [0.20, 0.44, 0.72],
            sss: [0.03, 0.30, 0.26], sun: [1.0, 0.93, 0.78],
            foam: [0.93, 0.96, 0.97], haze: [0.67, 0.79, 0.88],
            specular: 1.0,
         },
         terrain: {
            rock: [0.42, 0.40, 0.38], grass: [0.33, 0.42, 0.24], sand: [0.80, 0.73, 0.55],
            shallow: [0.45, 0.62, 0.60], deep: [0.16, 0.30, 0.40], surf: [1.0, 1.0, 1.0],
         },
         sail: null,            // null: every sail keeps the colour it was built with
         smoke: 0xf0efe9, splash: 0xdff0ff,
      },
      hud: {
         font: "system-ui",
         rose: "rgba(8,20,32,0.85)", rim: "rgba(120,180,220,0.45)",
         tick: "rgba(200,220,240,0.4)", north: "#ff5d5d", letter: "rgba(210,230,250,0.85)",
         trueWind: "#4ea3ff", ship: "#ff4444", shipLuff: "#ffcc44", apparent: "#44ffcc",
         engraved: false,
         damageStops: [[0.00, [42, 20, 18]], [0.30, [150, 52, 38]], [0.60, [176, 130, 40]], [1.00, [46, 122, 72]]],
      },
   },

   // Hand-coloured aquatint: teal-grey sky, olive sea, cream crests, buff
   // sails, warm haze. Nothing pure black or pure white - the darkest tone is
   // the printer's ink, the brightest the paper.
   aquatint: {
      world: {
         background: 0xcfcdb6,
         fog: 0xcfcdb6, fogNear: 1200, fogFar: 5000,
         skyTop: 0x5f8ea6, skyMid: 0xa9c3c8, skyBot: 0xe6dcc2,
         skySun: 0xf6ecd2, sunDisc: 0xf1e9d2,
         sunLight: 0xf2e6cc, sunIntensity: 1.8,
         hemiSky: 0xb8c2bd, hemiGround: 0x3a3a30, hemiIntensity: 0.6,
         ambient: 0x5a564c, ambientIntensity: 0.45,
         cloud: 0xf3ead6,
         sea: {
            deep: 0x28402f, crest: 0x6f9364,
            skyLo: 0xaebba8, skyHi: 0x7f9e97,
            sss: 0x6a9457, sun: 0xf6ecd2,
            foam: 0xe9e2cc, haze: 0xc2c6ae,
            specular: 0.5,
         },
         terrain: {
            rock: 0x8c8474, grass: 0x8b956a, sand: 0xd4c69e,
            shallow: 0x8faa98, deep: 0x4c6656, surf: 0xe9e2cc,
         },
         sail: 0xd9cfae,
         smoke: 0xded8c8, splash: 0xe6e0cc,
      },
      hud: {
         font: "'IM Fell English', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif",
         rose: "rgba(236,226,200,0.82)", rim: "rgba(42,35,28,0.7)",
         tick: "rgba(42,35,28,0.55)", north: "#8a2f24", letter: "rgba(42,35,28,0.85)",
         trueWind: "#3a5468", ship: "#8a2f24", shipLuff: "#b8862b", apparent: "#4f7a5a",
         engraved: true,
         damageStops: [[0.00, [42, 35, 28]], [0.30, [138, 47, 36]], [0.60, [184, 134, 43]], [1.00, [79, 122, 90]]],
      },
   },
};

/** The palette for a style name (unknown names give the default). */
export function palette(name = current) {
   return PALETTE[name] || PALETTE[DEFAULT_STYLE];
}

/** Linear [r, g, b] for a palette colour (hex number or raw float array). */
export function rgb(c) {
   if (Array.isArray(c)) return c;
   const r = ((c >> 16) & 255) / 255, g = ((c >> 8) & 255) / 255, b = (c & 255) / 255;
   return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
}

/** sRGB hex string for CSS and canvas code (float arrays are encoded back). */
export function hex(c) {
   const [r, g, b] = Array.isArray(c) ? c.map(linearToSrgb) : rgb(c).map(linearToSrgb);
   const h = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0");
   return "#" + h(r) + h(g) + h(b);
}

export function srgbToLinear(v) {
   return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v) {
   return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
