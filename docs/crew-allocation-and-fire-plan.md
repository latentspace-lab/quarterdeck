# Crew allocation, fire and magazine explosion

Design plan for the next core mechanic: the captain allocates a shrinking crew
between competing tasks, fire is a located threat that must be fought by
people, and an unfought fire near a magazine blows the ship up.

Status: proposal, not yet implemented. Numbers are starting points for tuning.

## 1. What we are building

Today the crew is a set of fixed role shares (`packages/shared/src/crew.ts`).
Casualties thin each role, and the role fractions feed the guns, sails, pumps
and helm. The captain has no say in where the hands go. Fire is a single
scalar `afire` on the damage model that grows on its own, is fought at a
constant rate regardless of crew, and sinks the ship at 0.98 with an
`exploded` event that the client shows as a plain sinking.

The new mechanic:

1. **Stations.** Fit hands are distributed over stations: port guns,
   starboard guns, sail handling, pumps and leak repair, fire party, and a
   reserve. The captain's orders decide the distribution. Skill still
   matters: a gunner at the pumps works, but a carpenter works twice as well.
2. **Scarcity.** Every hit that wounds or kills removes hands from the pool.
   With a full crew the default battle allocation covers everything. After
   losses the captain must choose: keep both batteries served, or pull a
   watch off the guns to fight the fire and the water.
3. **Located fire.** Fire lives in hull sections, spreads along the ship and
   into the rigging, is fed by wind and set sails, and is fought at a rate
   that depends on the hands assigned. A fire in a section that holds a
   magazine starts a fuse.
4. **Magazine.** If the fuse runs out the ship explodes. The captain can
   order the magazine flooded, which ends the danger but also ends the
   powder supply: the guns fire what is loaded and then fall silent.
5. **Explosion.** A catastrophic, multi-second animated event: flash,
   fireball, shockwave, debris rain, hull broken in two, and blast damage,
   fire and crew shock on ships nearby.

The same shared code drives single-player, the server and the tests, as it
does for the rest of the model.

## 2. Crew model

### 2.1 Stations and orders

```ts
type Station = "gunsPort" | "gunsStbd" | "sails" | "pumps" | "fire" | "reserve";

interface CrewOrders {
   /** Relative priority per station, 0..1. Not head counts. */
   gunsPort: number; gunsStbd: number; sails: number; pumps: number; fire: number;
   /** Flood the magazines: no explosion risk, no reloading. One-way while afloat. */
   floodMagazine: boolean;
}
```

Orders are priorities, not head counts, so the same order stays valid as the
crew shrinks. An allocation solver turns priorities plus the fit hands per
role into a head count per station once per tick:

- Each station has a demand in hands (guns: crews for the guns still mounted
  on that side; pumps: proportional to open leak size; fire: proportional to
  total fire intensity; sails: a fixed share of the topmen).
- Hands are handed out in priority order until demand or the pool is
  exhausted. Roles are matched first (gun crews to guns, carpenters to pumps,
  topmen to sails, marines and idle gunners to the fire party), the remainder
  is filled from the reserve with a skill penalty.
- Output is `assigned[station]` in hands and an `efficiency[station]` 0..1
  that the existing effect functions consume: `gunnery(side)`, `pumping()`,
  `sailHandling()` and the new `firefighting()`.

Presets the captain can issue with one key each, on top of fine-grained
sliders in the panel:

| Preset | Guns port | Guns stbd | Sails | Pumps | Fire |
|---|---|---|---|---|---|
| Battle stations (default) | 1 | 1 | 0.5 | 0.3 | 0.3 |
| Engage to port | 1 | 0.2 | 0.5 | 0.3 | 0.3 |
| Engage to starboard | 0.2 | 1 | 0.5 | 0.3 | 0.3 |
| Fire party | 0.4 | 0.4 | 0.3 | 0.3 | 1 |
| All hands to the pumps | 0.3 | 0.3 | 0.3 | 1 | 0.5 |
| Make sail | 0.3 | 0.3 | 1 | 0.3 | 0.3 |

With a full crew the default preset must reproduce today's numbers, so that
the golden trace and the existing balance tests only move where the new
mechanic is actually active.

### 2.2 Effects

- **Guns.** Served guns and reload rate per side come from hands on that
  side's station divided by the hands the mounted guns need. Today's
  `gunnery()` becomes `gunnery(side)`. Powder boys stay a shared multiplier.
  A flooded magazine sets the reload rate to zero after the loaded round.
- **Pumps and leaks.** `pumping()` scales with hands on the pump station.
  New: carpenters on that station also **plug leaks**, shrinking the size of
  open below-water holes over time. This is what makes "all hands to the
  pumps" a real answer to the new leak rules.
- **Fire party.** `firefighting()` returns an extinguish rate in intensity
  per second. Buckets are slow, the ship's fire engine is faster, marines
  and idle gunners count fully.
- **Casualties by station.** The exposure table in `crew.ts` is keyed by
  where a role stands. With stations the exposure becomes station-based:
  a hit on the port side hurts the port gun crews, a fire party working in
  a burning section takes losses from the fire itself, hands below at the
  pumps are the safest.
- **Morale.** Unchanged formula, plus a penalty while the ship is afire and
  a large one while the magazine fuse is running. That makes AI ships
  strike earlier under fire, as their crews did.

## 3. Fire model

### 3.1 State

```ts
interface FireState {
   /** intensity 0..1 per hull section (6 sections) and the rig (1 value) */
   sections: Record<Side + "_" + Section, number>;
   rig: number;
   /** seconds of intense fire in a magazine section; explodes when it reaches the fuse */
   magazineFuse: number;
   magazineFlooded: boolean;
}
```

`afire` stays as the derived total for the HUD and the protocol.

### 3.2 Ignition

- A round shot hit on the hull: chance `0.02 * power` today. Keep it, but
  weight it towards sections that hold the galley (bow) and the cabins
  (quarter), and add a bonus for grape and for hits while the ship's own
  guns are firing (loose cartridges on deck).
- A broadside fired at pistol range sets the *target* alight with a small
  chance per gun: burning wads. This is the historical way most battle fires
  started, and it makes "fire only at point blank" a real trade-off.
- Burning wreckage alongside ignites the section it lies against.
- A neighbouring explosion throws burning debris: see 4.3.

### 3.3 Spread and growth

Per section and second:

```
growth  = intensity * 0.04 * windFactor * (1 + 0.5 * sailSet)
spread  = 0.015 * intensity into each adjacent section, upward into the rig
extinguish = firefighting() shared over the burning sections, biggest fire first
```

The rig catches from a burning section under it, and a burning rig drops
fire back on the deck. Chain-shot damage to the sails does not help: torn
canvas burns just as well.

Fire damage per second: hull integrity of the burning section, sails and
rigging, and crew in that section at a rate that makes an unfought fire
kill more men than the guns do over five minutes. Guns in a burning section
cannot be served.

### 3.4 Magazine and fuse

Frigates carry the grand magazine forward below the waterline and a hanging
magazine aft. Two-deckers and the yacht follow the same rule. Sections BOW
and QUARTER are magazine sections.

- While a magazine section burns above 0.35 intensity, `magazineFuse`
  advances at 1 s/s, faster the hotter the fire. Below that it cools back at
  0.5 s/s.
- Fuse length: 90 s for a frigate, 120 s for a ship of the line, 45 s for
  the sloop. The HUD shows the fuse as a red bar, the AI sees it too.
- At the end of the fuse the ship explodes. There is no random early
  detonation: the player must always be able to see it coming.
- `floodMagazine` order: takes 30 s to complete (the powder is soaked), then
  the fuse can no longer run. Guns reload from what is already on deck for
  one more broadside, then not at all. A flooded magazine cannot be
  un-flooded during the battle.

The decision this creates: keep firing and put everyone on the fire, pull
guns off the engaged side to fight it, or flood the magazine and try to
escape or board. That is the scarce-resource choice we want.

## 4. Explosion

### 4.1 Model

`DamageModel.explode()` sets `sunk`, emits `exploded` with the ship's
position and displacement, and the simulation applies a blast to every ship
within a radius that scales with displacement (about 250 m for a frigate):

- `applyRam`-style structural damage to the facing side, falling off with
  distance squared.
- A fire ignition roll on the facing sections.
- Crew casualties on deck and in the rig, plus `crew.shock(0.6)`.
- Masts: a hard blast within 100 m brings down a topmast.

The exploding ship's wreckage stays as a debris field for a minute so the
survivors sail through it.

### 4.2 Client animation

A dedicated `Explosion` effect in the client, driven by the `exploded` event
and independent of the ship model's normal sinking:

1. **t = 0 s.** White flash that overexposes the frame for two frames.
   Camera shake proportional to proximity. All audio ducks.
2. **t = 0 to 0.4 s.** Fireball expanding from the magazine section to
   twice the ship's length, additive-blended sprites, orange to black.
3. **t = 0.1 s.** Shockwave: an expanding ring on the water surface with a
   spray sheet, and a pressure ring in the air that bends the smoke.
4. **t = 0.2 to 1.5 s.** The hull breaks at the magazine section. The two
   halves are the existing hull mesh split at a plane, each thrown outward
   with its own rotation. Masts, yards and guns are detached and launched
   as ballistic debris through the existing debris field, with burning
   pieces trailing smoke.
5. **t = 1 to 8 s.** Debris rain: several hundred pieces come down over the
   blast radius with splashes, and burning debris keeps burning on the
   water. Nearby ships get hit visually where the blast hit them in the
   model.
6. **t = 2 to 40 s.** Smoke column rising several hundred metres, drifting
   with the wind, thinning over a minute. The two hull halves settle and
   sink over 30 s.
7. **Sound.** A close detonation, a delayed distant one for far viewers
   (speed of sound: 3 s per kilometre), then the rain of debris.

Performance budget: one instanced mesh for debris, one for sprites, no per-
piece lights. Test in the browser smoke test that the effect spawns and is
cleaned up.

## 5. Protocol and server

- `InputCommand.orders?: Partial<CrewOrders>`. The input queue folds orders
  like `cutWreck`: the last order wins. `BattleRoom` validates ranges.
- `ShipState` gains: `crewGunsPort`, `crewGunsStbd`, `crewSails`,
  `crewPumps`, `crewFire`, `crewReserve` (head counts), `fireBow`,
  `fireMid`, `fireQuarter` (port and starboard folded to the max for the
  HUD), `fireRig`, `magazineFuse`, `magazineFlooded`. Colyseus schema in
  `GameState.ts` mirrors these.
- Client-side prediction is unaffected: orders change reload, pump and fire
  rates, which the predictor does not simulate. The HUD shows server values.
- `ServerShip.step` runs the allocation solver before it reads
  `gunnery()`, `pumping()` and the new `firefighting()`.
- AI captain: a small rule set. Fire above 0.2 anywhere: fire party preset.
  Magazine fuse above half with fire party losing: flood the magazine.
  Flooding above 0.25: pumps preset. Otherwise engage on the side that
  bears. The captain's `skill` delays reactions.

## 6. Client

- **Orders panel.** The crew panel becomes an orders panel: one row per
  station with assigned hands, efficiency and a slider, plus the preset
  buttons. Keyboard: `O` toggles the panel, and while it is open `1` to `6`
  pick presets, `Shift+F` floods the magazine with a confirmation. `1` to
  `4` remain camera keys when the panel is closed.
- **HUD.** Fire intensity per section on the damage plan, a red magazine
  fuse bar with a countdown, a warning line while the fuse runs, and
  "MAGAZINE FLOODED, guns silent" afterwards.
- **Deck figures.** `crewview.js` already places figures by station. Fire
  party figures run with buckets between the pump and the burning section,
  and a hose from the fire engine. Stations empty when hands are moved.
- **Fire VFX.** Per-section flames and smoke attached to the hull model,
  scaled by intensity, replacing the single `setFire` today. A burning rig
  lights up the sails.

## 7. Implementation phases

Each phase ships on its own with tests green and the golden trace either
unchanged or regenerated with a stated reason.

1. **Crew stations and allocation** (shared). `CrewOrders`, the solver,
   `gunnery(side)`, station-based exposure, presets. The default preset
   reproduces today's numbers. Unit tests for the solver: full crew,
   shrinking crew, priorities, role matching.
2. **Located fire** (shared). `FireState`, ignition by wads and hits,
   spread, growth, crew-dependent extinguishing, fire casualties, the
   magazine fuse and flooding, `explode()` with blast on neighbours. Tests:
   a fire party wins against a small fire and loses against a large one,
   flooding stops the fuse, the blast damages a ship at 100 m and not at
   400 m, everything deterministic per seed.
3. **Protocol and server.** Input orders, state fields, validation, input
   queue folding, AI captain rules, headless tests for the whole loop.
4. **Client.** Orders panel and keys, HUD, deck figures, per-section fire
   VFX, the explosion effect, audio. Browser smoke test for the explosion.
5. **Balance and docs.** Tune fuse lengths, extinguish rates and wad
   ignition against the realistic reload and damage tuning. Update README
   and the in-game help. Move the balance cases from `tests/pending` that
   the new mechanic satisfies.

## 8. Risks and open questions

- **Single-player parity.** The client `Ship` class and the server
  `ServerShip` both drive the shared model. The allocation solver and fire
  logic must sit in `@quarterdeck/shared` so both paths stay identical.
- **State size.** About fifteen new float fields per ship in the Colyseus
  schema. Fine for the room sizes we have, but the damage-detail fields
  should stay in the rarely-changing block.
- **Rig fire and the pose.** A burning rig that drops a mast should reuse
  `_breakMast("fire")` so the wreck-alongside mechanics apply.
- **Fuse length.** 90 s may feel short with 60 s reloads. The intent is
  that the fuse always outlasts one full reload so the choice is real.
- **Boarding** is out of scope here but the marine station is designed so a
  later boarding mechanic can draw from it.
