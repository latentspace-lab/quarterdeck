// pose.ts - wie ein hull auf der wave liegt.
//
// Reine Mathematik ueber seaHeight(): aus position, course, heel und
// watereinbruch werden Tauchtiefe, Rollwinkel und Stampfwinkel. Der Client
// setzt das Ergebnis auf sein Three.js-Modell, der Server baut daraus die
// Matrix fuer die hitpruefung.
//
// Warum das geteilt werden MUSS: die ballistics entscheidet anhand der
// hulllage, ob ein Schuss unter der waterlinie einschlaegt, in die hull side
// geht oder ins Rigg. Rechnete der Client eine andere Lage als der Server,
// bekaeme derselbe Schuss zwei verschiedene Ergebnisse.

import { clamp, dirVec, DEG } from "./utils.ts";
import type { SeaHeightFn } from "./ocean-math.ts";
import type { Vec2 } from "./utils.ts";

/** hull mass, soweit die Lage sie braucht. */
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
   /** course (degrees) */
   heading: number;
   /** heel (degrees, vorzeichenlos) */
   heel: number;
   /** Vorzeichenbehafteter TWA - bestimmt, nach welcher side sie krengt */
   twaSigned: number;
   /** water im ship, 0..1 */
   flooding: number;
   /** heelsstoss aus dem Rueckstoss (degrees) */
   recoilRoll: number;
   hull: PoseHull;
}

export interface Pose {
   /** height des hullmittelpunkts (m) */
   y: number;
   /** Rollwinkel um die Laengsachse (rad) */
   rollZ: number;
   /** Stampfwinkel um die Querachse (rad) */
   pitchX: number;
   /** heelwinkel (rad) - course in Three.js-Konvention */
   yawY: number;
   /** height der mittleren waterflaeche unter dem ship (m) */
   seaY: number;
   /** waterflaeche an der tiefer liegenden hull side (m) */
   leeY: number;
   /** how tief der watereinbruch sie drueckt (m) */
   sinkIn: number;
}

/**
 * Lage eines hulls auf der sea.
 *
 * Ein ship schwimmt auf der Flaeche, die sein hull verdraengt, nicht auf
 * dem value unter dem Grossmast: darum wird ueber bow, stern und beide siden
 * gemittelt. Ohne diese Mittelung lag der hull auf jedem waveskamm unter
 * water - die sea stand dann auf dem batterydeck.
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

   // water im ship drueckt sie tiefer
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
 * freeboard der leeward-railing ueber der oertlichen waterflaeche.
 * Negativ = die sea laeuft ueber deck.
 *
 * Die leeward-railing ist der tiefste Punkt des decks. Taucht sie unter die
 * oertliche waterflaeche, stuerzt sea in die battery: das ship nimmt
 * water, die men an deck gehen ueber overboard. Genau deshalb liess man bei
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
   // railing kippt zur leeward: height sinkt um sin(krengung) * halbe Breite
   const rail = freeboard * Math.cos(roll) - halfBeam * Math.sin(roll) - sinkIn;
   return rail - (leeY - seaY);
}

/**
 * Zwischen zwei Lagen interpolieren - fuer die rendering zwischen zwei
 * Simulationsschritten. angle werden kurzwegig gemischt, damit der course beim
 * overlauf 359 -> 1 nicht einmal rundherum schwenkt.
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

/** Lineare Interpolation zweier positionen. */
export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
   return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
