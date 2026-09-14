// factions.js - under which flag we sail.
//
// The choice of faction is not cosmetic: each navy had its own
// ships, its own build style and its own combat doctrine.
//
//   Royal Navy   - drilled crews, rapid fire, shot into the HULL.
//                  Goal: beat the enemy down and capture.
//   Marine Imp.  - large, fast-built ships, shot into the RIGGING.
//                  Goal: disable the enemy and escape.
//   Armada       - heavily built hulls that take a lot of punishment, but thinly
//                  and unevenly crewed: slow fire.
//   Pirates      - everything taken, thin-skinned and fast, huge crew
//                  for boarding, miserable gunnery training. They never
//                  strike the flag - nothing better awaits at the gallows.


/** Combat doctrine: where the crews aim. */
export type Doctrine = "hull" | "rig";

export interface Faction {
   id: string;
   name: string;
   country: string;
   era: string;
   flag: string;
   short: string;
   desc: string;
   doctrine: Doctrine;
   /** Crew training level (1 = reference) */
   gunnery: number;
   /** Pirates never strike the flag */
   neverStrikes: boolean;
   color: string;
   ships: string[];
}

export const FACTIONS: Faction[] = [
   {
      id: "gb",
      name: "Royal Navy",
      country: "Great Britain",
      era: "1800",
      flag: "white",
      short: "GB",
      desc: "Best gunnery training in the world. Fires into the hull to cripple and capture the enemy.",
      doctrine: "hull",
      gunnery: 1.12,          // crew training level
      neverStrikes: false,
      color: "#6fe1ff",
      ships: ["hotspur", "lydia", "sutherland"],
   },
   {
      id: "fr",
      name: "Marine Impériale",
      country: "France",
      era: "1805",
      flag: "tricolor",
      short: "FR",
      desc: "Large, fast ships. Fires into the rigging to disable and escape.",
      doctrine: "rig",
      gunnery: 0.88,
      neverStrikes: false,
      color: "#7f9dff",
      ships: ["hirondelle", "amelie", "vengeur"],
   },
   {
      id: "es",
      name: "Armada Española",
      country: "Spain",
      era: "1805",
      flag: "spain",
      short: "ES",
      desc: "Heavy-built hulls that can take a beating, but lightly and unevenly crewed — slow to fire.",
      doctrine: "hull",
      gunnery: 0.74,
      neverStrikes: false,
      color: "#ffce54",
      ships: ["descubierta", "gamo", "nepomuceno"],
   },
   {
      id: "pirate",
      name: "Piraten",
      country: "Caribbean",
      era: "1805",
      flag: "jolly",
      short: "☠",
      desc: "Everything captured: thin-hulled and fast, huge boarding parties, miserable gunnery crews. They never strike.",
      doctrine: "hull",
      gunnery: 0.62,
      neverStrikes: true,
      color: "#c9c9c9",
      ships: ["seeteufel", "rache", "schwarzekrone"],
   },
];

export function getFaction(id: string): Faction {
   return FACTIONS.find((f) => f.id === id) || FACTIONS[0];
}

// Who stands against the player? Pirates are hostile to all, the
// navies among each other by historical enmity.
const RIVALS: Record<string, string[]> = {
   gb: ["fr", "es", "pirate"],
   fr: ["gb", "es", "pirate"],
   es: ["gb", "pirate", "fr"],
   pirate: ["gb", "es", "fr"],
};

export function enemyFactionFor(id: string, pick = 0): Faction {
   const list = RIVALS[id] || RIVALS.gb;
   return getFaction(list[pick % list.length]);
}
