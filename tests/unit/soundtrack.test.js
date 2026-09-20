// tests/unit/soundtrack.test.js - soundtrack module structure and path checks.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSuite } from "../lib/harness.js";
import { TRACKS, Soundtrack } from "../../packages/client/src/soundtrack.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "packages", "client", "public");

const suite = createSuite("soundtrack");
const { ok, eq } = suite;

suite.section("Track catalogue");
ok(TRACKS.length > 0, "at least one track is defined");

for (const t of TRACKS) {
   ok(t.id && typeof t.id === "string", `track "${t.id}" has an id`);
   ok(t.src && typeof t.src === "string", `track "${t.id}" has a src path`);
   ok(t.title && typeof t.title === "string", `track "${t.id}" has a title`);
   ok(t.src.includes("sounds/music/"), `track "${t.id}" src points into sounds/music/`);
   ok(!t.src.includes("//"), `track "${t.id}" src has no double slashes`);
   const rel = t.src.replace(/^.*sounds\//, "sounds/");
   ok(existsSync(join(PUBLIC, rel)), `track "${t.id}" file exists on disk`, join(PUBLIC, rel));
}

suite.section("Soundtrack class shape");
const st = new Soundtrack();
eq(st.enabled, true, "enabled by default");
eq(st.volume, 0.5, "default volume is 0.5");
eq(st.playing, false, "not playing initially");
eq(st.currentTrack, null, "no current track initially");

suite.section("Shuffle queue");
{
   const q = st._buildQueue(null);
   eq(q.length, TRACKS.length, "queue contains all tracks when no exclusion");

   const q2 = st._buildQueue(TRACKS[0].id);
   eq(q2.length, TRACKS.length - 1, "queue excludes the specified track");
   ok(!q2.includes(TRACKS[0].id), "excluded track is not in the queue");
}

suite.section("Volume control");
st.setVolume(0.8);
eq(st.volume, 0.8, "setVolume updates volume");
st.setVolume(1.5);
eq(st.volume, 1, "setVolume clamps to 1");
st.setVolume(-0.3);
eq(st.volume, 0, "setVolume clamps to 0");

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
