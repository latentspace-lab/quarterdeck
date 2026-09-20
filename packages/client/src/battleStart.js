// battleStart.js - How a single-player battle begins: the wind and where the
// enemy stands. Pure functions over an injected random source so that a
// battle can be replayed from its seed and tested without a scene.
import { dirVec, normDeg } from "./utils.js";

/** Random battle wind, knots. */
export const WIND_KTS = [10, 24];
/** Random spawn distance from the player, metres. */
export const SPAWN_M = [140, 280];
/** Classic start: the enemy this far dead upwind. */
export const UPWIND_M = 180;
/** Spacing between enemies abreast, metres. */
export const STAGGER_M = 84;

/** A fresh wind for the battle: any direction in the menu's 5° steps, a working breeze. */
export function battleWind(rng) {
   const dir = Math.floor(rng() * 72) * 5;
   const speed = WIND_KTS[0] + Math.floor(rng() * (WIND_KTS[1] - WIND_KTS[0] + 1));
   return { dir, speed };
}

/**
 * Where the enemy ships start and how they are led.
 *
 * random = false is the classic opening: a line abreast 180 m dead upwind.
 * random = true puts the line on a random bearing 140 to 280 m out, with a
 * little variation in the spacing, so the tactical situation differs every
 * battle. Either way the enemies point at the player.
 */
export function battleSpawns({ enemies, player, windDir, random, rng }) {
   const n = enemies.length;
   const centre = random ? rng() * 360 : windDir;
   const dist = random ? SPAWN_M[0] + rng() * (SPAWN_M[1] - SPAWN_M[0]) : UPWIND_M;
   const out = dirVec(centre);
   const across = dirVec(centre + 90);
   return enemies.map((id, i) => {
      const stagger = random ? STAGGER_M * (0.9 + rng() * 0.3) : STAGGER_M;
      const spread = (i - (n - 1) / 2) * stagger;
      const x = player.x + out.x * dist + across.x * spread;
      const z = player.z + out.z * dist + across.z * spread;
      const heading = normDeg(Math.atan2(player.x - x, player.z - z) * 180 / Math.PI);
      return {
         id, x, z, heading, speed: 4,
         doctrine: "rig",
         skill: 0.80 + rng() * 0.25,
         engage: 170 + rng() * 120,
      };
   });
}
