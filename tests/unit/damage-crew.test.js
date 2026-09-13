// tests/unit/damage-crew.test.js - Schadensmodell und Mannschaft, mit Seed.
//
// Beide Modelle wuerfeln. Seit Phase 0D laeuft jeder Wurf ueber einen
// injizierten Generator - erst dadurch sind diese Faelle ueberhaupt
// zuverlaessig pruefbar statt "meistens gruen".
import { DamageModel, Crew, AMMO, AMMO_ORDER, SIDES, MASTS, sectionAt, getVessel, makeRng }
   from "@segel/shared";
import { createSuite, fingerprint } from "../lib/harness.js";

const suite = createSuite("damage + crew");
const { ok, near, eq } = suite;

const LYDIA = getVessel("lydia");
const shot = (over = {}) => ({
   side: "STBD", s: 0.5, y: 2.0, ammo: AMMO.ball, lb: 18, range01: 0.1, freeboard: 4, ...over,
});

suite.section("Munition");
eq(AMMO_ORDER.length, 3, "drei Munitionsarten");
ok(AMMO_ORDER.every((id) => AMMO[id]), "jede ist im Katalog");
ok(AMMO.ball.hull > AMMO.chain.hull, "Vollkugel geht in den Rumpf");
ok(AMMO.chain.rig > AMMO.ball.rig, "Kettenkugel in die Takelage");
ok(AMMO.grape.gun > AMMO.ball.gun, "Kartaetsche raeumt die Batterie");
ok(AMMO.grape.pellets > 1, "die Kartaetsche ist ein Schwarm");
ok(AMMO.grape.rangeFactor < AMMO.ball.rangeFactor, "und wirkt nur auf Pistolenschussweite");

suite.section("Sektionen");
eq(sectionAt(0), "BOW", "vorn");
eq(sectionAt(0.5), "MID", "mittschiffs");
eq(sectionAt(0.9), "QUARTER", "achtern");
eq(sectionAt(-1), "BOW", "ausserhalb klemmt es vorn");

suite.section("Determinismus (Phase 0D)");
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
   eq(run(1234), run(1234), "gleicher Seed, identischer Schadensverlauf");
   ok(run(1234) !== run(1235), "anderer Seed, anderer Verlauf");

   const c = (seed) => {
      const crew = new Crew(LYDIA, { rng: makeRng(seed) });
      const out = [];
      for (let i = 0; i < 30; i++) {
         const r = crew.hit(8, i % 2 ? "deck" : "rigg");
         out.push(r.hurt, r.killed, crew.fit);
      }
      return fingerprint(out);
   };
   eq(c(77), c(77), "Mannschaft ebenso");
   ok(c(77) !== c(78), "und reagiert auf den Seed");
}

suite.section("Rumpf");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(1) });
   eq(d.integrity(), 1, "unbeschaedigt");
   eq(d.hullAverage(), 1, "alle sechs Abschnitte heil");
   eq(d.mastsStanding(), 3, "drei Masten stehen");
   ok(!d.beaten() && !d.sunk && !d.struck, "und sie ist kampfbereit");

   for (let i = 0; i < 20; i++) d.applyHit(shot());
   ok(d.integrity() < 1, "Treffer kosten Gefechtskraft", d.integrity().toFixed(3));
   ok(d.hull.STBD_MID < d.hull.PORT_MID, "und zwar auf der getroffenen Seite");
   eq(d.hull.PORT_BOW, 1, "die unbeschossene Seite bleibt heil");
   ok(d.integrity() >= 0, "nie negativ");

   // Naeher ist gefaehrlicher.
   const near1 = new DamageModel(LYDIA, { rng: makeRng(5) });
   const far = new DamageModel(LYDIA, { rng: makeRng(5) });
   for (let i = 0; i < 20; i++) {
      near1.applyHit(shot({ range01: 0 }));
      far.applyHit(shot({ range01: 1 }));
   }
   ok(near1.integrity() < far.integrity(), "auf kurze Entfernung wirkt es staerker",
      near1.integrity().toFixed(2) + " gegen " + far.integrity().toFixed(2));

   // Schwerere Bordwand steckt mehr weg.
   const thin = new DamageModel({ ...LYDIA, structure: { ...LYDIA.structure, scantling: 0.4 } }, { rng: makeRng(9) });
   const thick = new DamageModel({ ...LYDIA, structure: { ...LYDIA.structure, scantling: 2.0 } }, { rng: makeRng(9) });
   for (let i = 0; i < 25; i++) { thin.applyHit(shot()); thick.applyHit(shot()); }
   ok(thin.integrity() < thick.integrity(), "duenne Bordwand leidet mehr",
      thin.integrity().toFixed(2) + " gegen " + thick.integrity().toFixed(2));
}

suite.section("Masten und Takelage");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(3) });
   for (let i = 0; i < 120 && d.mastsStanding() === 3; i++) {
      d.applyHit(shot({ ammo: AMMO.chain, y: 20, s: 0.5 }));
   }
   ok(d.mastsStanding() < 3, "Kettenkugeln holen einen Mast herunter",
      d.mastsStanding() + " Masten stehen noch");
   ok(d.rigging < 1 && d.sails < 1, "Wanten und Tuch leiden mit");
   ok(d.driveFactor() < 1, "die Segelkraft faellt", d.driveFactor().toFixed(2));

   const gone = new DamageModel(LYDIA, { rng: makeRng(3) });
   for (const m of MASTS) gone.breakMast(m, "test");
   eq(gone.mastsStanding(), 0, "alle Masten koennen fallen");
   ok(gone.driveFactor() < 0.05, "ohne Masten kaum noch Fahrt", gone.driveFactor().toFixed(3));
   eq(gone.breakMast("main", "test"), null, "ein gefallener Mast faellt nicht zweimal");

   // Der Grossmast traegt am meisten.
   const noMain = new DamageModel(LYDIA, { rng: makeRng(1) });
   noMain.breakMast("main", "test");
   const noMizzen = new DamageModel(LYDIA, { rng: makeRng(1) });
   noMizzen.breakMast("mizzen", "test");
   ok(noMain.driveFactor() < noMizzen.driveFactor(),
      "der Verlust des Grossmasts wiegt schwerer als der des Besan",
      noMain.driveFactor().toFixed(2) + " gegen " + noMizzen.driveFactor().toFixed(2));
}

suite.section("Lecks und Untergang");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(8), isPlayer: false });
   d.holes.push({ side: "STBD", sec: "MID", below: true, size: 0.9 });
   d.holes.push({ side: "STBD", sec: "BOW", below: true, size: 0.9 });
   let t = 0;
   while (!d.sunk && t < 4000) { d.update(0.5, { heel: 10, pump: 1 }); t += 0.5; }
   ok(d.sunk, "ein grosses Leck versenkt sie", t.toFixed(0) + " s");
   ok(d.flooding >= 1, "vollgelaufen");
   const events = d.drainEvents();
   ok(events.some((e) => e.type === "sunk"), "und meldet es");
   eq(d.drainEvents().length, 0, "Ereignisse werden nur einmal geliefert");

   // Pumpen halten ein kleines Leck.
   const small = new DamageModel(LYDIA, { rng: makeRng(8), isPlayer: true });
   small.holes.push({ side: "PORT", sec: "MID", below: true, size: 0.02 });
   for (let i = 0; i < 2000; i++) small.update(0.5, { heel: 0, pump: 1 });
   ok(!small.sunk, "die Pumpen halten ein kleines Leck", "Flutung " + small.flooding.toFixed(3));

   ok(new DamageModel(LYDIA, { rng: makeRng(1) }).floodSpeedFactor() === 1, "trocken kostet nichts");
   const wet = new DamageModel(LYDIA, { rng: makeRng(1) });
   wet.flooding = 0.5;
   ok(wet.floodSpeedFactor() < 1 && wet.floodHeel() > 0, "Wasser kostet Fahrt und macht Schlagseite");
}

suite.section("Flagge streichen");
{
   // Bezugsgroesse von integrity() ist eine aufgerissene BREITSEITE, also drei
   // Abschnitte. Wer 300 Kugeln auf denselben Fleck legt, kommt nie unter 0.67:
   // eine Salve muss die Bordwand entlanglaufen.
   const alongside = (i) => shot({ lb: 24, s: 0.1 + (i % 3) * 0.4 });
   const d = new DamageModel(LYDIA, { rng: makeRng(21), isPlayer: false });
   for (let i = 0; i < 300 && !d.struck; i++) { d.applyHit(alongside(i)); d.update(0.1, {}); }
   ok(d.struck, "ein geschlagenes Schiff streicht", "Rumpf " + d.integrity().toFixed(2));

   // Und die Regel dahinter, ohne Zufall: ein voellig zerschossener Abschnitt
   // kostet genau ein Drittel - so viel wie ein Drittel einer Breitseite.
   const oneSpot = new DamageModel(LYDIA, { rng: makeRng(21) });
   oneSpot.hull.STBD_MID = 0;
   near(oneSpot.integrity(), 2 / 3, 1e-12, "ein zerschossener Abschnitt = ein Drittel");
   ok(!oneSpot.beaten(), "davon allein ist sie noch nicht geschlagen");
   oneSpot.hull.STBD_BOW = 0;
   oneSpot.hull.STBD_QUARTER = 0;
   near(oneSpot.integrity(), 0, 1e-12, "eine aufgerissene Breitseite ist das Ende");
   ok(oneSpot.beaten(), "und damit ist sie geschlagen");

   const player = new DamageModel(LYDIA, { rng: makeRng(21), isPlayer: true });
   for (let i = 0; i < 300; i++) { player.applyHit(alongside(i)); player.update(0.1, {}); }
   ok(!player.struck, "der Spieler entscheidet selbst - fuer ihn streicht niemand");
}

suite.section("Rammstoss und Grundberuehrung");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(4) });
   const res = d.applyRam({ closingKts: 8, otherTons: 1500, ownTons: 1000, side: "PORT", s: 0.2 });
   ok(res.splinters > 0, "ein Rammstoss reisst Splitter", res.splinters);
   ok(d.integrity() < 1, "und kostet Gefechtskraft");

   const soft = new DamageModel(LYDIA, { rng: makeRng(4) });
   soft.applyRam({ closingKts: 1, otherTons: 200, ownTons: 1000, side: "PORT", s: 0.2 });
   ok(soft.integrity() > d.integrity(), "sanftes Anlegen kostet weniger");

   const g = new DamageModel(LYDIA, { rng: makeRng(6) });
   const dmg = g.applyGrounding({ speedKts: 8, draft: 4.8, depth: 1 });
   ok(dmg > 0, "Auflaufen beschaedigt den Rumpf", dmg.toFixed(3));
   ok(g.holes.some((h) => h.below), "und schlaegt Lecks unter Wasser");
   eq(g.applyGrounding({ speedKts: 0, draft: 4.8, depth: 10 }), 0, "genug Wasser, kein Schaden");
}

suite.section("Ueberpressen im Sturm");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(2) });
   let broke = null;
   for (let i = 0; i < 3000 && !broke; i++) {
      broke = d.stressRig(0.1, { windKts: 45, sailSet: 1, twa: 60 });
   }
   ok(broke, "voll besegelt im Sturm geht ein Mast ueber Bord", broke && broke.mast);

   const reefed = new DamageModel(LYDIA, { rng: makeRng(2) });
   for (let i = 0; i < 3000; i++) reefed.stressRig(0.1, { windKts: 45, sailSet: 0.25, twa: 60 });
   ok(reefed.mastsStanding() === 3, "gerefft haelt das Rigg - dafuer gibt es die Tasten");
}

suite.section("Mannschaft");
{
   const c = new Crew(LYDIA, { rng: makeRng(12) });
   eq(c.fit, c.total, "vollzaehlig");
   eq(c.wounded + c.dead, 0, "keine Verluste");
   near(c.total, LYDIA.crew, 0, "Sollstaerke aus dem Katalog", c.total);
   ok(Object.keys(c.roles).length >= 5, "mehrere Rollen an Bord");
   near(Object.values(c.roles).reduce((s, r) => s + r.start, 0), c.total, 0,
      "die Rollen summieren sich exakt auf die Besatzung");

   const before = c.fit;
   const r = c.hit(30, "rigg");
   eq(r.hurt + r.killed, before - c.fit, "jeder Ausfall ist entweder verwundet oder tot");
   ok(r.hurt > r.killed, "Verwundete ueberwiegen die Toten deutlich", r.hurt + " zu " + r.killed);
   eq(r.worst, "top", "im Rigg trifft es die Toppsgasten", r.worst);
   eq(c.hit(0).hurt, 0, "null Treffer, null Ausfaelle");

   const deck = new Crew(LYDIA, { rng: makeRng(12) });
   deck.hit(60, "deck");
   ok(deck.fraction("top") > c.fraction("top") - 0.5, "an Deck trifft es andere Rollen");

   // Auswirkungen
   const hurt = new Crew(LYDIA, { rng: makeRng(13) });
   const g0 = hurt.gunnery();
   for (let i = 0; i < 6; i++) hurt.hit(30, "bord");
   const g1 = hurt.gunnery();
   ok(g1.served <= g0.served && g1.rate <= g0.rate, "Verluste bremsen die Batterie",
      g1.served.toFixed(2) + " / " + g1.rate.toFixed(2));
   ok(hurt.morale() < 1, "und druecken die Moral", hurt.morale().toFixed(2));
   hurt.shock(0.5);
   ok(hurt.shaken > 0, "ein schweres Ereignis erschuettert");
   const m0 = hurt.morale();
   for (let i = 0; i < 200; i++) hurt.update(1);
   ok(hurt.morale() >= m0, "mit der Zeit fangen sie sich wieder");
   ok(hurt.wounded < hurt.losses, "Leichtverwundete kehren an die Rohre zurueck");

   const st = c.status();
   ok(st.roles.length > 0 && st.total === c.total, "status() liefert die Aufstellung");
   ok(st.roles.every((r) => r.frac >= 0 && r.frac <= 1), "Anteile normiert");
}

suite.section("Alle Seiten und Masten sind ansprechbar");
{
   const d = new DamageModel(LYDIA, { rng: makeRng(1) });
   for (const side of SIDES) {
      d.applyHit(shot({ side, s: 0.1 }));
      d.applyHit(shot({ side, s: 0.5 }));
      d.applyHit(shot({ side, s: 0.9 }));
      ok(d.gunFraction(side) <= 1, side + ": Rohranteil bleibt normiert");
   }
   const keys = Object.keys(d.hull);
   eq(keys.length, 6, "sechs Rumpfabschnitte");
   ok(keys.every((k) => d.hull[k] >= 0 && d.hull[k] <= 1), "alle Abschnitte normiert");
   ok(MASTS.every((m) => d.masts[m]), "alle drei Masten gefuehrt");
}

export default () => suite.done();

if (!process.env.SEGEL_TEST_RUNNER) suite.done();
