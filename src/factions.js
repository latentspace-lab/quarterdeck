// factions.js - unter welcher Flagge gesegelt wird.
//
// Die Wahl der Partei ist keine Kosmetik: jede Marine hatte ihre eigenen
// Schiffe, ihre eigene Bauart und ihre eigene Gefechtsdoktrin.
//
//   Royal Navy   - gedrillte Bedienungen, schnelles Feuer, Schuss in den RUMPF.
//                  Ziel: den Gegner niederkaempfen und aufbringen.
//   Marine Imp.  - grosse, schnell gebaute Schiffe, Schuss in die TAKELAGE.
//                  Ziel: den Gegner manoevrierunfaehig machen und entkommen.
//   Armada       - schwer gebaute Rümpfe, die viel wegstecken, aber knapp und
//                  ungleichmaessig besetzt: langsames Feuer.
//   Piraten      - alles erbeutet, duennhaeutig und schnell, riesige Besatzung
//                  fuers Entern, miserable Geschuetzausbildung. Sie streichen
//                  nie die Flagge - am Galgen wartet nichts Besseres.

export const FACTIONS = [
   {
      id: "gb",
      name: "Royal Navy",
      country: "Großbritannien",
      era: "1800",
      flag: "white",
      short: "GB",
      desc: "Beste Geschützausbildung der Welt. Schießt in den Rumpf und nimmt den Gegner.",
      doctrine: "hull",
      gunnery: 1.12,          // Ausbildungsstand der Bedienungen
      neverStrikes: false,
      color: "#6fe1ff",
      ships: ["hotspur", "lydia", "sutherland"],
   },
   {
      id: "fr",
      name: "Marine Impériale",
      country: "Frankreich",
      era: "1805",
      flag: "tricolor",
      short: "FR",
      desc: "Große, schnelle Schiffe. Schießt in die Takelage, um sich abzusetzen.",
      doctrine: "rig",
      gunnery: 0.88,
      neverStrikes: false,
      color: "#7f9dff",
      ships: ["hirondelle", "amelie", "vengeur"],
   },
   {
      id: "es",
      name: "Armada Española",
      country: "Spanien",
      era: "1805",
      flag: "spain",
      short: "ES",
      desc: "Schwer gebaute Rümpfe, die viel wegstecken — aber knapp besetzt und langsam im Feuer.",
      doctrine: "hull",
      gunnery: 0.74,
      neverStrikes: false,
      color: "#ffce54",
      ships: ["descubierta", "gamo", "nepomuceno"],
   },
   {
      id: "pirate",
      name: "Piraten",
      country: "Karibik",
      era: "1805",
      flag: "jolly",
      short: "☠",
      desc: "Alles erbeutet: dünnhäutig, schnell, riesige Enterbesatzung, miserable Kanoniere. Streichen nie.",
      doctrine: "hull",
      gunnery: 0.62,
      neverStrikes: true,
      color: "#c9c9c9",
      ships: ["seeteufel", "rache", "schwarzekrone"],
   },
];

export function getFaction(id) {
   return FACTIONS.find((f) => f.id === id) || FACTIONS[0];
}

// Wer steht dem Spieler gegenueber? Piraten sind mit allen verfeindet, die
// Marinen untereinander nach historischer Gegnerschaft.
const RIVALS = {
   gb: ["fr", "es", "pirate"],
   fr: ["gb", "es", "pirate"],
   es: ["gb", "pirate", "fr"],
   pirate: ["gb", "es", "fr"],
};

export function enemyFactionFor(id, pick = 0) {
   const list = RIVALS[id] || RIVALS.gb;
   return getFaction(list[pick % list.length]);
}

export default { FACTIONS, getFaction, enemyFactionFor };
