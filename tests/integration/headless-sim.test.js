// tests/integration/headless-sim.test.js
//
// Der Beweis, auf dem Phase 1 steht: @segel/shared laeuft in Node - ohne DOM,
// ohne WebGL, ohne Renderer - und traegt einen vollstaendigen Raum.
//
// Wenn hier etwas kaputtgeht, ist es fast immer dasselbe: irgendwo hat sich
// eine Three.js-Abhaengigkeit in die geteilte Logik geschlichen, die im
// Browser stillschweigend funktioniert.
import { HeadlessRoom, HeadlessShip, DEFAULT_PARAMS } from "../../packages/server/src/headless.ts";
import { SIM_HZ, SIM_DT, SeaState } from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("Headless-Simulation");
const { ok, near, eq } = suite;

suite.section("Kein Browser noetig");
{
   eq(typeof globalThis.document, "undefined", "es gibt kein document");
   eq(typeof globalThis.window, "undefined", "es gibt kein window");
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   ok(room.world.features.length > 0, "und trotzdem steht eine Seekarte",
      room.world.features.length + " Merkmale");
   ok(room instanceof HeadlessRoom, "ein Raum laesst sich aufsetzen");
}

suite.section("Ein Raum laeuft");
{
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   const a = room.add("a", "lydia", 0, 0, 110);
   const b = room.add("b", "amelie", 420, 120, 270);
   ok(a instanceof HeadlessShip && b instanceof HeadlessShip, "zwei Schiffe im Raum");
   eq(room.tick, 0, "Tickzaehler beginnt bei 0");

   for (let i = 0; i < SIM_HZ * 60; i++) {
      room.step([{ seq: i, rudder: Math.sin(i * 0.004) * 0.12 }], "a");
   }
   eq(room.tick, SIM_HZ * 60, "1800 Ticks gerechnet");
   near(room.t, 60, 1e-9, "das sind genau 60 s Spielzeit");

   const snap = room.snapshot();
   eq(snap.ships.length, 2, "der Snapshot fuehrt beide Schiffe");
   eq(snap.tick, room.tick, "und den Tickzaehler");
   ok(snap.sea.seaWind > 0 && snap.sea.phaseT > 0, "und den Wasserzustand");

   const A = snap.ships.find((s) => s.id === "a");
   eq(A.lastSeq, SIM_HZ * 60 - 1, "die letzte angewandte Eingabe wird bestaetigt");
   ok(A.speed > 0, "das Schiff hat Fahrt aufgenommen", A.speed.toFixed(2) + " kn");
   ok(Math.hypot(A.x, A.z) > 100, "und Strecke gemacht", Math.hypot(A.x, A.z).toFixed(0) + " m");
}

suite.section("Der Snapshot ist vollstaendig");
{
   // Jedes Feld, das BoatDynamics.step() als Eingabe braucht, muss drinstehen -
   // sonst kann der Client von einem bestaetigten Stand nicht nachsimulieren.
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   room.add("a", "lydia", 0, 0, 110);
   for (let i = 0; i < 60; i++) room.step([{ seq: i, rudder: 0.3 }], "a");
   const s = room.snapshot().ships[0];
   for (const key of [
      "id", "vesselId", "x", "z", "heading", "speed", "heel", "sailSet", "rudder",
      "twa", "tack", "luffing", "isCapsized", "alive",
      "hullIntegrity", "mastsStanding", "flooding", "afire", "struck", "sunk",
      "reloadPort", "reloadStbd", "ammo",
      "driveMul", "rudderMul", "dragMul", "turnBias", "heelBias", "stopped", "wreckDrag",
      "lastSeq",
   ]) {
      ok(s[key] !== undefined, "ShipState enthaelt " + key);
   }
   ok(JSON.stringify(room.snapshot()).length > 0, "der Snapshot ist serialisierbar");
   suite.note(JSON.stringify(room.snapshot()).length + " Bytes fuer zwei Ticks-Felder eines Schiffs");
}

suite.section("Eingaben kommen an");
{
   const mk = (rudder) => {
      const room = new HeadlessRoom(DEFAULT_PARAMS);
      room.add("a", "lydia", 0, 0, 110);
      for (let i = 0; i < 300; i++) room.step([{ seq: i, rudder }], "a");
      return room.snapshot().ships[0];
   };
   const left = mk(-1);
   const straight = mk(0);
   const right = mk(1);
   ok(left.heading !== straight.heading, "Ruder Backbord aendert den Kurs");
   ok(right.heading !== straight.heading, "Ruder Steuerbord ebenso");
   ok(Math.sign(((left.heading - straight.heading + 540) % 360) - 180) !==
      Math.sign(((right.heading - straight.heading + 540) % 360) - 180),
      "und zwar in entgegengesetzte Richtungen",
      left.heading.toFixed(1) + "° / " + straight.heading.toFixed(1) + "° / " + right.heading.toFixed(1) + "°");
   near(straight.rudder, 0, 1e-9, "ohne Ruderlage bleibt das Ruder mittschiffs");
   near(right.rudder, 1, 1e-6, "nach 10 s steht das Ruder voll am Anschlag");
}

suite.section("Reproduzierbar");
{
   const run = () => {
      const room = new HeadlessRoom(DEFAULT_PARAMS);
      room.add("a", "lydia", 0, 0, 110);
      room.add("b", "amelie", 420, 120, 270);
      const trace = [];
      for (let i = 0; i < 600; i++) {
         room.step([{ seq: i, rudder: Math.sin(i * 0.01) }], "a");
         if (i % 25 === 0) {
            room.ships.get("b").dmg.applyHit({ side: "PORT", s: (i % 300) / 300, y: 3 });
         }
         const snap = room.snapshot();
         trace.push(...snap.ships.flatMap((s) => [s.x, s.z, s.heading, s.speed, s.hullIntegrity]));
         trace.push(snap.sea.seaWind, snap.sea.phaseT);
      }
      return fingerprint(trace);
   };
   eq(run(), run(), "zwei Laeufe aus denselben Parametern: identische Spur", run());
}

suite.section("Der Wasserzustand laesst sich uebertragen");
{
   // SeaSync ist der Teil, den der Client NICHT nachrechnen kann.
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   room.add("a", "lydia", 0, 0, 110);
   for (let i = 0; i < 900; i++) room.step([{ seq: i, rudder: 0 }], "a");

   const client = new SeaState(0);
   client.fromSync(room.snapshot().sea);
   client.windRad = room.sea.windRad;
   near(client.heightAt(37.5, -82.25), room.sea.heightAt(37.5, -82.25), 1e-12,
      "der Client steht auf exakt derselben Welle");
   near(client.amp, room.sea.amp, 1e-12, "gleiche Amplitude");

   // Und ohne den Snapshot eben nicht.
   const guessing = new SeaState(DEFAULT_PARAMS.windBaseSpeed);
   ok(Math.abs(guessing.heightAt(37.5, -82.25) - room.sea.heightAt(37.5, -82.25)) > 1e-6,
      "wer den Wasserzustand raet, steht auf einer anderen Welle");
}

suite.section("Geschwindigkeit");
{
   // Ein Server muss viele Raeume tragen. Die Zahl ist kein Grenzwert, sondern
   // eine Groessenordnung, die auffaellt, wenn sie einbricht.
   const room = new HeadlessRoom(DEFAULT_PARAMS);
   for (let i = 0; i < 4; i++) room.add("s" + i, i % 2 ? "amelie" : "lydia", i * 200, i * 90, i * 80);
   const t0 = Date.now();
   const TICKS = SIM_HZ * 120;
   for (let i = 0; i < TICKS; i++) room.step([{ seq: i, rudder: 0.2 }], "s0");
   const ms = Date.now() - t0;
   const realtime = (TICKS * SIM_DT * 1000) / Math.max(ms, 1);
   ok(realtime > 50, "vier Schiffe, zwei Minuten Spielzeit laufen weit schneller als Echtzeit",
      ms + " ms, Faktor " + realtime.toFixed(0));
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
