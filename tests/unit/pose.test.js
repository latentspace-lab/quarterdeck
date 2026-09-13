// tests/unit/pose.test.js - wie ein Rumpf auf der Welle liegt.
//
// Diese Mathematik entscheidet mit, ob ein Schuss unter der Wasserlinie, in
// die Bordwand oder ins Rigg geht. Rechnete der Server eine andere Lage als
// der Client, bekaeme derselbe Schuss zwei Ergebnisse.
import { shipPose, railClearance, lerpPose, lerpVec, shortestAngle, getVessel, DEG, seaHeight } from "@segel/shared";
import { createSuite } from "../lib/harness.js";

const suite = createSuite("pose");
const { ok, near, eq } = suite;

const HULL = getVessel("lydia").hull;
const flat = () => 0;
const base = (over = {}) => ({
   pos: { x: 0, z: 0 }, heading: 0, heel: 0, twaSigned: 1,
   flooding: 0, recoilRoll: 0, hull: HULL, ...over,
});

suite.section("Spiegelglatte See");
{
   const p = shipPose(base(), flat);
   near(p.y, 0, 1e-12, "ohne Wellen schwimmt sie auf Null");
   near(p.rollZ, 0, 1e-12, "kein Rollen");
   near(p.pitchX, 0, 1e-12, "kein Stampfen");
   near(p.seaY, 0, 1e-12, "Wasserflaeche auf Null");
   eq(p.sinkIn, 0, "kein Wassereinbruch");
   near(shipPose(base({ heading: 137 }), flat).yawY, 137 * DEG, 1e-12, "Gierwinkel folgt dem Kurs");
}

suite.section("Krengung");
{
   const stbd = shipPose(base({ heel: 10, twaSigned: 1 }), flat);
   const port = shipPose(base({ heel: 10, twaSigned: -1 }), flat);
   near(stbd.rollZ, 10 * DEG, 1e-12, "Wind von Steuerbord: Krengung nach Lee");
   near(port.rollZ, -10 * DEG, 1e-12, "Wind von Backbord: andere Seite");
   ok(Math.sign(stbd.rollZ) !== Math.sign(port.rollZ), "die Seiten sind gespiegelt");

   const kick = shipPose(base({ heel: 10, recoilRoll: 3 }), flat);
   near(kick.rollZ - stbd.rollZ, 3 * DEG, 1e-12, "der Rueckstoss addiert sich auf");
}

suite.section("Wassereinbruch");
{
   const dry = shipPose(base(), flat);
   const wet = shipPose(base({ flooding: 0.5 }), flat);
   ok(wet.y < dry.y, "Wasser im Schiff drueckt sie tiefer",
      (dry.y - wet.y).toFixed(3) + " m");
   near(wet.sinkIn, 0.5 * HULL.draft * 0.55, 1e-12, "Tauchtiefe folgt dem Flutungsgrad");
   const full = shipPose(base({ flooding: 1 }), flat);
   ok(full.y < wet.y, "mehr Wasser, tiefer");
}

suite.section("Auftrieb mittelt ueber den Rumpf");
{
   // Eine Welle genau quer zum Schiff: unter dem Grossmast steht ein Kamm,
   // ueber die Rumpflaenge gemittelt liegt sie deutlich tiefer. Ohne diese
   // Mittelung stand die See auf dem Batteriedeck.
   const L = HULL.loa;
   const crest = (x, z) => Math.cos((z / L) * Math.PI * 2) * 2;
   const p = shipPose(base(), crest);
   ok(p.seaY < crest(0, 0), "der Rumpf sitzt tiefer als der Kamm unter der Mitte",
      p.seaY.toFixed(2) + " statt " + crest(0, 0).toFixed(2));
   ok(Number.isFinite(p.pitchX), "Stampfen ist endlich");
}

suite.section("Stampfen und Rollen folgen der Welle");
{
   const L = HULL.loa;
   // Laengsneigung: Bug hoch, Heck tief.
   const slopeZ = (x, z) => z * 0.05;
   const pitch = shipPose(base({ heading: 0 }), slopeZ);
   ok(Math.abs(pitch.pitchX) > 1e-6, "eine Laengsneigung erzeugt Stampfen",
      (pitch.pitchX / DEG).toFixed(2) + "°");
   ok(Math.abs(pitch.pitchX) <= 0.18 + 1e-12, "Stampfen ist gedeckelt");

   // Querneigung: eine Seite hoch.
   const slopeX = (x, z) => x * 0.05;
   const roll = shipPose(base({ heading: 0 }), slopeX);
   ok(Math.abs(roll.rollZ) > 1e-6, "eine Querneigung erzeugt Rollen");

   // Masse daempft. Absolut rollt die breitere Fregatte auf einer konstanten
   // Neigung sogar etwas mehr - sie tastet ueber eine groessere Spannweite ab.
   // Gedaempft wird sie BEZOGEN AUF IHRE BREITE, und genau das leistet
   // massDamp = clamp(11/loa, 0.32, 1).
   const yachtHull = getVessel("yacht").hull;
   const small = shipPose(base({ hull: yachtHull }), slopeX);
   const big = shipPose(base({ hull: HULL }), slopeX);
   const perBeam = (p, h) => Math.abs(p.rollZ) / h.beam;
   ok(perBeam(small, yachtHull) > perBeam(big, HULL) * 2,
      "je Meter Breite rollt die Yacht deutlich mehr als die Fregatte",
      (perBeam(small, yachtHull) / perBeam(big, HULL)).toFixed(1) + "x");
   // Und ein sehr langes Schiff erreicht die Daempfungsgrenze.
   const liner = shipPose(base({ hull: { ...HULL, loa: 200 } }), slopeX);
   const frig = shipPose(base({ hull: { ...HULL, loa: 40 } }), slopeX);
   ok(Math.abs(liner.rollZ) <= Math.abs(frig.rollZ) + 1e-12,
      "ab loa 34 m ist die Daempfung am Anschlag (0.32)");
}

suite.section("railClearance(): Wasser ueber die Reling");
{
   const FB = 5.16;
   const halfBeam = HULL.beam / 2;
   ok(railClearance(FB, 0, halfBeam, 0, 0, 0) > 0, "aufrecht ist reichlich Freibord");
   near(railClearance(FB, 0, halfBeam, 0, 0, 0), FB, 1e-12, "aufrecht genau das Freibord");
   const heeled = railClearance(FB, 45 * DEG, halfBeam, 0, 0, 0);
   ok(heeled < FB, "Krengung senkt die Lee-Reling", heeled.toFixed(2) + " m");
   ok(railClearance(FB, 80 * DEG, halfBeam, 0, 0, 0) < 0,
      "bei extremer Krengung laeuft die See ueber Deck");
   ok(railClearance(FB, 0, halfBeam, 3, 0, 0) < FB, "Wassereinbruch senkt sie ebenfalls");
   ok(railClearance(FB, 0, halfBeam, 0, 0, 2) < FB, "eine hohe Lee-Welle ebenfalls");
   // Das Vorzeichen ist gespiegelt: Rollen nach beiden Seiten kostet gleich viel.
   near(railClearance(FB, 0.4, halfBeam, 0, 0, 0), railClearance(FB, -0.4, halfBeam, 0, 0, 0),
      1e-12, "die Seite spielt keine Rolle");
}

suite.section("Interpolation fuer die Darstellung");
{
   const a = shipPose(base({ heading: 10, heel: 4 }), flat);
   const b = shipPose(base({ heading: 20, heel: 8 }), flat);
   const m = lerpPose(a, b, 0.5);
   near(m.rollZ, (a.rollZ + b.rollZ) / 2, 1e-12, "Rollen mittelt");
   near(m.yawY, (a.yawY + b.yawY) / 2, 1e-12, "Gieren mittelt");
   eq(lerpPose(a, b, 0).yawY, a.yawY, "alpha 0 ist der vorige Schritt");
   eq(lerpPose(a, b, 1).yawY, b.yawY, "alpha 1 ist der aktuelle");

   // Ueberlauf: von 359 nach 1 Grad ist der kurze Weg 2 Grad, nicht 358.
   const p359 = shipPose(base({ heading: 359 }), flat);
   const p1 = shipPose(base({ heading: 1 }), flat);
   const mid = lerpPose(p359, p1, 0.5);
   const midDeg = ((mid.yawY / DEG) % 360 + 360) % 360;
   ok(midDeg > 359.5 || midDeg < 0.5, "der Kurs schwenkt ueber den Nullpunkt den kurzen Weg",
      midDeg.toFixed(2) + "°");

   near(shortestAngle(0.1, 6.2), 6.2 - 0.1 - 2 * Math.PI, 1e-12, "shortestAngle nimmt den kurzen Weg");
   const v = lerpVec({ x: 0, z: 10 }, { x: 10, z: 0 }, 0.25);
   near(v.x, 2.5, 1e-12, "lerpVec x");
   near(v.z, 7.5, 1e-12, "lerpVec z");
}

suite.section("Reinheit");
{
   // shipPose darf nichts ausser der Wasserflaeche lesen und nichts schreiben.
   const input = base({ heading: 33, heel: 7, flooding: 0.2 });
   const before = JSON.stringify(input);
   const p1 = shipPose(input, flat);
   const p2 = shipPose(input, flat);
   eq(JSON.stringify(input), before, "die Eingabe bleibt unveraendert");
   eq(JSON.stringify(p1), JSON.stringify(p2), "zweimal aufgerufen, zweimal dasselbe");

   // Mit echter See: identische Eingaben, identische Lage.
   const sea = (x, z) => seaHeight(x, z, 12.5, 1.7, 0.3, 1.1);
   eq(JSON.stringify(shipPose(input, sea)), JSON.stringify(shipPose(input, sea)),
      "auch auf bewegter See reproduzierbar");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
