// tests/unit/voice.test.js - the voice catalogue: every trigger names a line,
// every line has a file for every nation, and every file really is MP3.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createSuite } from "../lib/harness.js";
import { TRIGGER, NATIONS, VOICE_KEYS, voiceSrc, VoiceAudio } from "../../packages/client/src/audio.js";

const suite = createSuite("voice lines");
const { ok, eq } = suite;

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "packages", "client", "public");
const onDisk = (src) => join(PUBLIC, src.replace(/^.*sounds\//, "sounds/"));

suite.section("Triggers");
for (const [name, key] of Object.entries(TRIGGER)) {
   ok(VOICE_KEYS.includes(key), `TRIGGER.${name} -> "${key}" is a catalogued line`);
}
eq(voiceSrc("ahoi"), voiceSrc("ahoi", "GB"), "the default nation is GB");
eq(voiceSrc("no-such-line"), null, "an unknown key yields no source instead of a bad URL");

suite.section("Files");
for (const nation of Object.values(NATIONS)) {
   for (const key of VOICE_KEYS) {
      const src = voiceSrc(key, nation);
      const file = onDisk(src);
      ok(src.endsWith(".mp3"), `${nation} ${key} is served as .mp3`, src);
      ok(existsSync(file), `${nation} ${key} exists on disk`, file);
      if (existsSync(file)) {
         const b = readFileSync(file);
         const mp3 = b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe6) === 0xe2);
         ok(mp3, `${nation} ${key} really is MPEG audio`);
      }
   }
}

suite.section("Player");
{
   const v = new VoiceAudio();
   eq(v.enabled, false, "off by default - the lines are only heard with ?voice=1");
   eq(v.loaded("GB"), false, "nothing loaded before preload");
   eq(v.play("ahoi"), false, "playing while off is a harmless no-op");
}

export default () => suite.done();

if (!process.env.QUARTERDECK_TEST_RUNNER) suite.done();
