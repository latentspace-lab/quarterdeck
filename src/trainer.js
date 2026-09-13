// trainer.js - Training mode with manual / sail-handling exercises
// state.boat: {twa, twaSigned, tack, luffing, speed, capsize, heading, pos}
// state.wind: {dir, speed}
//
// The target bands are based on the selected ship's no-go zone:
// a yacht luffs at 45 degrees, a square-rigger cannot point above ~67 degrees.
// Without an argument the trainer behaves exactly as before (No-Go = 32 degrees).
export function makeTrainer(vessel) {
    const noGo = (vessel && vessel.sail && vessel.sail.noGo) || 32;
    const square = !!(vessel && vessel.rig === "square");
    const lo1 = noGo, hi1 = noGo + 23;
    const lo2 = noGo + 6, hi2 = noGo + 28;
    const best = Math.round((lo2 + hi2) / 2);
    const beam = square ? 100 : 90;
    const beamTol = square ? 15 : 12;
    const deep = square ? 135 : 120;

    const challenges = [
        {
        title: square ? "1 · Hold a close-hauled course" : "1 · Hold close-hauled",
        desc: `Hold close-hauled (TWA) between ${lo1}° and ${hi1}° at all times. No backing (below ${lo1}° = no-go zone).`,
        hint: `|TWA| ${lo1}-${hi1}° for 10 sec`,
        dur: 10,
        ok: (b) => Math.abs(b.twa) < hi1 && Math.abs(b.twa) > lo1,
        },
        {
        title: "2 · Upwind VMG (best upwind progress)",
        desc: `Sail at ~${best}° TWA: the fastest way upwind. Hold for 8 sec.`,
        hint: `|TWA| ${lo2}-${hi2}° for 8 sec`,
        dur: 8,
        ok: (b) => Math.abs(b.twa) >= lo2 && Math.abs(b.twa) <= hi2,
        },
        {
        title: square ? "3 · Tack / Wear ship" : "3 · Tack (close-hauled tack)",
        desc: square
           ? `Change tack (Stbd ↔ Port). A square-rigger loses way fast — gather headway first, or bear away and wear ship.`
           : `Change tack (Stbd ↔ Port). Sail through the no-go zone (briefly through TWA < ${noGo}°).`,
        hint: "Change tack (Stbd ↔ Port)",
        edge: "tack",
        },
        {
        title: "4 · Beam Reach",
        desc: square
           ? `Wind on the beam: ~${beam}° TWA ("Soldier's Wind"). Hold for 6 sec.`
           : `Sail at ~${beam}° TWA (wind on the beam) — the fastest point of sail. Hold for 6 sec.`,
        hint: `|TWA| ~${beam}° for 6 sec`,
        dur: 6,
        ok: (b) => Math.abs(Math.abs(b.twa) - beam) < beamTol,
        },
        {
        title: "5 · Jibe / Downwind tack change",
        desc: `From one downwind board to the other: at > ${deep}° TWA go through 180° (running). Watch your helm when jibing!`,
        hint: `Downwind tack change (TWA > ${deep}°)`,
        edge: "downTack",
        },
        {
        title: "6 · Avoid capsize (strong wind)",
        desc: square
           ? "At 18+ kn: keep the ship stiff, brace yards and endure for 15 sec."
           : "At 18+ kn wind: sail deeper (less leeway, e.g. beam reach ~90°) and avoid capsizing (leeway > 60°) for 15 sec.",
        hint: "15 sec without capsizing at 20+ kn",
        dur: 15,
        capsizeSafe: true,
        ok: (b, w) => w.speed >= 18 && !b.capsize,
        },
        {
        title: "7 · Reach the buoy",
        desc: "Navigate to the yellow mark buoy 500 m north (bearing: 0°, north). Use the compass and the jib!",
        hint: "Target: buoy at (~0, +500 m)",
        target: { x: 0, z: 500 },
        ok: (b) => Math.abs(b.pos.z - 500) + Math.abs(b.pos.x) < 30,
        },
        ];

    let idx = 0;
   let timer = 0;
   let prevTack = null;
   let prevDownTack = null;

   function step(ch, state, dt) {
      const b = state.boat;
      const w = state.wind;
       if (ch.edge === "tack") {
        const changed = b.tack !== prevTack;
        prevTack = b.tack;
        return { done: changed, progress: changed ? 1 : 0 };
        }
       if (ch.edge === "downTack") {
        if (Math.abs(b.twa) > deep) {
           const changed = b.tack !== prevDownTack;
            prevDownTack = b.tack;
           return { done: changed, progress: changed ? 1 : 0 };
            }
        return { done: false, progress: 0 };
        }
       if (ch.dur > 0) {
          if (ch.capsizeSafe && b.capsize) {
            timer = 0;
            return { done: false, progress: 0 };
            }
          if (ch.ok(b, w)) {
            timer += dt;
            } else {
            timer = Math.max(0, timer - dt * 0.7);
             }
          return { done: timer >= ch.dur, progress: Math.min(1, timer / ch.dur) };
         }
       return { done: !!ch.ok(b, w), progress: ch.ok(b, w) ? 1 : 0 };
      }

      function reset() {
        timer = 0;
         prevTack = null;
         prevDownTack = null;
        }

      return {
       list: challenges,
        get current() {
          return challenges[idx];
           },
        setIndex(i) {
          idx = ((i % challenges.length) + challenges.length) % challenges.length;
           reset();
            },
         next() {
          idx = (idx + 1) % challenges.length;
           reset();
            },
         reset() {
          timer = 0;
           prevTack = null;
            prevDownTack = null;
            },
        update(state, dt) {
          const ch = challenges[idx];
          if (!ch) return { progress: 0, done: false, title: "", desc: "" };
          const r = step(ch, state, dt);
          if (r.done) reset();
          return {
            progress: r.progress,
             done: r.done,
             title: ch.title,
             desc: ch.desc,
             hint: ch.hint,
             target: ch.target,
             index: idx,
            };
         },
        index() {
          return idx;
          },
        total() {
          return challenges.length;
          },
       };
      }
