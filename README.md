# ⛵ Quarterdeck — Browser-based

**Quarterdeck** is a playable 3D sailing simulator in the browser, built with **Vite + Three.js**.
Pure 3D visuals (water shader, waves, sky, sun, clouds, ship with masts & sails)
and **semi-realistic sailing physics**: apparent wind, points of sail (TWA/point-of-sail),
polar curve, VMG, yaw (heel), capsize, luffing — plus **three game modes**.

You can sail either a modern yacht or one of **three square-riggers of the
Royal Navy** from the Hornblower era — all the way up to the 74-gun ship of
the line, broadsides included. In **Battle** mode a French opponent sits to
windward, and the ships actually take damage: masts fall overboard and drag
alongside as wreckage, leaks below the waterline can only be pumped out to a
limited degree, and wood splinters, spars, and sail fragments drift away as
proper rigid bodies.

> "3D visuals" in the sense of 3D graphics: a real 3D scene with WebGL, not a top-down map.

---

## Quick start

```bash
npm run dev
```

Then open in the browser: **http://localhost:5173/**

```bash
npm run build     # production build → packages/client/dist
npm run preview   # test the build → http://localhost:4173/
npm run typecheck # check TypeScript in shared/ and server/
npm run server    # game server (Colyseus) on ws://0.0.0.0:2567 — PORT/HOST override
npm run server:headless  # run a simulation without browser or socket, print timings
npm test          # all test levels
```

### Multiplayer

```bash
npm run server   # terminal 1: game server on ws://0.0.0.0:2567
npm run dev      # terminal 2: client on http://localhost:5173/quarterdeck/
```

In the menu choose **Multiplayer**: the open rooms on the server are listed
(name, players, AI enemies, wind) with a Join button each. Or pick a ship and
press Join to enter any open room — or create one, with the room name, wind
and the AI enemies from the scenario cards. **Regatta** rooms race the
windward-leeward course: the server judges the line, the marks and the laps
for every boat. **Practice** creates a private one-seat room against the AI
on the server. Deep link:
`http://localhost:5173/quarterdeck/?mp=1&server=ws://localhost:2567&vessel=lydia&name=Hornblower&enemies=amelie&roomName=Trafalgar`
(`&mode=practice` for a practice room, `&room=<id>` to join a specific one).

What is shared: ships, wind, sea, damage, masts, collisions, grounding and
gunnery come from the server. Q/E/F order a broadside; the server fires it,
every client plays the salvo, the balls (with the server's exact ballistics)
and the hits. The helm is predicted: your ship answers the rudder at once,
and every acknowledged server state is replayed with the inputs the server
has not seen yet - the two agree to the centimetre unless something the
server alone knows (a collision, the ground) intervened, and then the
picture eases onto the corrected place instead of jumping.

> **Important:** always run commands **without** a trailing comment.
> In zsh, `#` is *not* a comment character interactively by default — `npm run dev  # → ...`
> passes `#`, `→`, `http://...` as arguments to vite and the start aborts with
> `Unused args`.

> The dependencies `three` + `vite` are already present in `node_modules/`.
> If `npm install` complains about the global npm cache (EPERM), redirect the
> cache locally: `npm install --cache "$(pwd)/.npmcache" three vite`.

---

## Controls

| Key | Action |
|-------|--------|
| **A / D** or **← / →** | Rudder — port / starboard (change course) |
| **W / S** | Yacht: trim sails · Square-rigger: **set / reef** sails |
| **Q / E / F** | Broadside **port** / **starboard** / **both** |
| **Z** | Switch ammunition: round shot · chain shot · grapeshot |
| **X** | Cut away wreck (get rid of a fallen mast) |
| **V** | Switch ship (without a detour through the menu) |
| **Mouse wheel / drag** | Zoom / view — up close you can see the crew working |
| **C** or **1–4** | Camera: **1** chase · **2** cockpit · **3** top-down · **4** orbit |
| **M / Esc** | Menu / pause |
| **R** | Reset course (Regatta) / exercise (Training) |
| **G** | Wind gusts & veer on/off |
| **H** | HUD on/off |
| **P** | Rendering style: aquatint / plain (see below) |
| **Space** | Right the boat after a capsize |
| **Mouse wheel** | Zoom · **Drag mouse** | Rotate view |

> **Basic rule:** you steer the **course** (the rudder). From that follows the
> **point of sail (TWA)** to the wind and therefore the speed — the classic
> "point-and-go" of sailing physics.

---

## The three game modes

1. **Freeride** — Sail freely on the open sea, experience the wind, practise manoeuvres.
2. **Regatta** — A **windward-leeward course** (start line → windward mark →
   leeward mark → finish line). Lap timing + best time, progress,
   distance & compass bearing to the next mark.
3. **Training** — A sequence of **exercises** (holding trim, upwind VMG,
   tacking/gybing, reaching, yawing, avoiding capsize, reaching a mark)
   with a progress bar.

---

## The factions

You choose the **flag** first, then the ship. The faction determines which
ships are available, how they look, how good the gun crews are —
and who you'll be facing.

| Faction | Ships | Character |
|--------|---------|----------|
| **Royal Navy** | Hotspur · Lydia · Sutherland | Best gunnery training in the world. Fires into the **hull** and takes the enemy. |
| **Marine Impériale** | Hirondelle · Amélie · Vengeur | Built bigger and faster. Fires into the **rigging** to disengage. |
| **Armada Española** | Descubierta · El Gamo · San Juan Nepomuceno | Frames like cathedral pillars — absorbs the most punishment, fires the slowest. |
| **Pirates** | Seeteufel · Rache · Schwarze Krone | Everything captured: thin-skinned, fast, a huge boarding crew, poor gunners. **Never strike the flag.** |

Each faction offers a ship in three size classes: corvette/sloop, frigate,
ship of the line. Battle scenarios are defined by these classes, not by
fixed ships — so any scenario works with any pairing. Whoever goes into a
single-ship duel as the Spanish gets a British ship of equal size across the bow.

The yacht *Nordwind* is available in every faction as a training boat.

Each faction flies its own flag (White Ensign, Tricolore, the Spanish
red-yellow-red, the skull and crossbones) and wears its own paint scheme — the
Nelson checkerboard in ochre, the French red strake, Spanish dark red with
yellow, and for the pirates weathered black with whatever the previous owner
had painted on. In the powder smoke you can tell friend from foe at a glance.

---

## The ships

The ship is chosen in the start menu (and in-game with **V**, within your own
faction). Each has its own polar curve, no-go zone, turn rate, inertia and
heeling tendency — the differences are noticeable, not cosmetic.

Royal Navy example (the other factions correspond):

| Ship | Rate | LOA | Close-hauled | Broadside | Character |
|--------|------|-----|---------|-----------|-----------|
| **Nordwind** | Bermuda sloop | 11 m | 32° | — | Light, points high, turns on a dime |
| **HMS Hotspur** | 20-gun sloop-of-war | 28 m | 62° | 90 lb | Smallest square-rigger, nimble and thin-skinned |
| **HMS Lydia** | 36-gun frigate | 43 m | 65° | 234 lb | The classic Hornblower ship |
| **HMS Sutherland** | 74-gun two-decker | 52 m | 68° | 700 lb | Sluggish as a church, two decks of iron |

### Why a square-rigger feels different

- **It won't point high into the wind.** At around **six points** (62–68°
  depending on the ship) that's it; below that the sails go back and the
  ship loses way. That's not arbitrary — it follows directly from bracing
  the yards (see below).
- **Its fastest point of sail lies further aft.** While the yacht sails
  best on a beam reach (~105°), for square-riggers it's the **broad reach**
  at ~140°.
- **Mass means inertia.** The frigate needs a good two minutes to reach full
  speed, the ship of the line even longer. Luffing up, bearing away and
  tacking take time — you have to think ahead. When passing through the
  wind, the ship keeps "way on," otherwise it would never come round.
- **It practically never capsizes.** Wide hull, plenty of ballast: even at
  34 kn the frigate stays stiff. In exchange it makes noticeably more leeway.
- **W / S sets and reefs the sails.** Less canvas means less speed, but also
  less heel — the right answer in a storm.

### Bracing the yards (why the yards sit the way they do)

The yards turn with the apparent wind according to the rule

```
yard angle = 90° − |AwA| / 2,   capped at 45°
```

Running before the wind (AwA 180°) the yards sit **square**, on a beam reach
(90°) they're braced **hard up** at 45° — the rigging can't be braced any
sharper than that. This exact limit is the physical reason for the large
no-go zone: below about 65° AwA the sail can no longer be trimmed to draw and
goes back. The windward yardarm swings aft, and the canvas bellies to leeward.

### The guns

**Q** fires the port, **E** the starboard, **F** both broadsides.

- The gun crews fire **in sequence** — the thunder rolls from bow to stern.
- Each gun produces muzzle flash, a powder cloud and a ball that falls
  ballistically and raises a **splash plume** on impact.
- The smoke **drifts with the wind**: to leeward you're quickly standing in
  your own powder smoke.
- The recoil gives a brief **heeling jolt** to the opposite side, the guns
  run back and are run out again.
- **Reloading** takes 60 s (sloop, frigate) to 75 s (ship of the line), per
  side separately; French crews need 80 to 100 s.
  The bar in the HUD shows the progress.

---

## Battle and damage

In **Battle** mode you additionally choose the scenario: single-ship duel,
outnumbered (two opponents), or against a ship of the line. The opponent is
AI-controlled and can only do what the player can do — it doesn't sail against
the wind and doesn't exceed its own polar curve.

### Ammunition (key **Z**)

| Charge | Effect | Range |
|--------|---------|-----------|
| **Round shot** | Punches through the hull, dismounts guns, opens leaks | full (~550 m) |
| **Chain shot** | Mows down rigging and sails, leaves the hull intact | short (~300 m) |
| **Grapeshot** | A swarm of small balls, sweeps the deck and the gun crews | very short (~150 m) |

The Royal Navy fired at the **hull** (beat the enemy down), the French navy
prefers the **rigging** (disable and get away). Both doctrines are built into
the AI and lead to noticeably different battles.

### Why so little hits at range

The guns are aimed at an **estimated** range, and the estimation error grows
with distance. On top of that comes the roll at the moment of firing — one
degree of roll is already a whole ship's length off at 400 m. That's why guns
were historically fired "on the roll," and that's why the hit rates look like
this:

| Range | Round shot | Chain shot | Grapeshot |
|-----------:|----------:|------------:|-----------:|
| 50 m | ~100 % | ~100 % | ~95 % |
| 200 m | ~66 % | ~99 % | ~85 % |
| 300 m | ~36 % | ~98 % | ~20 % |
| 600 m | ~11 % | — | — |

### What can be destroyed

- **Hull** — six sections (bow/mid/stern × port/starboard). A ship is
  finished once *one* side is breached. Hull thickness scales with size:
  what punches through a sloop bounces off a two-decker. In the HUD a
  **hull plan** shows each section individually — an average across the
  whole hull would hide exactly what matters: *where* it was hit. A
  broadside shot to pieces is a different thing from even wear. The three
  masts and the rudder sit as their own markers in the same plan, with
  condition shown in percent.
- **Leaks below the waterline** — the pumps keep a few in check, but not
  many. Water in the ship costs speed, lists her over and eventually sinks her.
- **Masts** — **topple** overboard: the broken mast stays attached at its
  foot in the standing rigging, pivots around its step over the side, hits
  the water and lies flat there. It then hangs alongside as a **12-tonne
  wreck**: the ship slows down and constantly pulls toward the wreck side,
  until **X** cuts the shrouds away.
- **Crew** — casualties at the guns, in the rigging and at the pumps (see
  above). It's the fourth system alongside hull, rig and rudder. It's not
  only gunfire that costs lives: a **mast going overboard** takes the
  topmen in its shrouds with it, and falling spars sweep the deck. A
  collision and running aground do the same. On top of that comes
  **shock** — after such an event morale drops and only recovers slowly.
- **Sails** — first tear, then blow away. As canvas condition drops,
  **individual cloths burst open**: real holes appear in the fabric, the
  edges sag and flog. Once enough is gone, the sail blows **out of its
  boltropes** and drifts away to leeward in several flapping strips. The
  upper sails go first — that's where most of the wind is, and that's
  where chain shot is aimed; the lower sails hold out the longest.
- **Rudder** — hits astern cost you course control.
- **Battery** — dismounted guns visibly shrink your own broadside (they
  disappear from the gunports).
- **Fire** — spreads, eating through canvas and rigging; in the extreme
  case the ship blows up.
- **Striking the flag** — a beaten opponent doesn't fight to the sinking.

### Not just cannonballs: forces

- **Too much canvas in a storm.** Dynamic pressure scales with the square
  of wind speed. Full sail holds up to about 30 kn; at 34 kn the topmasts
  go overboard after a few minutes, at 42 kn in seconds. Reefed, she can
  take it — that's exactly what **W / S** is for.
- **Collisions.** Hulls are approximated as a chain of three circles. On
  impact, momentum and damage are computed from closing speed and
  displacement; at low-speed contact the ships tangle in each other's rigging.
- **Running aground.** The seabed is an analytical function — the same one
  the visible terrain is built from. So you can never run onto something
  you can't see. The surf over the reefs is the warning.

### The wreckage

`debris.js` is a small, self-contained rigid-body simulation (no physics framework):

- **Gravity** acts at the centre of mass — so it produces no torque.
- **Buoyancy** follows Archimedes, but is **distributed over sample points
  along the body**. That's exactly where the torque comes from: as long as
  a mast stands upright, its centre of buoyancy sits below its centre of
  mass — an unstable equilibrium. It topples over until it lies flat in
  the water, entirely on its own. With a single buoyancy point every mast
  would stay upright like a spar buoy; that was the first attempt, and it
  looked exactly as wrong as it sounds.
- Oak (720 kg/m³) floats, pine floats well, a cannon barrel sinks at once.
- **Quadratic water drag** at each sample point individually — which also
  damps the toppling motion.
- **Free rotation** with quaternion integration; in the air, angular
  momentum is essentially conserved.
- **Tether constraint** for fallen masts: acts at the mast foot, with the
  correct effective mass at the point of application, so the constraint
  doesn't blow up.

---

## Sea state

The sea depends on the wind, and **quadratically** so. Per Pierson-Moskowitz,
for a fully developed sea `Hs = 0.21 · U² / g` — so doubling the wind means
roughly four times the wave height:

| Wind | Significant height | Sea state |
|-----:|------------------:|------------|
| 5 kn | 0.1 m | calm |
| 12 kn | 0.8 m | slight |
| 20 kn | 2.3 m | moderate |
| 30 kn | 5.1 m | rough |
| 35 kn | 6.9 m | very rough |

**Wavelengths** also grow with the wind — but only with the square root, not
linearly. Otherwise the sea would get high but so gently sloped that it would
look like a smooth swell. This way it stays steep: a storm sea is steep.

What really tells you the wind strength, though, are the **whitecaps**. They
begin at Bft 4 and cover more of the sea as the wind increases — at Bft 6 it's
speckled white across the surface, at Bft 8 it's continuous. Without them,
even a 3.5 m sea looks flat, because the eye has no sense of scale.

Two details that make the difference:

- **The sea follows the wind only sluggishly.** It builds up over roughly a
  minute and subsides more slowly again. Otherwise every gust would make the
  waves pulse.
- **The shader and the physics compute the same surface.** The wavelength
  stretching runs on an accumulated phase time rather than the clock, or the
  whole wave field would jump the moment the wind changes.

---

## The crew

A ship of this era is nothing without its people. The crew is therefore not
just a decorative number — it feeds into all three systems: guns, sails, pumps.

| Role | Share | What they're needed for |
|-------|-------:|--------------------------|
| Officers & helmsmen | 7 % | rudder effectiveness, chain of command, morale |
| Gun crews | 49 % | how many guns are served and how fast |
| Topmen | 22 % | setting and reefing sails |
| Marines | 11 % | musket fire, repelling boarders |
| Carpenters & pumps | 6 % | plugging leaks, pumping out water |
| Powder boys | 5 % | resupplying the battery |

**Casualties.** The big killer aboard wasn't the ball itself but the hail of
wood splinters it tore out of the hull — and at close range, grapeshot. Where
a hit lands decides who it gets: splinters off the hull hit the gun crews,
grapeshot sweeps the open deck, chain shot takes topmen out of the rigging.
About a third of those hit are killed outright, the rest go below wounded and
are just as much out of action. A hard-fought frigate action costs 5–20 % of
the crew this way.

**Consequences.** Fewer gun crews means fewer guns served and slower
reloading. Fewer topmen means sluggish sail handling. Fewer carpenters means
the pumps can no longer keep up with the water. And when casualties and loss
of leadership combine, **morale** breaks — a bled-out ship strikes its flag
even if the hull is still standing.

**On deck** they're really there: `crewview.js` populates the stations with
figures — gun crews at every gun, running out and stepping back in time with
the reload, topmen in the shrouds when sails are handled, a helmsman at the
wheel, carpenters at the pumps (who work faster the more water is in the
ship), powder boys running back and forth between the hatch and the battery.
Anyone who has fallen no longer stands there. The whole crew costs two draw
calls (two InstancedMeshes).

---

## The physics (semi-realistic)

At the core (see `src/physics.js`, fully testable under `tests/`):

- **True Wind Angle (TWA)** from the boat's course and wind direction — with
  sign (port/starboard tack). No sailing directly into the wind (no-go zone
  < 32° → **luffing**).
- **Apparent wind (AwA)** = composition of true wind and boat speed
  (vector addition).
- **Polar curve**: boat speed as a function of TWA & wind strength
  (Beaufort-scaled). Beam reach (~90°) is the fastest point of sail; optimal
  upwind VMG sits at ~45° TWA.
- **VMG** (Velocity Made Good): upwind and downwind progress, visible in the HUD.
- **Yaw (heel)** — increases with wind and upwind angle; at extreme wind →
  **capsize** (automatic righting, or with the space bar).
- **Leeway**, **rudder authority** (speed-dependent), **luffing** with bow pressure.
- **Wind** with gusts & veer (fluctuating strength/direction), adjustable.

### 3D water & boat (coupled to the wind physics)

- **Gerstner wave ocean** (`ocean.js`): real trochoidal waves with horizontal
  displacement — sharp crests, flat troughs, 6 superimposed wavelengths whose
  travel direction follows the **wind direction**. Wave height scales with
  wind strength. JS and GLSL use the same wave table → the boat sits
  **exactly** on the visible wave (buoyancy, pitch & roll from the actual
  wave slope). Shading: Fresnel sky reflection, sun glitter, scattered light
  through the crests, foam on squeezed wave peaks (Jacobian determinant),
  horizon haze.
- **Wind-responsive sails** (`boat.js`/`game.js`): the **boom angle follows
  the apparent wind** — close-hauled almost on the centreline, eased out on
  reaches, square to the wind running before it (±~90°), **always on the
  leeward side** (slams across on a tack/gybe). The mainsail hangs exactly
  off the swinging boom, the jib off its own sheet; the canvas bellies to
  leeward, fills out more on reaches, and luffs in the **no-go zone**.
- **True hull shape**: a hull lofted from station cross-sections with a
  pointed bow, a classic rub rail, a transom stern, a boot-top stripe and
  antifouling below the waterline; plus a fin keel with a bulb, rudder
  blade, forestay/backstay/shrouds, guardrail and cockpit.

### Rendering style: naval aquatint

By default the world is drawn like a hand-coloured naval aquatint of about
1800: muted washes, a fixed tonal grain, ink outlines on hulls and rigging,
paper tone and a mild plate vignette. Two layers make the look
(`packages/client/src/style.js` holds both palettes):

- **Scene palette.** Sky dome, fog, lights, sea colours (`ocean.js` reads them
  as uniforms), land and surf colours (`terrain.js`), sailcloth and the
  smoke/splash sprites all take their colours from the style's `world`
  palette. A teal-grey sky, an olive sea with cream crests and buff sails
  are already in the frame before any post-processing.
- **Aquatint pass** (`aquatint.js`). The scene is rendered into an off-screen
  target with a depth texture; one full-screen shader then draws the etched
  line (ink where the depth breaks between neighbouring pixels, fading with
  distance), pulls the value onto an ink → wash → paper ramp while keeping
  most of the chroma, adds a screen-fixed rosin grain that is heavier in the
  darks, paper fibre, a warm cast and the vignette. Nothing ends up pure
  black or pure white: the printer's ink and the paper are the limits.

The HUD keeps its see-through panes but wears the same period: a warm vellum
tint with the world washed sepia behind it, double ink rules, the IM Fell
English typeface (SIL Open Font License, bundled in `public/fonts/`), an
engraved 16-point compass rose and verdigris / ochre / oxblood for good /
worn / critical. All colours are CSS tokens on `:root`; the
`[data-style="plain"]` block restores the previous look.

The **plain** style is the unprocessed modern rendering, useful for
comparison and as a fallback on weak GPUs. Switch with the **P** key, with
`?style=plain` (or `?style=aquatint`) in the address, or by the stored
preference (`localStorage["quarterdeck.style"]`, written whenever you press P).
In the plain style the frame goes straight to the canvas, so it renders
exactly as before the aquatint work.

---

## Project structure

Since Phase 0 of the multiplayer conversion ([Issue #23](https://github.com/latentspace-lab/quarterdeck/issues/23))
the project has been laid out as an npm workspace. The dividing line is
strict: `shared/` holds pure logic with no DOM and no renderer, `client/`
holds everything visible.

```
quarterdeck/
├─ packages/
│  ├─ shared/            # @quarterdeck/shared — pure logic (TypeScript, no Three.js renderer)
│  │  └─ src/
│  │     ├─ utils.ts         # angles, interpolation, approach() (dt-invariant smoothing)
│  │     ├─ rng.ts           # mulberry32, derived streams, gauss()
│  │     ├─ timestep.ts      # SIM_DT (30 Hz) + accumulator for the game loop
│  │     ├─ types.ts         # protocol: ShipState, SeaSync, InputCommand, WorldParams
│  │     ├─ physics.ts       # sailing physics, BoatDynamics (fixed step)
│  │     ├─ wind.ts          # wind — a pure function of simulation time
│  │     ├─ ocean-math.ts    # Gerstner waves, SeaState (lagging sea state + phase)
│  │     ├─ terrain-math.ts  # sea chart from a seed: World, depth, reefs
│  │     ├─ pose.ts          # hull attitude on the wave + interpolation for rendering
│  │     ├─ ballistics.ts    # trajectory, salvo fire, hit testing
│  │     ├─ damage.ts        # structural model: hull, masts, rudder, leaks, fire
│  │     ├─ crew.ts          # crew: roles, casualties, effect on all systems
│  │     ├─ collide.ts       # ship vs ship, running aground
│  │     ├─ vessels.ts       # ship catalogue: mass, polar curves, dynamics, batteries
│  │     └─ factions.ts      # factions: doctrine, training level, flag
│  │
│  ├─ server/            # @quarterdeck/server — the game server (Colyseus 0.18)
│  │  ├─ src/index.ts        # startServer(): HTTP + WebSocket transport, room registry
│  │  ├─ src/rooms/BattleRoom.ts  # clients -> ships, messages -> inputs, tick -> patches
│  │  ├─ src/state/GameState.ts   # synchronised schema: ships, wind, sea, tick
│  │  ├─ src/sim/Simulation.ts    # one room's world: wind, sea, ships, guns, collisions, grounding
│  │  ├─ src/sim/ServerShip.ts    # a ship without Three.js: dynamics, damage, crew, guns, pose
│  │  ├─ src/sim/ServerBattery.ts # the deciding half of a battery: salvo, flight, hit test
│  │  ├─ src/sim/Captain.ts       # AI captain (port of the client's fleet.js)
│  │  └─ src/headless.ts          # CLI: run a simulation headless and print timings
│  │
│  └─ client/            # @quarterdeck/client — browser: Three.js, input, HUD
│     ├─ index.html
│     ├─ vite.config.js
│     └─ src/
│        ├─ main.js          # game loop: fixed simulation, free-running rendering
│        ├─ game.js          # stepFixed() (simulation) + render(alpha) (frame)
│        ├─ ship.js          # ship as a unit: model + motion + damage + battery
│        ├─ guns.js          # broadside RENDERING (ballistics live in @quarterdeck/shared)
│        ├─ ocean.js         # wave mesh and shader (math lives in @quarterdeck/shared)
│        ├─ terrain.js       # terrain mesh and surf (sea chart lives in @quarterdeck/shared)
│        ├─ scene.js         # scene: sky, sun, lights, clouds
│        ├─ boat.js          # 3D yacht: lofted hull, rig, wind-driven sails
│        ├─ warship.js       # 3D square-rigger: hull with gunports, masts, square sails
│        ├─ debris.js        # rigid-body simulation of the wreckage (buoyancy, spin)
│        ├─ fleet.js         # opponents and their captains (doctrine, manoeuvres, fire)
│        ├─ crewview.js      # the people on deck (two InstancedMeshes, animated)
│        ├─ fx.js            # shared effect textures (smoke, fire, holes)
│        ├─ camera.js        # camera direction (4 modes + mouse orbit)
│        ├─ controls.js      # keyboard/mouse controls
│        ├─ marks.js         # regatta course: marks, start & finish line, laps
│        ├─ trainer.js       # training challenges (edge & timing logic)
│        ├─ ui.js            # 2D HUD + 2D compass + menu + training panel
│        ├─ audio.js         # voice announcements per nation
│        ├─ styles.css       # look and feel
│        └─ physics.js …     # re-exports from @quarterdeck/shared (legacy import paths)
└─ tests/                # see below
```

### Fixed simulation rate

The simulation runs at **30 Hz** (`SIM_DT`), while rendering happens at
screen refresh rate. `main.js` accumulates elapsed time and dispenses it in
whole steps; the remainder (`alpha`) interpolates ship poses between the last
two steps.

The reason isn't elegance, it's necessity: the physics contains smoothing
terms, and `f(dt₁)` followed by `f(dt₂)` is not the same as `f(dt₁+dt₂)`.
Client-side prediction, however, requires exactly that — the client
re-simulates inputs the server has already simulated. That's why, since
Phase 0B', there is only **one** smoother for rudder smoothing, and it lives
in `BoatDynamics.step()`.

---

## Tests

Three levels, because they answer different questions.

```bash
npm test                  # everything (build + 699 checks, ~60 s)

npm run test:unit         # one module, one assertion       (~0.1 s)
npm run test:regression   # what must never change           (~0.2 s)
npm run test:integration  # several modules over time         (~55 s)
npm run test:pending      # plus the open cases

node tests/run.js ocean ballistics   # only suites whose path contains this
node tests/unit/pose.test.js         # one suite directly, without the runner
```

| Level | What it checks |
|---|---|
| `tests/unit/` | Individual modules: angles, randomness, accumulator, waves, sea chart, hull attitude, ballistics, damage, crew, sailing physics. Fast and deterministic — if something breaks here, you know immediately where. |
| `tests/regression/` | The guarantees the multiplayer rework stands on: **dt-invariance**, **determinism** (same seed → same battle, including a run with `Math.random` disconnected) and a **golden trace** against `tests/fixtures/golden-trace.json`. |
| `tests/integration/` | Several modules over time: sailing, ships and rig, geometry, a full battle, the headless simulation and render interpolation. Plus a **boot smoke test** that launches the built game in Chromium — it catches missing imports that no module test would see. |
| `tests/pending/` | Cases for functionality that doesn't exist yet. Only runs with `--pending` and doesn't count against the exit code. |

Re-record the golden trace — only when the change is intentional:

```bash
node tests/regression/golden-trace.test.js --update
```

The boot smoke test needs a build and Chromium
(`npx playwright install chromium`); if either is missing, it skips itself.
Everything else runs on plain Node.

---

## Extensible

- **Sail types** (genoa, spinnaker): new sail meshes in `boat.js`, trim behaviour in `physics.js`.
- **Course variants**: `marks.js` — extend the `legs[]` array (e.g. offset mark, gate crossing).
- **Training**: `trainer.js` — new challenge objects `{title,desc,dur,ok(edge)}`.
- **Weather**: raise `variability/gust/veer` in `wind.js`; sun/Beaufort in `scene.js`.
- **Polar curve**: adjust `POLAR_15KTS` in `physics.js`.
- **New ship**: an entry in `VESSELS` (`vessels.js`) — hull dimensions, polar
  curve, `noGo`, dynamics and optionally `guns`. Rig `"square"` automatically
  builds a square-rigger, anything else builds the yacht. Menu, HUD, camera
  and trainer follow automatically.
- **Armament**: `guns.decks[]` — each deck gets a height (fraction of
  freeboard), number of guns per side, a longitudinal range and calibre.

---

## Notes / limitations (semi-realistic, deliberately simplified)

- All ships are lofted 3D hulls built from station cross-sections (procedural, no imported mesh).
- Wreckage pieces don't collide with each other or with the ships — they
  react to water, wind and gravity, but not to one another. For splinters,
  planks and drifting masts this is sufficient and saves a great deal of
  compute time.
- Impact holes in the **hull** are overlaid decals, not real holes in the
  geometry. The tears in the **sail cloth**, by contrast, are real: the
  affected triangles are pulled together there.
- Boarding is not implemented — the ships tangle together, nothing more happens.
- Leeway (drift) and rudder authority are simplified, but the **qualitative**
  behaviour (holding trim, tacking, yawing, VMG, capsize) is realistic.
- No wave-boat contact rendering (the boat "floats" at the computed water
  height, which exactly matches the water shader → no rising/falling at the waterline).

## License
Free to experiment with, modify and learn from.
