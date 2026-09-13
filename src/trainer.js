// trainer.js - Training-Modus mit manuellen / segeltechnischen Uebungen
// state.boat: {twa, twaSigned, tack, luffing, speed, capsize, heading, pos}
// state.wind: {dir, speed}
//
// Die Winkelbaender richten sich nach der No-Go-Zone des gewaehlten Schiffs:
// eine Yacht kreuzt in 45 Grad, ein Rahsegler kommt nicht ueber ~67 Grad heran.
// Ohne Argument verhaelt sich der Trainer exakt wie zuvor (No-Go = 32 Grad).
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
        title: square ? "1 · Hart am Wind liegen" : "1 · Krausen halten",
        desc: `Halte den Segelkurs (TWA) dauerhaft zwischen ${lo1}° und ${hi1}°. Kein Backen (unter ${lo1}° = No-Go-Zone).`,
        hint: `|TWA| ${lo1}–${hi1}° für 10 sec`,
        dur: 10,
        ok: (b) => Math.abs(b.twa) < hi1 && Math.abs(b.twa) > lo1,
        },
        {
        title: "2 · Upwind-VMG (bester Aufwind-Fortschritt)",
        desc: `Segle auf ~${best}° TWA: der schnellste Weg gegen den Wind (Upwind). Halte 8 sec.`,
        hint: `|TWA| ${lo2}–${hi2}° für 8 sec`,
        dur: 8,
        ok: (b) => Math.abs(b.twa) >= lo2 && Math.abs(b.twa) <= hi2,
        },
        {
        title: square ? "3 · Durch den Wind gehen (Tack / Halsen)" : "3 · Wendemanöver (Halse / Tack)",
        desc: square
           ? `Wechsle die Flanke (Stbd ↔ Port). Ein Rahsegler verliert dabei viel Fahrt — nimm Schwung mit, oder falle ab und halse (wear ship).`
           : `Wechsle die Flanke (Stbd ↔ Port). Fahre über die No-Go-Zone (kurz durch TWA < ${noGo}°).`,
        hint: "Tack wechseln (Stbd ↔ Port)",
        edge: "tack",
        },
        {
        title: "4 · Raumschot (Beam Reach)",
        desc: square
           ? `Wind quer ein: ~${beam}° TWA ("Soldier's Wind"). 6 sec halten.`
           : `Steuere auf den Segelkurs von ${beam}° TWA (Wind auf einer Seite) — das ist der schnellste Windkurs. 6 sec.`,
        hint: `|TWA| ~${beam}° für 6 sec`,
        dur: 6,
        ok: (b) => Math.abs(Math.abs(b.twa) - beam) < beamTol,
        },
        {
        title: "5 · Gieren (Jibe / Downwind-Tackwechsel)",
        desc: `Vom einen Downwind-Flanken zum anderen: bei > ${deep}° TWA über 180° (Vorderwind). Achte auf dein Ruder beim Gieren!`,
        hint: `Downwind-Tackwechsel (TWA > ${deep}°)`,
        edge: "downTack",
        },
        {
        title: "6 · Kenter vermeiden (starker Wind)",
        desc: square
           ? "Bei 18+ kn: das Schiff steif halten, Rahen brassen und 15 sec durchstehen."
           : "Bei 18+ kn Wind: segle tiefer (weniger Gier, z.B. Raumschot ~90°) und vermeide das Kentern (Gier > 60°) 15 sec lang.",
        hint: "15 sec ohne Kenter bei 20+ kn",
        dur: 15,
        capsizeSafe: true,
        ok: (b, w) => w.speed >= 18 && !b.capsize,
        },
        {
        title: "7 · Boje erreichen",
        desc: "Navigiere zur gelben Wendeboje 500 m nördlich (Richtung: Rgk 0°, nach Norden). Nutze den Kompass und den Vorsegel!",
        hint: "Ziel: Boje bei (~0, +500 m)",
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
