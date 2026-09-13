// vessels.js - Schiffskatalog: moderne Yacht + drei Royal-Navy-Rahsegler
// (Hornblower-Aera, ca. 1800). Jeder Eintrag beschreibt Rumpfmasse, Rigg,
// Polarkurve, Manoevrierverhalten und - bei den Kriegsschiffen - die Batterie.
//
// Konventionen wie im Rest des Projekts: Winkel in Grad, Speed in Knoten,
// Laengen in Metern, Welt X=Ost / Z=Nord / Y=hoch, Bug = +Z.

// ---------------------------------------------------------------------------
// Polarkurven bei 15 kn wahrem Wind (TWA in Grad -> Speed in Knoten)
// ---------------------------------------------------------------------------

// Bermuda-Sloop (moderne Yacht) - kreuzt hoch, schnellster Kurs am Beam.
export const POLAR_BERMUDA = [
   [0, 0.0], [10, 0.0], [20, 0.6], [30, 2.5], [35, 4.8], [40, 6.2], [45, 7.2],
   [50, 8.0], [60, 9.4], [75, 10.4], [90, 10.8], [105, 11.2], [115, 11.0],
   [130, 10.2], [145, 8.8], [160, 6.9], [175, 5.2], [180, 4.4],
];

// Rahsegler-Sloop (Ship-rigged Sloop-of-War, ~20 Kanonen): klein, handig,
// kann knapp 6 Strich (67.5 Grad) anliegen, laeuft am besten auf Backstagsbrise.
export const POLAR_SLOOP_OF_WAR = [
   [0, 0.0], [40, 0.0], [55, 0.5], [62, 1.9], [70, 3.9], [80, 5.2], [90, 6.4],
   [100, 7.3], [115, 8.3], [130, 8.9], [140, 9.1], [150, 8.9], [160, 8.3],
   [170, 7.7], [180, 7.3],
];

// 36-Kanonen-Fregatte: mehr Segelflaeche, mehr Laenge, aber auch mehr Masse.
// Spitzenlaeufer der Flotte - "the eyes of the fleet".
export const POLAR_FRIGATE = [
   [0, 0.0], [45, 0.0], [58, 0.5], [66, 2.2], [72, 3.8], [80, 5.0], [90, 6.3],
   [100, 7.2], [115, 8.2], [130, 8.8], [140, 9.0], [150, 8.8], [160, 8.2],
   [170, 7.6], [180, 7.2],
];

// 38/44-Kanonen-Fregatte: die Indefatigable (1784), unter Pellew eines der
// schnellsten Rahsegel-Kriegsschiffe der Royal Navy. Auf allen Kursen rund
// fuenf Prozent schneller als die Lydia.
export const POLAR_INDEFATIGABLE = [
   [0, 0.0], [45, 0.0], [58, 0.5], [66, 2.3], [72, 4.0], [80, 5.2], [90, 6.6],
   [100, 7.6], [115, 8.6], [130, 9.2], [140, 9.5], [150, 9.2], [160, 8.6],
   [170, 8.0], [180, 7.6],
];

// 74-Kanonen-Linienschiff: schwer, traege, kreuzt schlecht - dafuer
// unerschuetterlich und mit doppelter Batterie.
export const POLAR_THIRD_RATE = [
   [0, 0.0], [50, 0.0], [62, 0.4], [70, 1.7], [78, 3.1], [88, 4.2], [100, 5.3],
   [115, 6.3], [130, 7.0], [140, 7.2], [150, 7.1], [160, 6.7], [170, 6.2],
   [180, 5.9],
];

// ---------------------------------------------------------------------------
// Farbschemata
// ---------------------------------------------------------------------------
const NELSON = {
   copper: [0.46, 0.26, 0.15], // Kupferbeschlag unter Wasser
   boot: [0.09, 0.09, 0.10],   // Barkholz / Wale
   band: [0.86, 0.70, 0.30],   // Ocker-Band auf Hoehe der Batterie
   dark: [0.10, 0.10, 0.12],   // Bordwand zwischen den Baendern
   deck: 0xd8c9a4,
   trim: 0x8c6a2f,             // vergoldete Zierleisten / Heckgalerie
};

// ---------------------------------------------------------------------------
// Schiffe
// ---------------------------------------------------------------------------
export const VESSELS = [
   {
      id: "yacht",
      faction: null,
      tier: 0,
      name: "Nordwind",
      prefix: "",
      klass: "Moderne Segelyacht",
      rate: "Bermuda-Sloop",
      rig: "bermuda",
      era: "heute",
      desc: "Leicht, kreuzt hoch am Wind, dreht auf dem Teller. Das Referenzboot.",
      crew: 4,
      hull: { loa: 11.0, beam: 3.3, draft: 1.55, displacement: 6 },
      sail: { noGo: 32, polar: POLAR_BERMUDA, tackAssist: 0 },
      dyn: {
         turnRate: 38,        // Grad/s bei vollem Ruder und voller Ruderwirkung
         rudderRef: 4,        // Fahrt (kn), ab der das Ruder voll greift
         accelUp: 0.45,       // Beschleunigung (1/s)
         accelDown: 1.1,      // Abbremsen
         accelLuff: 1.6,
         maxHeel: 22,
         capsizeHeel: 30,
         heelScale: 1.0,
         leewayMax: 7,
      },
      guns: null,
      // scantling = Staerke der Bordwand, mastStrength = Rundhoelzer,
      // reserve = Reserveauftrieb (wie lange sie Wasser wegsteckt)
      structure: { scantling: 0.30, mastStrength: 0.45, reserve: 0.5 },
      cam: { dist: 15, height: 6.5, cockpitZ: -1.2, cockpitY: 2.4, lead: 8, targetY: 2.0 },
   },
   {
      id: "hotspur",
      faction: "gb",
      paint: NELSON,
      tier: 1,
      name: "Hotspur",
      prefix: "HMS",
      klass: "Sloop-of-War",
      rate: "20-Kanonen-Rahsegler",
      rig: "square",
      era: "1803",
      desc: "Kleinster Rahsegler mit eigenem Kommando — flink, wendig, dünnhäutig.",
      crew: 95,
      hull: { loa: 28.0, beam: 8.2, draft: 3.6, displacement: 420 },
      sail: { noGo: 62, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.55 },
      dyn: {
         turnRate: 13,
         rudderRef: 3.2,
         accelUp: 0.070,      // ~14 s Zeitkonstante - ein Schiff laeuft langsam an
         accelDown: 0.125,
         accelLuff: 0.34,
         maxHeel: 15,
         capsizeHeel: 46,
         heelScale: 0.72,
         leewayMax: 11,
      },
      guns: {
         decks: [{ y: 0.60, count: 10, from: 0.20, to: 0.80, calibre: "9-Pfünder" }],
         reload: 9.0,          // Sekunden fuer eine gut gedrillte Bedienung
         spread: 0.28,         // Streuung der Einzelschuesse (s)
         recoil: 0.55,         // m Rohrrueckstoss
         rollKick: 1.7,        // Grad Krengungsstoss
         range: 420,           // m effektive Reichweite (fuer die Anzeige)
      },
      structure: { scantling: 0.58, mastStrength: 0.70, reserve: 0.65 },
      cam: { dist: 58, height: 21, cockpitZ: -10.5, cockpitY: 7.0, lead: 12, targetY: 9 },
   },
   {
      id: "lydia",
      faction: "gb",
      paint: NELSON,
      tier: 2,
      name: "Lydia",
      prefix: "HMS",
      klass: "Fregatte 5. Ranges",
      rate: "36-Kanonen-Fregatte",
      rig: "square",
      era: "1808",
      desc: "Der klassische Hornblower: schnell genug zum Weglaufen, stark genug zum Bleiben.",
      crew: 264,
      hull: { loa: 43.0, beam: 11.6, draft: 4.6, displacement: 950 },
      sail: { noGo: 65, polar: POLAR_FRIGATE, tackAssist: 0.5 },
      dyn: {
         turnRate: 9.5,
         rudderRef: 3.6,
         accelUp: 0.048,      // ~21 s: gut zwei Minuten bis zur vollen Fahrt
         accelDown: 0.088,
         accelLuff: 0.26,
         maxHeel: 14,
         capsizeHeel: 50,
         heelScale: 0.62,
         leewayMax: 10,
      },
      guns: {
         decks: [{ y: 0.58, count: 13, from: 0.16, to: 0.84, calibre: "18-Pfünder" }],
         reload: 10.5,
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
      // Fahrbar, aber nicht in der Gegnerliste: jede Partei stellt genau ein
      // Schiff je Groessenklasse, und die Lydia ist der britische Zweier.
      // Ein zweiter waere fuer shipOfTier() nicht mehr eindeutig.
      faction: null,
      paint: NELSON,
      tier: 2,
      name: "Indefatigable",
      prefix: "HMS",
      klass: "Fregatte 4. Ranges",
      rate: "38/44-Kanonen-Fregatte",
      rig: "square",
      era: "1796",
      desc: "Die Unermuedliche: beruehmt unter Admiral Pellew, eines der schnellsten Rahsegel-Kriegsschiffe. Leichter als die Lydia und auf jedem Kurs schneller.",
      crew: 315,
      hull: { loa: 44.5, beam: 11.8, draft: 4.8, displacement: 820 },
      sail: { noGo: 63, polar: POLAR_INDEFATIGABLE, tackAssist: 0.52 },
      dyn: {
         turnRate: 9.0,
         rudderRef: 3.5,
         accelUp: 0.055,      // ~18 s: etwas lebhafter als die Lydia
         accelDown: 0.100,
         accelLuff: 0.28,
         maxHeel: 14,
         capsizeHeel: 50,
         heelScale: 0.64,
         leewayMax: 10,
      },
      guns: {
         decks: [
            { y: 0.52, count: 12, from: 0.16, to: 0.84, calibre: "18-Pfünder" },
            { y: 0.72, count: 10, from: 0.18, to: 0.82, calibre: "9-Pfünder" },
         ],
         reload: 11.0,
         spread: 0.32,
         recoil: 0.72,
         rollKick: 2.0,
         range: 520,
      },
      structure: { scantling: 0.82, mastStrength: 0.88, reserve: 0.82 },
      cam: { dist: 82, height: 29, cockpitZ: -15.5, cockpitY: 9.0, lead: 16, targetY: 12 },
   },
   {
      id: "sutherland",
      faction: "gb",
      paint: NELSON,
      tier: 3,
      name: "Sutherland",
      prefix: "HMS",
      klass: "Linienschiff 3. Ranges",
      rate: "74-Kanonen-Zweidecker",
      rig: "square",
      era: "1810",
      desc: "Schwimmende Batterie: träge wie eine Kirche, aber zwei volle Decks Eisen.",
      crew: 590,
      hull: { loa: 52.0, beam: 14.6, draft: 6.2, displacement: 1750 },
      sail: { noGo: 68, polar: POLAR_THIRD_RATE, tackAssist: 0.42 },
      dyn: {
         turnRate: 6.4,
         rudderRef: 4.2,
         accelUp: 0.030,      // ~33 s: 1750 t wollen erst einmal in Gang kommen
         accelDown: 0.060,
         accelLuff: 0.20,
         maxHeel: 12,
         capsizeHeel: 55,
         heelScale: 0.52,
         leewayMax: 9,
      },
      guns: {
         decks: [
            { y: 0.44, count: 14, from: 0.14, to: 0.86, calibre: "32-Pfünder" },
            { y: 0.70, count: 14, from: 0.16, to: 0.84, calibre: "18-Pfünder" },
         ],
         reload: 13.0,
         spread: 0.45,
         recoil: 1.0,
         rollKick: 3.4,
         range: 600,
      },
      // Ein Zweidecker hat Spanten wie ein Haus: Vollkugeln der leichteren
      // Kaliber prallen auf Distanz schlicht ab.
      structure: { scantling: 1.85, mastStrength: 1.55, reserve: 1.70 },
      cam: { dist: 106, height: 38, cockpitZ: -20.5, cockpitY: 11.8, lead: 21, targetY: 16 },
   },
];

// Franzoesisches Anstrichschema: roter Streifen statt Ocker. Historisch gab es
// beides; hier sorgt es dafuer, dass man Freund und Feind im Pulverdampf auf
// einen Blick auseinanderhaelt.
const FRENCH = {
   copper: [0.44, 0.25, 0.15],
   boot: [0.08, 0.08, 0.09],
   band: [0.62, 0.16, 0.14],
   dark: [0.12, 0.11, 0.13],
   deck: 0xd2c39c,
   trim: 0x9a7a3a,
};

// Spanisch: dunkelrote Bordwand mit gelbem Strake - die Schiffe der Armada
// waren beruehmt fuer ihre schweren Spanten.
const SPANISH = {
   copper: [0.45, 0.26, 0.15],
   boot: [0.10, 0.08, 0.08],
   band: [0.84, 0.68, 0.22],
   dark: [0.29, 0.10, 0.10],
   deck: 0xd4c49e,
   trim: 0x9c7c34,
};

// Piraten: alles erbeutet, nichts gepflegt - verwittertes Schwarz mit einem
// Rest von dem, was der Vorbesitzer aufgemalt hatte.
const PIRATE = {
   copper: [0.36, 0.25, 0.18],
   boot: [0.07, 0.07, 0.07],
   band: [0.43, 0.36, 0.26],
   dark: [0.11, 0.11, 0.10],
   deck: 0xb9ab8c,
   trim: 0x6d5b32,
};

// ---------------------------------------------------------------------------
// Gegner (nicht im Schiffsmenue waehlbar, nur als Feind im Gefecht)
// ---------------------------------------------------------------------------
export const ENEMIES = [
   {
      id: "hirondelle",
      faction: "fr",
      tier: 1,
      name: "Hirondelle",
      prefix: "",
      paint: FRENCH,
      klass: "Corvette",
      rate: "20-Kanonen-Korvette",
      rig: "square",
      era: "1805",
      desc: "Schnelle franzoesische Korvette - beisst kaum, laeuft aber davon.",
      crew: 110,
      hull: { loa: 29.0, beam: 8.4, draft: 3.7, displacement: 440 },
      sail: { noGo: 61, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.55 },
      dyn: { turnRate: 13.5, rudderRef: 3.2, accelUp: 0.075, accelDown: 0.13,
             accelLuff: 0.34, maxHeel: 15, capsizeHeel: 46, heelScale: 0.72, leewayMax: 11 },
      guns: {
         decks: [{ y: 0.60, count: 10, from: 0.20, to: 0.80, calibre: "8-Pfünder" }],
         reload: 11.5, spread: 0.32, recoil: 0.5, rollKick: 1.6, range: 400,
      },
      structure: { scantling: 0.54, mastStrength: 0.68, reserve: 0.62 },
      cam: { dist: 58, height: 21, cockpitZ: -10.5, cockpitY: 7.0, lead: 12, targetY: 9 },
   },
   {
      id: "amelie",
      faction: "fr",
      tier: 2,
      name: "Amélie",
      prefix: "",
      paint: FRENCH,
      klass: "Fregatte",
      rate: "40-Kanonen-Fregatte",
      rig: "square",
      era: "1806",
      desc: "Franzoesische Fregatten waren groesser und schneller gebaut als die britischen.",
      crew: 320,
      hull: { loa: 46.0, beam: 12.0, draft: 4.8, displacement: 1100 },
      sail: { noGo: 64, polar: POLAR_FRIGATE, tackAssist: 0.5 },
      dyn: { turnRate: 9.2, rudderRef: 3.6, accelUp: 0.050, accelDown: 0.090,
             accelLuff: 0.26, maxHeel: 14, capsizeHeel: 50, heelScale: 0.62, leewayMax: 10 },
      guns: {
         decks: [{ y: 0.58, count: 14, from: 0.16, to: 0.84, calibre: "18-Pfünder" }],
         reload: 12.5, spread: 0.38, recoil: 0.8, rollKick: 2.4, range: 540,
      },
      structure: { scantling: 1.05, mastStrength: 1.00, reserve: 1.05 },
      cam: { dist: 88, height: 31, cockpitZ: -16.5, cockpitY: 9.6, lead: 17, targetY: 13 },
   },
   {
      id: "vengeur",
      faction: "fr",
      tier: 3,
      name: "Vengeur",
      prefix: "",
      paint: FRENCH,
      klass: "Linienschiff 3. Ranges",
      rate: "74-Kanonen-Zweidecker",
      rig: "square",
      era: "1808",
      desc: "Ein franzoesischer Vierundsiebziger. Wer den anfaellt, braucht Rueckendeckung.",
      crew: 640,
      hull: { loa: 53.0, beam: 14.8, draft: 6.3, displacement: 1800 },
      sail: { noGo: 68, polar: POLAR_THIRD_RATE, tackAssist: 0.42 },
      dyn: { turnRate: 6.2, rudderRef: 4.2, accelUp: 0.030, accelDown: 0.060,
             accelLuff: 0.20, maxHeel: 12, capsizeHeel: 55, heelScale: 0.52, leewayMax: 9 },
      guns: {
         decks: [
            { y: 0.44, count: 14, from: 0.14, to: 0.86, calibre: "36-Pfünder" },
            { y: 0.70, count: 14, from: 0.16, to: 0.84, calibre: "18-Pfünder" },
         ],
         reload: 14.5, spread: 0.48, recoil: 1.0, rollKick: 3.4, range: 600,
      },
      structure: { scantling: 1.90, mastStrength: 1.55, reserve: 1.75 },
      cam: { dist: 106, height: 38, cockpitZ: -20.5, cockpitY: 11.8, lead: 21, targetY: 16 },
   },
];

// ---------------------------------------------------------------------------
// Armada Española - schwer gebaut, langsam im Feuer, knapp besetzt
// ---------------------------------------------------------------------------
export const SPANISH_SHIPS = [
   {
      id: "descubierta",
      faction: "es",
      tier: 1,
      name: "Descubierta",
      prefix: "",
      paint: SPANISH,
      klass: "Corbeta",
      rate: "20-Kanonen-Korvette",
      rig: "square",
      era: "1804",
      desc: "Leichte Korvette der Armada — gebaut für Depeschen und Küstenwache.",
      crew: 98,
      hull: { loa: 28.5, beam: 8.6, draft: 3.8, displacement: 450 },
      sail: { noGo: 63, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.52 },
      dyn: { turnRate: 12.2, rudderRef: 3.3, accelUp: 0.064, accelDown: 0.118,
             accelLuff: 0.32, maxHeel: 15, capsizeHeel: 47, heelScale: 0.70, leewayMax: 11 },
      guns: {
         decks: [{ y: 0.60, count: 10, from: 0.20, to: 0.80, calibre: "8-Pfünder" }],
         reload: 13.5, spread: 0.34, recoil: 0.5, rollKick: 1.6, range: 400,
      },
      structure: { scantling: 0.66, mastStrength: 0.72, reserve: 0.70 },
      cam: { dist: 58, height: 21, cockpitZ: -10.5, cockpitY: 7.0, lead: 12, targetY: 9 },
   },
   {
      id: "gamo",
      faction: "es",
      tier: 2,
      name: "El Gamo",
      prefix: "",
      paint: SPANISH,
      klass: "Fragata",
      rate: "32-Kanonen-Fregatte",
      rig: "square",
      era: "1801",
      desc: "Die Fregatte, die Cochrane mit einer winzigen Brigg nahm — schwer, aber unterbesetzt.",
      crew: 319,
      hull: { loa: 41.0, beam: 11.4, draft: 4.5, displacement: 950 },
      sail: { noGo: 66, polar: POLAR_FRIGATE, tackAssist: 0.46 },
      dyn: { turnRate: 8.8, rudderRef: 3.7, accelUp: 0.044, accelDown: 0.082,
             accelLuff: 0.24, maxHeel: 13, capsizeHeel: 51, heelScale: 0.60, leewayMax: 10 },
      guns: {
         decks: [{ y: 0.58, count: 12, from: 0.16, to: 0.84, calibre: "12-Pfünder" }],
         reload: 15.0, spread: 0.42, recoil: 0.7, rollKick: 2.1, range: 500,
      },
      structure: { scantling: 1.18, mastStrength: 1.02, reserve: 1.10 },
      cam: { dist: 86, height: 30, cockpitZ: -16, cockpitY: 9.4, lead: 17, targetY: 13 },
   },
   {
      id: "nepomuceno",
      faction: "es",
      tier: 3,
      name: "San Juan Nepomuceno",
      prefix: "",
      paint: SPANISH,
      klass: "Navío de línea",
      rate: "74-Kanonen-Zweidecker",
      rig: "square",
      era: "1805",
      desc: "Spanische Spanten wie Kathedralenpfeiler. Nimmt mehr Eisen auf als jeder andere Vierundsiebziger.",
      crew: 530,
      hull: { loa: 52.5, beam: 14.5, draft: 6.3, displacement: 1800 },
      sail: { noGo: 69, polar: POLAR_THIRD_RATE, tackAssist: 0.40 },
      dyn: { turnRate: 5.9, rudderRef: 4.3, accelUp: 0.027, accelDown: 0.056,
             accelLuff: 0.19, maxHeel: 12, capsizeHeel: 56, heelScale: 0.50, leewayMax: 9 },
      guns: {
         decks: [
            { y: 0.44, count: 14, from: 0.14, to: 0.86, calibre: "24-Pfünder" },
            { y: 0.70, count: 14, from: 0.16, to: 0.84, calibre: "18-Pfünder" },
         ],
         reload: 16.5, spread: 0.52, recoil: 0.95, rollKick: 3.2, range: 580,
      },
      structure: { scantling: 2.20, mastStrength: 1.60, reserve: 1.90 },
      cam: { dist: 106, height: 38, cockpitZ: -20.5, cockpitY: 11.8, lead: 21, targetY: 16 },
   },
];

// ---------------------------------------------------------------------------
// Piraten - erbeutet, dünnhäutig, schnell, voller Enterleute
// ---------------------------------------------------------------------------
export const PIRATE_SHIPS = [
   {
      id: "seeteufel",
      faction: "pirate",
      tier: 1,
      name: "Seeteufel",
      prefix: "",
      paint: PIRATE,
      klass: "Kaperschiff",
      rate: "16-Kanonen-Kaperfahrer",
      rig: "square",
      era: "—",
      desc: "Aufgeschossener Schnellsegler. Läuft jedem davon und ist beim ersten Treffer Kleinholz.",
      crew: 125,
      hull: { loa: 26.0, beam: 7.4, draft: 3.2, displacement: 330 },
      sail: { noGo: 59, polar: POLAR_SLOOP_OF_WAR, tackAssist: 0.62 },
      dyn: { turnRate: 15.5, rudderRef: 2.9, accelUp: 0.095, accelDown: 0.150,
             accelLuff: 0.38, maxHeel: 17, capsizeHeel: 43, heelScale: 0.82, leewayMax: 12 },
      guns: {
         decks: [{ y: 0.60, count: 8, from: 0.22, to: 0.78, calibre: "6-Pfünder" }],
         reload: 14.0, spread: 0.40, recoil: 0.4, rollKick: 1.3, range: 340,
      },
      structure: { scantling: 0.40, mastStrength: 0.60, reserve: 0.48 },
      cam: { dist: 54, height: 19, cockpitZ: -9.5, cockpitY: 6.6, lead: 11, targetY: 8 },
   },
   {
      id: "rache",
      faction: "pirate",
      tier: 2,
      name: "Rache",
      prefix: "",
      paint: PIRATE,
      klass: "genommene Fregatte",
      rate: "28-Kanonen-Fregatte",
      rig: "square",
      era: "—",
      desc: "Vor zwei Jahren einer Marine abgenommen. Seitdem nichts repariert, alles überladen.",
      crew: 230,
      hull: { loa: 38.0, beam: 10.4, draft: 4.2, displacement: 760 },
      sail: { noGo: 63, polar: POLAR_FRIGATE, tackAssist: 0.54 },
      dyn: { turnRate: 10.4, rudderRef: 3.4, accelUp: 0.058, accelDown: 0.098,
             accelLuff: 0.28, maxHeel: 15, capsizeHeel: 48, heelScale: 0.68, leewayMax: 11 },
      guns: {
         decks: [{ y: 0.58, count: 11, from: 0.16, to: 0.84, calibre: "9-Pfünder" }],
         reload: 13.0, spread: 0.44, recoil: 0.6, rollKick: 1.9, range: 430,
      },
      structure: { scantling: 0.72, mastStrength: 0.80, reserve: 0.72 },
      cam: { dist: 78, height: 27, cockpitZ: -14.5, cockpitY: 8.8, lead: 15, targetY: 12 },
   },
   {
      id: "schwarzekrone",
      faction: "pirate",
      tier: 3,
      name: "Schwarze Krone",
      prefix: "",
      paint: PIRATE,
      klass: "umgebauter Ostindienfahrer",
      rate: "44-Kanonen-Ostindienfahrer",
      rig: "square",
      era: "—",
      desc: "Ein Handelsriese, in den man zwei Decks Beutegeschütze gestellt hat. Viel Eisen, dünne Haut.",
      crew: 340,
      hull: { loa: 48.0, beam: 13.6, draft: 5.6, displacement: 1400 },
      sail: { noGo: 70, polar: POLAR_THIRD_RATE, tackAssist: 0.40 },
      dyn: { turnRate: 6.8, rudderRef: 4.0, accelUp: 0.034, accelDown: 0.066,
             accelLuff: 0.21, maxHeel: 14, capsizeHeel: 50, heelScale: 0.58, leewayMax: 10 },
      guns: {
         decks: [
            { y: 0.46, count: 11, from: 0.16, to: 0.84, calibre: "18-Pfünder" },
            { y: 0.72, count: 11, from: 0.18, to: 0.82, calibre: "9-Pfünder" },
         ],
         reload: 15.5, spread: 0.50, recoil: 0.8, rollKick: 2.6, range: 480,
      },
      structure: { scantling: 0.95, mastStrength: 1.05, reserve: 1.00 },
      cam: { dist: 98, height: 35, cockpitZ: -18.5, cockpitY: 10.8, lead: 19, targetY: 15 },
   },
];

export const ALL_VESSELS = VESSELS.concat(ENEMIES, SPANISH_SHIPS, PIRATE_SHIPS);

// Alle Kriegsschiffe einer Partei, nach Groesse sortiert
export function shipsOfFaction(factionId) {
   return ALL_VESSELS.filter((v) => v.faction === factionId).sort((a, b) => a.tier - b.tier);
}
// Das Schiff einer Partei in einer bestimmten Groessenklasse
export function shipOfTier(factionId, tier) {
   const list = shipsOfFaction(factionId);
   if (!list.length) return null;
   const t = Math.max(1, Math.min(3, tier));
   return list.find((v) => v.tier === t) || list[list.length - 1];
}
export const VESSEL_COLORS = NELSON;

export function getVessel(id) {
   return ALL_VESSELS.find((v) => v.id === id) || VESSELS[0];
}

export function vesselLabel(v) {
   return (v.prefix ? v.prefix + " " : "") + v.name;
}

// Gesamtzahl der Rohre (beide Seiten)
export function gunCount(v) {
   if (!v.guns) return 0;
   return v.guns.decks.reduce((n, d) => n + d.count, 0) * 2;
}

// Broadside-Gewicht in englischen Pfund (nur zur Anzeige)
const BALL_LB = { "6-Pfünder": 6, "8-Pfünder": 8, "9-Pfünder": 9, "12-Pfünder": 12,
   "18-Pfünder": 18, "24-Pfünder": 24, "32-Pfünder": 32, "36-Pfünder": 36 };
export function broadsideWeight(v) {
   if (!v.guns) return 0;
   return v.guns.decks.reduce((w, d) => w + d.count * (BALL_LB[d.calibre] || 12), 0);
}

export default { VESSELS, ENEMIES, SPANISH_SHIPS, PIRATE_SHIPS, ALL_VESSELS,
   getVessel, vesselLabel, gunCount, broadsideWeight, shipsOfFaction, shipOfTier };
