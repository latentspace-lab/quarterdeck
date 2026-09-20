// tests/unit/aquatint.test.js - the pixel budget of the aquatint pass.
//
// The world is rendered into an off-screen target that may be smaller than
// the canvas; the HUD stays at native resolution. The frame time is almost
// linear in the target's pixel count, so the budget is what holds the
// frame rate on a 4K screen while a 1440p one still renders 1:1.
import { renderScaleFor, DEFAULT_PIXEL_BUDGET } from "../../packages/client/src/aquatint.js";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("aquatint pixel budget");
const { ok, eq, near } = suite;

suite.section("render scale");
{
   eq(renderScaleFor(1920, 1080), 1, "1080p renders at full resolution");
   near(renderScaleFor(2560, 1440), 0.93, 0.01, "1440p is barely scaled (3.7 Mpx against a 3.2 Mpx budget)");
   const s4k = renderScaleFor(3840, 2160);
   ok(s4k < 1 && s4k > 0.5, "4K is scaled down, but not below half");
   near(3840 * s4k * 2160 * s4k, DEFAULT_PIXEL_BUDGET, 1, "the scaled 4K target meets the budget exactly");
   const sUw = renderScaleFor(3840, 1600);
   near(3840 * sUw * 1600 * sUw, DEFAULT_PIXEL_BUDGET, 1, "an ultra-wide 4K target meets the budget too");
   eq(renderScaleFor(3840, 2160, 3840 * 2160), 1, "a budget equal to the screen means no scaling");
   ok(renderScaleFor(3840, 2160, 1e6) < renderScaleFor(3840, 2160, 3e6), "a smaller budget scales further down");
   eq(renderScaleFor(0, 0), 1, "a degenerate size does not divide by zero");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
