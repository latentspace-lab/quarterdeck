// tests/unit/damage-crew.test.js - damage model and crew, seeded.
//
// Both models roll dice. Since Phase 0D every roll goes through an
// injected generator - only that makes these cases reliably testable
// instead of "usually green".
import { DamageModel, Crew, AMMO, AMMO_ORDER, SIDES, MASTS, sectionAt, getVessel, makeRng }
   from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("damage + crew");
const { ok, near, eq } = suite;

const LYDIA = getVessel("lydia");
const shot = (over = {}) => ({
   side: "STBD", s: 0.5, y: 2.0, ammo: AMMO.ball, lb: 18, range01: 0.1, freeboard: 4, ...over,
});

suite.section("Ammunition");
eq(AMMO_ORDER.length, 3, "three ammo types");
ok(AMMO_ORDER.every((id) => AMMO[id]), "each is in the catalogue");
ok(AMMO.ball.hull > AMMO.chain.hull, "round shot goes into the hull");
ok(AMMO.chain.rig > AMMO.ball.rig, "chain shot into the rigging");
ok(AMMO.grape.gun > AMMO.ball.gun, "grapeshot sweeps the battery");
ok(AMMO.grape.pellets > 1, "grapeshot is a swarm");
ok(AMMO.grape.rangeFactor < AMMO.ball.rangeFactor, "and only works at pistol range");

suite.section("Sections");
eq(sectionAt(0), "BOW", "forward");
eq(sectionAt(0.5), "MID", "amidships");
eq(sectionAt(0.9), "QUARTER", "aft");
eq(sectionAt(-1), "BOW", "out of range clamps to forward");

suite.section("Determinism (Phase 0D)");
{
   const run = (seed) => {
      const d = new DamageModel(LYDIA, { rng: makeRng(seed) });
      const out = [];
      for (let i = 0; i < 60; i++) {
         const r = d.applyHit(shot({ s: (i % 10) / 10, y: 1 + (i % 5) }));
         out.push(r ? r.splinters : -1, r ? r.crew.n : -1, d.integrity(), d.rigging);
      }
      return fingerprint(out);
   };
   eq(run(1234), run(1234), "same seed, identical damage sequence");
   ok(run(1234) !== run(1235), "different seed, different sequence");

   const c = (seed) => {
      const crew = new Crew(LYDIA, { rng: makeRng(seed) });
      const out = [];
      for (let i = 0; i < 30; i++) {
         const r = crew.hit(8, i % 2 ? "deck" : "rigging");
         out.push(r.hurt, r.killed, crew.fit);
      }
      return fingerprint(out);
   };
   eq(c(77), c(77), "crew likewise");
   ok(c(77) !== c(78), "and reacts to the seed");
}

suite.section("Hull");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(1) });
   eq(d.integrity(), 1, "undamaged");
   eq(d.hullAverage(), 1, "all six sections intact");
   eq(d.mastsStanding(), 3, "three masts standing");
   ok(!d.beaten() && !d.sunk && !d.struck, "and she is fit for battle");

   for (let i = 0; i < 20; i++) d.applyHit(shot());
   ok(d.integrity() < 1, "hits cost fighting strength", d.integrity().toFixed(3));
   ok(d.hull.STBD_MID < d.hull.PORT_MID, "specifically on the side that was hit");
   eq(d.hull.PORT_BOW, 1, "the unengaged side stays intact");
   ok(d.integrity() >= 0, "never negative");

   // Closer is more dangerous.
   const near1 = new DamageModel(LYDIA, { rng: makeRng(5) });
   const far = new DamageModel(LYDIA, { rng: makeRng(5) });
   for (let i = 0; i < 20; i++) {
      near1.applyHit(shot({ range01: 0 }));
      far.applyHit(shot({ range01: 1 }));
   }
   ok(near1.integrity() < far.integrity(), "at short range it hits harder",
      near1.integrity().toFixed(2) + " vs " + far.integrity().toFixed(2));

   // A heavier hull soaks up more.
   const thin = new DamageModel({ ...LYDIA, structure: { ...LYDIA.structure, scantling: 0.4 } }, { rng: makeRng(9) });
   const thick = new DamageModel({ ...LYDIA, structure: { ...LYDIA.structure, scantling: 2.0 } }, { rng: makeRng(9) });
   for (let i = 0; i < 8; i++) { thin.applyHit(shot()); thick.applyHit(shot()); }
   ok(thin.integrity() < thick.integrity(), "a thin hull suffers more",
      thin.integrity().toFixed(2) + " vs " + thick.integrity().toFixed(2));
}

suite.section("Masts and rigging");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(3) });
   for (let i = 0; i < 120 && d.mastsStanding() === 3; i++) {
      d.applyHit(shot({ ammo: AMMO.chain, y: 20, s: 0.5 }));
   }
   ok(d.mastsStanding() < 3, "chain shot brings a mast down",
      d.mastsStanding() + " masts still standing");
   ok(d.rigging < 1 && d.sails < 1, "shrouds and canvas suffer too");
   ok(d.driveFactor() < 1, "sailing power drops", d.driveFactor().toFixed(2));

   const gone = new DamageModel(LYDIA, { rng: makeRng(3) });
   for (const m of MASTS) gone.breakMast(m, "test");
   eq(gone.mastsStanding(), 0, "all masts can go");
   ok(gone.driveFactor() < 0.05, "without masts, hardly any way on", gone.driveFactor().toFixed(3));
   eq(gone.breakMast("main", "test"), null, "a fallen mast does not fall twice");

   // The mainmast carries the most.
   const noMain = new DamageModel(LYDIA, { rng: makeRng(1) });
   noMain.breakMast("main", "test");
   const noMizzen = new DamageModel(LYDIA, { rng: makeRng(1) });
   noMizzen.breakMast("mizzen", "test");
   ok(noMain.driveFactor() < noMizzen.driveFactor(),
      "losing the mainmast weighs heavier than losing the mizzen",
      noMain.driveFactor().toFixed(2) + " vs " + noMizzen.driveFactor().toFixed(2));
}

suite.section("Leaks and sinking");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(8), isPlayer: false });
   d.holes.push({ side: "STBD", sec: "MID", below: true, size: 0.9 });
   d.holes.push({ side: "STBD", sec: "BOW", below: true, size: 0.9 });
   let t = 0;
   while (!d.sunk && t < 4000) { d.update(0.5, { heel: 10, pump: 1 }); t += 0.5; }
   ok(d.sunk, "a big leak sinks her", t.toFixed(0) + " s");
   ok(d.flooding >= 1, "fully flooded");
   const events = d.drainEvents();
   ok(events.some((e) => e.type === "sunk"), "and reports it");
   eq(d.drainEvents().length, 0, "events are only delivered once");

   // Pumps hold off a small leak.
   const small = new DamageModel(LYDIA, { rng: makeRng(8), isPlayer: true });
   small.holes.push({ side: "PORT", sec: "MID", below: true, size: 0.02 });
   for (let i = 0; i < 2000; i++) small.update(0.5, { heel: 0, pump: 1 });
   ok(!small.sunk, "the pumps hold off a small leak", "flooding " + small.flooding.toFixed(3));

   ok(new DamageModel(LYDIA, { rng: makeRng(1) }).floodSpeedFactor() === 1, "dry costs nothing");
   const wet = new DamageModel(LYDIA, { rng: makeRng(1) });
   wet.flooding = 0.5;
   ok(wet.floodSpeedFactor() < 1 && wet.floodHeel() > 0, "water costs speed and causes a list");
}

suite.section("Striking the flag");
{
   // integrity()'s baseline is one shredded BROADSIDE, i.e. three sections.
   // Anyone who lands 300 balls on the same spot never gets below 0.67:
   // a salvo has to run along the whole hull.
   const alongside = (i) => shot({ lb: 24, s: 0.1 + (i % 3) * 0.4 });
   const d = new DamageModel(LYDIA, { rng: makeRng(21), isPlayer: false });
   for (let i = 0; i < 300 && !d.struck; i++) { d.applyHit(alongside(i)); d.update(0.1, {}); }
   ok(d.struck, "a beaten ship strikes her colours", "hull " + d.integrity().toFixed(2));

   // And the rule behind it, without randomness: one fully shot-up section
   // costs exactly one third - the same as a third of a broadside.
   const oneSpot = new DamageModel(LYDIA, { rng: makeRng(21) });
   oneSpot.hull.STBD_MID = 0;
   near(oneSpot.integrity(), 2 / 3, 1e-12, "one shot-up section = one third");
   ok(!oneSpot.beaten(), "that alone is not yet enough to beat her");
   oneSpot.hull.STBD_BOW = 0;
   oneSpot.hull.STBD_QUARTER = 0;
   near(oneSpot.integrity(), 0, 1e-12, "a shredded broadside is the end");
   ok(oneSpot.beaten(), "and that beats her");

   const player = new DamageModel(LYDIA, { rng: makeRng(21), isPlayer: true });
   for (let i = 0; i < 300; i++) { player.applyHit(alongside(i)); player.update(0.1, {}); }
   ok(!player.struck, "the player decides for themselves - nobody strikes the flag for them");
}

suite.section("Ramming and grounding");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(4) });
   const res = d.applyRam({ closingKts: 8, otherTons: 1500, ownTons: 1000, side: "PORT", s: 0.2 });
   ok(res.splinters > 0, "a ram tears out splinters", res.splinters);
   ok(d.integrity() < 1, "and costs fighting strength");

   const soft = new DamageModel(LYDIA, { rng: makeRng(4) });
   soft.applyRam({ closingKts: 1, otherTons: 200, ownTons: 1000, side: "PORT", s: 0.2 });
   ok(soft.integrity() > d.integrity(), "coming alongside gently costs less");

   const g = new DamageModel(LYDIA, { rng: makeRng(6) });
   const dmg = g.applyGrounding({ speedKts: 8, draft: 4.8, depth: 1 });
   ok(dmg > 0, "running aground damages the hull", dmg.toFixed(3));
   ok(g.holes.some((h) => h.below), "and opens leaks below the waterline");
   eq(g.applyGrounding({ speedKts: 0, draft: 4.8, depth: 10 }), 0, "enough water, no damage");
}

suite.section("Oversetting sail in a storm");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(2) });
   let broke = null;
   for (let i = 0; i < 3000 && !broke; i++) {
      broke = d.stressRig(0.1, { windKts: 45, sailSet: 1, twa: 60 });
   }
   ok(broke, "full sail in a storm sends a mast over the side", broke && broke.mast);

   const reefed = new DamageModel(LYDIA, { rng: makeRng(2) });
   for (let i = 0; i < 3000; i++) reefed.stressRig(0.1, { windKts: 45, sailSet: 0.25, twa: 60 });
   ok(reefed.mastsStanding() === 3, "reefed sail keeps the rig standing - that's what the keys are for");
}

suite.section("Crew");
{
   const c = new Crew(LYDIA, { rng: makeRng(12) });
   eq(c.fit, c.total, "at full strength");
   eq(c.wounded + c.dead, 0, "no losses");
   near(c.total, LYDIA.crew, 0, "full complement from the catalogue", c.total);
   ok(Object.keys(c.roles).length >= 5, "several roles aboard");
   near(Object.values(c.roles).reduce((s, r) => s + r.start, 0), c.total, 0,
      "the roles add up exactly to the crew");

   const before = c.fit;
   const r = c.hit(30, "rigging");
   eq(r.hurt + r.killed, before - c.fit, "every casualty is either wounded or dead");
   ok(r.hurt > r.killed, "wounded clearly outnumber the dead", r.hurt + " to " + r.killed);
   eq(r.worst, "top", "aloft it hits the topmen hardest", r.worst);
   eq(c.hit(0).hurt, 0, "zero hits, zero casualties");

   const deck = new Crew(LYDIA, { rng: makeRng(12) });
   deck.hit(60, "deck");
   ok(deck.fraction("top") > c.fraction("top") - 0.5, "on deck it hits other roles");

   // Effects
   const hurt = new Crew(LYDIA, { rng: makeRng(13) });
   const g0 = hurt.gunnery();
   for (let i = 0; i < 6; i++) hurt.hit(30, "hull");
   const g1 = hurt.gunnery();
   ok(g1.served <= g0.served && g1.rate <= g0.rate, "losses slow the battery down",
      g1.served.toFixed(2) + " / " + g1.rate.toFixed(2));
   ok(hurt.morale() < 1, "and drag down morale", hurt.morale().toFixed(2));
   hurt.shock(0.5);
   ok(hurt.shaken > 0, "a severe event shakes them");
   const m0 = hurt.morale();
   for (let i = 0; i < 200; i++) hurt.update(1);
   ok(hurt.morale() >= m0, "over time they recover");
   ok(hurt.wounded < hurt.losses, "lightly wounded men return to the guns");

   const st = c.status();
   ok(st.roles.length > 0 && st.total === c.total, "status() returns the roster");
   ok(st.roles.every((r) => r.frac >= 0 && r.frac <= 1), "fractions normalized");
}

suite.section("Every side and mast can be addressed");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(1) });
   for (const side of SIDES) {
      d.applyHit(shot({ side, s: 0.1 }));
      d.applyHit(shot({ side, s: 0.5 }));
      d.applyHit(shot({ side, s: 0.9 }));
      ok(d.gunFraction(side) <= 1, side + ": gun fraction stays normalized");
   }
   const keys = Object.keys(d.hull);
   eq(keys.length, 6, "six hull sections");
   ok(keys.every((k) => d.hull[k] >= 0 && d.hull[k] <= 1), "all sections normalized");
   ok(MASTS.every((m) => d.masts[m]), "all three masts are tracked");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
