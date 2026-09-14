// factions.js - under which flag the sailing is done.
//
// The choice of faction is not cosmetic: every navy had its own ships, its
// own construction style and its own combat doctrine.
//
//   Royal Navy    - drilled crews, fast fire, shoots at the HULL.
//                   Goal: beat down and capture the enemy.
//   Marine Imp.   - large, fast-built ships, shoots at the RIGGING.
//                   Goal: cripple the enemy's manoeuvrability and escape.
//   Armada        - heavily built hulls that can take a beating, but thinly
//                   and unevenly crewed: slow fire.
//   Pirates       - everything captured, thin-hulled and fast, huge crews
//                   for boarding, miserable gunnery training. They never
//                   strike their colours - nothing better waits at the gallows.


/** Combat doctrine: what the gun crews are aimed at. */
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
   /** Training level of the gun crews (1 = reference) */
   gunnery: number;
   /** Pirates never strike their colours */
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
      gunnery: 1.12,          // training level of the gun crews
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
      name: "Pirates",
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

// Who faces the player? Pirates are at war with everyone; the navies are
// rivals among themselves according to historical enmities.
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
