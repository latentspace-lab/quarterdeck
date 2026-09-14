// vessels.js - shipkatalog: moderne Yacht + drei Royal-Navy-square-rigger
// (Hornblower-Aera, ca. 1800). Jeder Eintrag beschreibt hull mass, Rigg,
// polar curve, Manoevrierverhalten und - bei den warshipen - die battery.
//
// Konventionen wie im Rest des Projekts: angle in degrees, Speed in knots,
// Laengen in metresn, world X=Ost / Z=Nord / Y=hoch, bow = +Z.

// ---------------------------------------------------------------------------
// polar curven bei 15 kn wahrem wind (TWA in degrees -> Speed in knots)
// ---------------------------------------------------------------------------

// Bermuda sloop (moderne Yacht) - kreuzt hoch, schnellster course am Beam.

import type { Table } from "./utils.ts";

// ---------------------------------------------------------------------------
// Typen des shipkatalogs. Die Eintraege sind reine Daten - sie werden vom
// Client (3D-Modellbau), vom Server (Simulation) und von den Tests gelesen.
// ---------------------------------------------------------------------------

/** Rigg-Art. Bestimmt polar curve, reefing und Manoeververhalten. */
export type Rig = "bermuda" | "square";

export interface HullSpec {
   /** Laenge ueber alles (m) */
   loa: number;
   /** Groesste Breite (m) */
   beam: number;
   /** Tiefgang (m) */
   draft: number;
   /** displacement (t) */
   displacement: number;
}

export interface SailSpec {
   /** No-Go zone in degrees TWA */
   noGo: number;
   polar: Table;
   /** Schwung, den ein square-rigger durch die Wende mitnimmt (0..1) */
   tackAssist?: number;
}

/** overschreibt einzelne Felder von DEFAULT_PROFILE in physics.ts. */
export interface DynSpec {
   /** degrees/s bei vollem rudder und voller rudder effect */
   turnRate?: number;
   /** way (kn), ab der das rudder voll greift */
   rudderRef?: number;
   accelUp?: number;
   accelDown?: number;
   accelLuff?: number;
   maxHeel?: number;
   capsizeHeel?: number;
   heelScale?: number;
   leewayMax?: number;
}

export interface GunDeck {
   /** height der Pforten ueber der waterlinie, relativ zum freeboard */
   y: number;
   /** guns je side auf diesem deck */
   count: number;
   /** Laengsbereich der Pforten (0 = bow, 1 = Spiegel) */
   from: number;
   to: number;
   calibre: string;
}

export interface GunSpec {
   decks: GunDeck[];
   /** seconds fuer eine gut gedrillte Bedienung */
   reload: number;
   /** Streuung der Einzelschuesse einer broadside (s) */
   spread: number;
   /** gunrueckstoss (m) */
   recoil: number;
   /** heelsstoss (degrees) */
   rollKick: number;
   /** effective range (m), fuer die Anzeige */
   range: number;
}

export interface StructureSpec {
   /** strength der hull side */
   scantling: number;
   /** strength der Rundhoelzer */
   mastStrength: number;
   /** Reserveauftrieb - how long she keeps water out */
   reserve: number;
}

export interface CamSpec {
   dist: number;
   height: number;
   cockpitZ: number;
   cockpitY: number;
   lead: number;
   targetY: number;
}

export interface PaintScheme {
   copper: number[];
   boot: number[];
   band: number[];
   dark: number[];
   deck: number;
   [key: string]: number | number[];
}

export interface Vessel {
   id: string;
   name: string;
   prefix: string;
   klass: string;
   rate: string;
   rig: Rig;
   era: string;
   desc: string;
   crew: number;
   hull: HullSpec;
   sail: SailSpec;
   dyn: DynSpec;
   guns: GunSpec | null;
   structure: StructureSpec;
   cam: CamSpec;
   /** Nur bei opponentn gesetzt */
   nation?: string;
   paint?: PaintScheme;
}

export const POLAR_BERMUDA: Table = [
   [0, 0.0], [10, 0.0], [20, 0.6], [30, 2.5], [35, 4.8], [40, 6.2], [45, 7.2],
   [50, 8.0], [60, 9.4], [75, 10.4], [90, 10.8], [105, 11.2], [115, 11.0],
   [130, 10.2], [145, 8.8], [160, 6.9], [175, 5.2], [180, 4.4],
];

// square-rigger-Sloop (Ship-rigged Sloop-of-War, ~20 guns): small, handy,
// kann knapp 6 Strich (67.5 degrees) anliegen, laeuft am besten auf backstaysbrise.
export const POLAR_SLOOP_OF_WAR: Table = [
   [0, 0.0], [40, 0.0], [55, 0.5], [62, 1.9], [70, 3.9], [80, 5.2], [90, 6.4],
   [100, 7.3], [115, 8.3], [130, 8.9], [140, 9.1], [150, 8.9], [160, 8.3],
   [170, 7.7], [180, 7.3],
];

// 36-gun frigate: more sail area, more length, but also more mass.
// Spitzenlaeufer der Flotte - "the eyes of the fleet".
export const POLAR_FRIGATE: Table = [
   [0, 0.0], [45, 0.0], [58, 0.5], [66, 2.2], [72, 3.8], [80, 5.0], [90, 6.3],
   [100, 7.2], [115, 8.2], [130, 8.8], [140, 9.0], [150, 8.8], [160, 8.2],
   [170, 7.6], [180, 7.2],
];

// 38/44-gun frigate: Indefatigable (1784) — one of the fastest square-rigged
// ships of the Royal Navy. Famous under Admiral Sir Edward Pellew. Lighter
// als die Lydia auf allen courseen.
export const POLAR_INDEFATIGABLE: Table = [
   [0, 0.0], [45, 0.0], [58, 0.5], [66, 2.3], [72, 4.0], [80, 5.2], [90, 6.6],
   [100, 7.6], [115, 8.6], [130, 9.2], [140, 9.5], [150, 9.2], [160, 8.6],
   [170, 8.0], [180, 7.6],
];

// 74-gun ship of the line: heavy, sluggish, points poorly — but
// unerschuetterlich und mit doppelter battery.
export const POLAR_THIRD_RATE: Table = [
   [0, 0.0], [50, 0.0], [62, 0.4], [70, 1.7], [78, 3.1], [88, 4.2], [100, 5.3],
   [115, 6.3], [130, 7.0], [140, 7.2], [150, 7.1], [160, 6.7], [170, 6.2],
   [180, 5.9],
];

// ---------------------------------------------------------------------------
// Farbschemata
// ---------------------------------------------------------------------------
const NELSON: PaintScheme = {
   copper: [0.46, 0.26, 0.15], // Kupferbeschlag unter Wasser
   boot: [0.09, 0.09, 0.10],   // Barkholz / Wale
   band: [0.86, 0.70, 0.30],   // Ocker-Band auf Hoehe der Batterie
   dark: [0.10, 0.10, 0.12],   // hull side between the bands
   deck: 0xd8c9a4,
   trim: 0x8c6a2f,             // vergoldete Zierleisten / Heckgalerie
};

// ---------------------------------------------------------------------------
// ships
// ---------------------------------------------------------------------------
export const VESSELS: Vessel[] = [
   {
      id: "yacht",
      name: "Nordwind",
      prefix: "",
      klass: "Modern sailing yacht",
      rate: "Bermuda Sloop",
      rig: "bermuda",
      era: "today",
      desc: "Light, points high, turns on a dime. The reference boat.",
      crew: 4,
      hull: { loa: 11.0, beam: 3.3, draft: 1.55, displacement: 6 },
      sail: { noGo: 32, polar: POLAR_BERMUDA, tackAssist: 0 },
      dyn: {
         turnRate: 38,        // deg/s at full rudder and full rudder effect
         rudderRef: 4,        // speed (kn) at which the rudder fully bites
         accelUp: 0.45,       // Beschleunigung (1/s)
         accelDown: 1.1,      // Abbremsen
         accelLuff: 1.6,
         maxHeel: 22,
         capsizeHeel: 30,
         heelScale: 1.0,
         leewayMax: 7,
      },
      guns: null,
      // scantling = strength der hull side, mastStrength = spars,
      // reserve = reserve buoyancy (how long she keeps water out)
      structure: { scantling: 0.30, mastStrength: 0.45, reserve: 0.5 },
      cam: { dist: 15, height: 6.5, cockpitZ: -1.2, cockpitY: 2.4, lead: 8, targetY: 2.0 },
   },
   {
      id: "hotspur",
      name: "Hotspur",
      prefix: "HMS",
      klass: "Sloop-of-War",
      rate: "20-gun square-rigger",
      rig: "square",
      era: "1803",
      desc: "Smallest square-rigged ship with its own command — fast, nimble, thinly armed.",
      crew: 95,
      hull: { loa: 28.0, beam: 8.2, draft: 3.6, displacement: 420 },
      sail: { noGo: 62, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.55 },
      dyn: {
         turnRate: 13,
         rudderRef: 3.2,
         accelUp: 0.070,      // ~14 s time constant — a ship gets under way slowly
         accelDown: 0.125,
         accelLuff: 0.34,
         maxHeel: 15,
         capsizeHeel: 46,
         heelScale: 0.72,
         leewayMax: 11,
      },
      guns: {
         decks: [{ y: 0.60, count: 10, from: 0.20, to: 0.80, calibre: "9-pounder" }],
         reload: 60.0,         // seconds per side for a well-drilled crew
         spread: 0.28,         // Streuung der Einzelschuesse (s)
         recoil: 0.55,         // m gun recoil
         rollKick: 1.7,        // deg heeling kick
         range: 420,           // m effektive Reichweite (fuer die Anzeige)
      },
      structure: { scantling: 0.58, mastStrength: 0.70, reserve: 0.65 },
      cam: { dist: 58, height: 21, cockpitZ: -10.5, cockpitY: 7.0, lead: 12, targetY: 9 },
   },
   {
      id: "lydia",
      name: "Lydia",
      prefix: "HMS",
      klass: "Frigate 5th Rate",
      rate: "36-gun Frigate",
      rig: "square",
      era: "1808",
      desc: "The classic Hornblower: fast enough to run, strong enough to stay.",
      crew: 264,
      hull: { loa: 43.0, beam: 11.6, draft: 4.6, displacement: 950 },
      sail: { noGo: 65, polar: POLAR_FRIGATE, tackAssist: 0.5 },
      dyn: {
         turnRate: 9.5,
         rudderRef: 3.6,
         accelUp: 0.048,      // ~21 s: over two minutes to full speed
         accelDown: 0.088,
         accelLuff: 0.26,
         maxHeel: 14,
         capsizeHeel: 50,
         heelScale: 0.62,
         leewayMax: 10,
      },
      guns: {
         decks: [{ y: 0.58, count: 13, from: 0.16, to: 0.84, calibre: "18-pounder" }],
         reload: 60.0,
         spread: 0.34,
         recoil: 0.8,
         rollKick: 2.4,
         range: 550,
      },
      structure: { scantling: 1.00, mastStrength: 1.00, reserve: 1.00 },
      cam: { dist: 88, height: 31, cockpitZ: -16.5, cockpitY: 9.6, lead: 17, targetY: 13 },
   },
   {
      id: "indefatigable",
      name: "Indefatigable",
      prefix: "HMS",
      klass: "Frigate 4th Rate",
      rate: "38/44-gun Frigate",
      rig: "square",
      era: "1796",
      desc: "The Undaunted: famous under Admiral Pellew, one of the fastest Royal Navy sailing warships. Lighter than Lydia, faster on all points of sail.",
      crew: 315,
      hull: { loa: 44.5, beam: 11.8, draft: 4.8, displacement: 820 },
      sail: { noGo: 63, polar: POLAR_INDEFATIGABLE, tackAssist: 0.52 },
      dyn: {
         turnRate: 9.0,
         rudderRef: 3.5,
         accelUp: 0.055,      // ~18 s: somewhat livelier than the Lydia
         accelDown: 0.100,
         accelLuff: 0.28,
         maxHeel: 14,
         capsizeHeel: 50,
         heelScale: 0.64,
         leewayMax: 10,
      },
      guns: {
         decks: [
            { y: 0.52, count: 12, from: 0.16, to: 0.84, calibre: "18-pounder" },
            { y: 0.72, count: 10, from: 0.18, to: 0.82, calibre: "9-pounder" },
         ],
         reload: 65.0,
         spread: 0.32,
         recoil: 0.72,
         rollKick: 2.0,
         range: 520,
      },
      structure: { scantling: 0.82, mastStrength: 0.88, reserve: 0.82 },
      cam: { dist: 82, height: 29, cockpitZ: -15.5, cockpitY: 9.0, lead: 16, targetY: 12 },
   },
   {
      // Without id, getVessel("sutherland") silently fell back to the yacht
      // — the Sutherland was never playable through the ship menu.
      id: "sutherland",
      name: "Sutherland",
      prefix: "HMS",
      klass: "Ship of the Line 3rd Rate",
      rate: "74-gun Two-Decker",
      rig: "square",
      era: "1810",
      desc: "Floating battery: slow as a church, but two full gun decks.",
      crew: 590,
      hull: { loa: 52.0, beam: 14.6, draft: 6.2, displacement: 1750 },
      sail: { noGo: 68, polar: POLAR_THIRD_RATE, tackAssist: 0.42 },
      dyn: {
         turnRate: 6.4,
         rudderRef: 4.2,
         accelUp: 0.030,      // ~33 s: 1750 t need time to get going
         accelDown: 0.060,
         accelLuff: 0.20,
         maxHeel: 12,
         capsizeHeel: 55,
         heelScale: 0.52,
         leewayMax: 9,
      },
      guns: {
         decks: [
            { y: 0.44, count: 14, from: 0.14, to: 0.86, calibre: "32-pounder" },
            { y: 0.70, count: 14, from: 0.16, to: 0.84, calibre: "18-pounder" },
         ],
         reload: 75.0,
         spread: 0.45,
         recoil: 1.0,
         rollKick: 3.4,
         range: 600,
      },
      // A two-decker has ribs like a house: solid shot of the lighter
      // calibre simply bounces off at distance.
      structure: { scantling: 1.85, mastStrength: 1.55, reserve: 1.70 },
      cam: { dist: 106, height: 38, cockpitZ: -20.5, cockpitY: 11.8, lead: 21, targetY: 16 },
   },
];

// French paint scheme: red strake instead of ochre. Historically both existed;
// here it ensures you can tell friend from foe in the powder smoke at a glance.
const FRENCH: PaintScheme = {
   copper: [0.44, 0.25, 0.15],
   boot: [0.08, 0.08, 0.09],
   band: [0.62, 0.16, 0.14],
   dark: [0.12, 0.11, 0.13],
   deck: 0xd2c39c,
   trim: 0x9a7a3a,
};

// ---------------------------------------------------------------------------
// Opponents (not selectable in the ship menu, only as enemies in battle)
// ---------------------------------------------------------------------------
export const ENEMIES: Vessel[] = [
   {
      id: "hirondelle",
      name: "Hirondelle",
      prefix: "",
      nation: "FR",
      paint: FRENCH,
      klass: "Corvette",
      rate: "20-gun Corvette",
      rig: "square",
      era: "1805",
      desc: "Fast French corvette — hardly bites, but runs away.",
      crew: 110,
      hull: { loa: 29.0, beam: 8.4, draft: 3.7, displacement: 440 },
      sail: { noGo: 61, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.55 },
      dyn: { turnRate: 13.5, rudderRef: 3.2, accelUp: 0.075, accelDown: 0.13,
             accelLuff: 0.34, maxHeel: 15, capsizeHeel: 46, heelScale: 0.72, leewayMax: 11 },
      guns: {
         decks: [{ y: 0.60, count: 10, from: 0.20, to: 0.80, calibre: "8-pounder" }],
         reload: 80.0, spread: 0.32, recoil: 0.5, rollKick: 1.6, range: 400,
      },
      structure: { scantling: 0.54, mastStrength: 0.68, reserve: 0.62 },
      cam: { dist: 58, height: 21, cockpitZ: -10.5, cockpitY: 7.0, lead: 12, targetY: 9 },
   },
   {
      id: "amelie",
      name: "Amélie",
      prefix: "",
      nation: "FR",
      paint: FRENCH,
      klass: "Frigate",
      rate: "40-gun Frigate",
      rig: "square",
      era: "1806",
      desc: "French frigates were built larger and faster than the British ones.",
      crew: 320,
      hull: { loa: 46.0, beam: 12.0, draft: 4.8, displacement: 1100 },
      sail: { noGo: 64, polar: POLAR_FRIGATE, tackAssist: 0.5 },
      dyn: { turnRate: 9.2, rudderRef: 3.6, accelUp: 0.050, accelDown: 0.090,
             accelLuff: 0.26, maxHeel: 14, capsizeHeel: 50, heelScale: 0.62, leewayMax: 10 },
      guns: {
         decks: [{ y: 0.58, count: 14, from: 0.16, to: 0.84, calibre: "18-pounder" }],
         reload: 85.0, spread: 0.38, recoil: 0.8, rollKick: 2.4, range: 540,
      },
      structure: { scantling: 1.05, mastStrength: 1.00, reserve: 1.05 },
      cam: { dist: 88, height: 31, cockpitZ: -16.5, cockpitY: 9.6, lead: 17, targetY: 13 },
   },
   {
      id: "vengeur",
      name: "Vengeur",
      prefix: "",
      nation: "FR",
      paint: FRENCH,
      klass: "Ship of the Line 3rd Rate",
      rate: "74-gun Two-Decker",
      rig: "square",
      era: "1808",
      desc: "A French seventy-four. Whoever picks a fight with her needs backup.",
      crew: 640,
      hull: { loa: 53.0, beam: 14.8, draft: 6.3, displacement: 1800 },
      sail: { noGo: 68, polar: POLAR_THIRD_RATE, tackAssist: 0.42 },
      dyn: { turnRate: 6.2, rudderRef: 4.2, accelUp: 0.030, accelDown: 0.060,
             accelLuff: 0.20, maxHeel: 12, capsizeHeel: 55, heelScale: 0.52, leewayMax: 9 },
      guns: {
         decks: [
            { y: 0.44, count: 14, from: 0.14, to: 0.86, calibre: "36-pounder" },
            { y: 0.70, count: 14, from: 0.16, to: 0.84, calibre: "18-pounder" },
         ],
         reload: 100.0, spread: 0.48, recoil: 1.0, rollKick: 3.4, range: 600,
      },
      structure: { scantling: 1.90, mastStrength: 1.55, reserve: 1.75 },
      cam: { dist: 106, height: 38, cockpitZ: -20.5, cockpitY: 11.8, lead: 21, targetY: 16 },
   },
];

export const ALL_VESSELS: Vessel[] = VESSELS.concat(ENEMIES);
export const VESSEL_COLORS = NELSON;

export function getVessel(id: string): Vessel {
   return ALL_VESSELS.find((v) => v.id === id) || VESSELS[0];
}

export function vesselLabel(v: Vessel): string {
   return (v.prefix ? v.prefix + " " : "") + v.name;
}

// Total number of guns (both sides)
export function gunCount(v: Vessel): number {
   if (!v.guns) return 0;
   return v.guns.decks.reduce((n: number, d: GunDeck) => n + d.count, 0) * 2;
}

// Broadside weight in pounds (for display only)
const BALL_LB: Record<string, number> = { "8-pounder": 8, "9-pounder": 9, "18-pounder": 18, "32-pounder": 32, "36-pounder": 36 };
export function broadsideWeight(v: Vessel): number {
   if (!v.guns) return 0;
   return v.guns.decks.reduce((w: number, d: GunDeck) => w + d.count * (BALL_LB[d.calibre] || 12), 0);
}
