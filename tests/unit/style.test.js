// tests/unit/style.test.js - choosing and describing the rendering style.
//
// The style is picked from the URL, then the stored preference, then the
// default; the plain palette must keep the values the old code had so that
// ?style=plain renders exactly as before the aquatint work.
import {
   STYLES, DEFAULT_STYLE, STORAGE_KEY, PALETTE,
   readStyleFromParams, storeStyle, nextStyle, palette, rgb, hex, currentStyle, setCurrentStyle,
} from "../../packages/client/src/style.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("rendering style");
const { ok, eq, near, deepEq } = suite;

const memStorage = (init = {}) => {
   const m = { ...init };
   return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, dump: () => m };
};

suite.section("choosing the style");
{
   eq(DEFAULT_STYLE, "aquatint", "the aquatint look is the default");
   eq(readStyleFromParams("", null), "aquatint", "no URL, no storage: default");
   eq(readStyleFromParams("?style=plain", null), "plain", "?style=plain selects the plain look");
   eq(readStyleFromParams("?mp=1&style=aquatint", null), "aquatint", "the flag sits next to the other params");
   eq(readStyleFromParams("?style=neon", null), "aquatint", "an unknown value falls back to the default");
   eq(readStyleFromParams("", memStorage({ [STORAGE_KEY]: "plain" })), "plain", "a stored choice is honoured");
   eq(readStyleFromParams("?style=aquatint", memStorage({ [STORAGE_KEY]: "plain" })), "aquatint", "but the URL wins over storage");
   eq(readStyleFromParams("", memStorage({ [STORAGE_KEY]: "bogus" })), "aquatint", "a stale stored value is ignored");
   eq(readStyleFromParams("", { getItem() { throw new Error("blocked"); } }), "aquatint", "a throwing storage does not break startup");
   const st = memStorage();
   storeStyle("plain", st);
   eq(st.dump()[STORAGE_KEY], "plain", "storeStyle writes the key");
   storeStyle("plain", { setItem() { throw new Error("quota"); } });
   ok(true, "storeStyle survives a throwing storage");
   eq(nextStyle("aquatint"), "plain", "P cycles aquatint -> plain");
   eq(nextStyle("plain"), "aquatint", "and back");
   eq(setCurrentStyle("plain"), "plain", "setCurrentStyle accepts a known style");
   eq(currentStyle(), "plain", "and currentStyle reports it");
   eq(setCurrentStyle("nope"), "aquatint", "an unknown style resets to the default");
}

suite.section("palettes");
{
   for (const s of STYLES) ok(PALETTE[s] && PALETTE[s].world && PALETTE[s].hud, "palette for " + s);
   eq(palette("nope"), PALETTE[DEFAULT_STYLE], "unknown style gives the default palette");
   const keys = (o) => Object.keys(o).sort().join(",");
   eq(keys(PALETTE.plain.world), keys(PALETTE.aquatint.world), "both worlds carry the same keys");
   eq(keys(PALETTE.plain.world.sea), keys(PALETTE.aquatint.world.sea), "same sea keys");
   eq(keys(PALETTE.plain.world.terrain), keys(PALETTE.aquatint.world.terrain), "same terrain keys");
   eq(keys(PALETTE.plain.hud), keys(PALETTE.aquatint.hud), "same HUD keys");

   // The plain world is the old code, value for value.
   const p = PALETTE.plain.world;
   eq(p.skyTop, 0x1f5fa8, "plain sky top is the old 0x1f5fa8");
   eq(p.fog, 0xbcd6ee, "plain fog is the old 0xbcd6ee");
   eq(p.sunIntensity, 2.4, "plain sun intensity 2.4");
   deepEq(p.sea.deep, [0.004, 0.032, 0.068], "plain deep water is the old shader literal");
   deepEq(p.sea.foam, [0.93, 0.96, 0.97], "plain foam is the old shader literal");
   deepEq(p.terrain.grass, [0.33, 0.42, 0.24], "plain grass is the old vertex colour");
   eq(p.sail, null, "plain sails keep their built-in colour");
   eq(PALETTE.plain.hud.north, "#ff5d5d", "plain compass north stays alarm red");
}

suite.section("colour helpers");
{
   deepEq(rgb([0.1, 0.2, 0.3]), [0.1, 0.2, 0.3], "raw float arrays pass through");
   near(rgb(0xffffff)[0], 1, 1e-9, "white hex is 1.0 linear");
   near(rgb(0x808080)[1], 0.2158, 1e-3, "mid grey hex decodes to ~0.216 linear");
   eq(hex(0x8a2f24), "#8a2f24", "hex round-trips a hex number");
   eq(hex([1, 1, 1]), "#ffffff", "hex encodes a linear white");
   eq(hex([0.2158, 0.2158, 0.2158]), "#808080", "hex encodes linear mid grey back to #808080");
   const tri = (c) => rgb(c).length === 3 && rgb(c).every((v) => v >= 0 && v <= 1);
   ok(STYLES.every((s) => {
      const w = PALETTE[s].world;
      const seaCols = Object.entries(w.sea).filter(([k]) => k !== "specular").map(([, v]) => v);
      return [w.skyTop, w.skyMid, w.skyBot, w.skySun, w.sunDisc, w.fog, w.cloud, w.smoke, w.splash,
         w.background, w.sunLight, w.hemiSky, w.hemiGround, w.ambient,
         ...seaCols, ...Object.values(w.terrain)].every(tri);
   }), "every world colour decodes to a valid linear triple");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
