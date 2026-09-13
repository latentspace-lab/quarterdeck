// pose.ts - wie ein Rumpf auf der Welle liegt.
//
// Reine Mathematik ueber seaHeight(): aus Position, Kurs, Krengung und
// Wassereinbruch werden Tauchtiefe, Rollwinkel und Stampfwinkel. Der Client
// setzt das Ergebnis auf sein Three.js-Modell, der Server baut daraus die
// Matrix fuer die Trefferpruefung.
//
// Warum das geteilt werden MUSS: die Ballistik entscheidet anhand der
// Rumpflage, ob ein Schuss unter der Wasserlinie einschlaegt, in die Bordwand
// geht oder ins Rigg. Rechnete der Client eine andere Lage als der Server,
// bekaeme derselbe Schuss zwei verschiedene Ergebnisse.

import { clamp, dirVec, DEG } from "./utils.ts";
import type { SeaHeightFn } from "./ocean-math.ts";
import type { Vec2 } from "./utils.ts";

/** Rumpfmasse, soweit die Lage sie braucht. */
export interface PoseHull {
   loa: number;
   beam: number;
   draft: number;
}

/**
 * Freeboard to the top of the bulwark, measured amidships (m).
 *
 * A square-rigger of the period carried its gun deck a good two metres above
 * the water and the bulwark as high again - otherwise the sea would stand in
 * the battery in any seaway. The client's warship builder and the server's
 * swamp check must agree on this number, so it lives here.
 */
export function freeboardOf(hull: PoseHull): number {
   return hull.draft * 0.8 + hull.beam * 0.11;
}

export interface PoseInput {
   pos: Vec2;
   /** Kurs (Grad) */
   heading: number;
   /** Krengung (Grad, vorzeichenlos) */
   heel: number;
   /** Vorzeichenbehafteter TWA - bestimmt, nach welcher Seite sie krengt */
   twaSigned: number;
   /** Wasser im Schiff, 0..1 */
   flooding: number;
   /** Krengungsstoss aus dem Rueckstoss (Grad) */
   recoilRoll: number;
   hull: PoseHull;
}

export interface Pose {
   /** Hoehe des Rumpfmittelpunkts (m) */
   y: number;
   /** Rollwinkel um die Laengsachse (rad) */
   rollZ: number;
   /** Stampfwinkel um die Querachse (rad) */
   pitchX: number;
   /** Gierwinkel (rad) - Kurs in Three.js-Konvention */
   yawY: number;
   /** Hoehe der mittleren Wasserflaeche unter dem Schiff (m) */
   seaY: number;
   /** Wasserflaeche an der tiefer liegenden Bordwand (m) */
   leeY: number;
   /** Wie tief der Wassereinbruch sie drueckt (m) */
   sinkIn: number;
}

/**
 * Lage eines Rumpfs auf der See.
 *
 * Ein Schiff schwimmt auf der Flaeche, die sein Rumpf verdraengt, nicht auf
 * dem Wert unter dem Grossmast: darum wird ueber Bug, Heck und beide Seiten
 * gemittelt. Ohne diese Mittelung lag der Rumpf auf jedem Wellenkamm unter
 * Wasser - die See stand dann auf dem Batteriedeck.
 */
export function shipPose(input: PoseInput, sea: SeaHeightFn): Pose {
   const { pos: p, heading, heel, twaSigned, flooding, recoilRoll, hull } = input;

   const heelSide = twaSigned > 0 ? 1 : -1;
   const halfBeam = hull.beam / 2;
   const probe = hull.loa * 0.36;
   const massDamp = clamp(11 / hull.loa, 0.32, 1);

   const port = dirVec(heading - 90);
   const stbd = dirVec(heading + 90);
   const ahead = dirVec(heading);

   const hP = sea(p.x + port.x * halfBeam, p.z + port.z * halfBeam);
   const hS = sea(p.x + stbd.x * halfBeam, p.z + stbd.z * halfBeam);
   const waveRoll = (hS - hP) * 0.18 * massDamp;

   const hF = sea(p.x + ahead.x * probe, p.z + ahead.z * probe);
   const hR = sea(p.x - ahead.x * probe, p.z - ahead.z * probe);
   const hy = (sea(p.x, p.z) * 2 + hP + hS + hF + hR) / 6;

   // Wasser im Schiff drueckt sie tiefer
   const sinkIn = flooding * hull.draft * 0.55;

   const rollZ = heelSide * heel * DEG + waveRoll + recoilRoll * DEG;
   const pitchX = clamp(
      (-(hF - hR) * 1.4 * massDamp) / Math.max(probe / 4, 1),
      -0.18,
      0.18,
   );

   return {
      y: hy - sinkIn,
      rollZ,
      pitchX,
      yawY: heading * DEG,
      seaY: hy,
      leeY: Math.min(hP, hS),
      sinkIn,
   };
}

/**
 * Freibord der Lee-Reling ueber der oertlichen Wasserflaeche.
 * Negativ = die See laeuft ueber Deck.
 *
 * Die Lee-Reling ist der tiefste Punkt des Decks. Taucht sie unter die
 * oertliche Wasserflaeche, stuerzt See in die Batterie: das Schiff nimmt
 * Wasser, die Leute an Deck gehen ueber Bord. Genau deshalb liess man bei
 * steifer Brise reffen und schloss die unteren Pforten.
 */
export function railClearance(
   freeboard: number,
   rollRad: number,
   halfBeam: number,
   sinkIn: number,
   seaY: number,
   leeY: number,
): number {
   const roll = Math.abs(rollRad);
   // Reling kippt zur Lee: Hoehe sinkt um sin(krengung) * halbe Breite
   const rail = freeboard * Math.cos(roll) - halfBeam * Math.sin(roll) - sinkIn;
   return rail - (leeY - seaY);
}

/**
 * Zwischen zwei Lagen interpolieren - fuer die Darstellung zwischen zwei
 * Simulationsschritten. Winkel werden kurzwegig gemischt, damit der Kurs beim
 * Ueberlauf 359 -> 1 nicht einmal rundherum schwenkt.
 */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
   return {
      y: a.y + (b.y - a.y) * t,
      rollZ: a.rollZ + (b.rollZ - a.rollZ) * t,
      pitchX: a.pitchX + (b.pitchX - a.pitchX) * t,
      yawY: a.yawY + shortestAngle(a.yawY, b.yawY) * t,
      seaY: a.seaY + (b.seaY - a.seaY) * t,
      leeY: a.leeY + (b.leeY - a.leeY) * t,
      sinkIn: a.sinkIn + (b.sinkIn - a.sinkIn) * t,
   };
}

/** Kuerzester Weg von a nach b im Bogenmass, in [-PI, PI]. */
export function shortestAngle(a: number, b: number): number {
   const TAU = Math.PI * 2;
   let d = (b - a) % TAU;
   if (d > Math.PI) d -= TAU;
   if (d < -Math.PI) d += TAU;
   return d;
}

/** Lineare Interpolation zweier Positionen. */
export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
   return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
