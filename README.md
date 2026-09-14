# ⛵ Sailing Simulator 3D — Web-based

A playable **3D sailing simulator** in the browser, built with **Vite + Three.js**.
Pure 3D visuals (water shader, waves, sky, sun, clouds, ship with masts & sails)
and **semi-realistic sailing physics**: apparent wind, points of sail (TWA),
polar curve, VMG, heel, capsize, luffing — plus **three game modes**.

You can sail either a modern yacht or one of **three square-rigged Royal Navy
vessels** from the Hornblower era — up to a 74-gun ship of the line,
including **broadsides**. In **Battle** mode a French opponent is to windward,
and ships take real damage: masts fall overboard and trail alongside as wreck,
leaks below the waterline can only be pumped out so fast, and splinters,
spars and sail scraps drift away as proper rigid bodies.

> "3D visuals" means 3D graphics: a real 3D scene with WebGL, not a top-down map view.

---

## Quick Start

```bash
npm run dev
```

Then open in the browser: **http://localhost:5173/**

```bash
npm run build     # Production build → packages/client/dist
npm run preview   # Test the build → http://localhost:4173/
npm run typecheck # Check TypeScript in shared/ and server/
npm run server    # game server (Colyseus) on ws://0.0.0.0:2567 — PORT/HOST override
npm run server:headless  # run a simulation without browser or socket, print timings
npm test          # all test levels
```

### Multiplayer

```bash
npm run server   # terminal 1: game server on ws://0.0.0.0:2567
npm run dev      # terminal 2: client on http://localhost:5173/sailing/
```

In the menu choose **Multiplayer**: the open rooms on the server are listed
(name, players, AI enemies, wind) with a Join button each. Or pick a ship and
press Join to enter any open room — or create one, with the room name, wind
and the AI enemies from the scenario cards. **Regatta** rooms race the
windward-leeward course: the server judges the line, the marks and the laps
for every boat. **Practice** creates a private one-seat room against the AI
on the server. Deep link:
`http://localhost:5173/sailing/?mp=1&server=ws://localhost:2567&vessel=lydia&name=Hornblower&enemies=amelie&roomName=Trafalgar`
(`&mode=practice` for a practice room, `&room=<id>` to join a specific one).

What is shared: ships, wind, sea, damage, masts, collisions, grounding and
gunnery come from the server. Q/E/F order a broadside; the server fires it,
every client plays the salvo, the balls (with the server's exact ballistics)
and the hits. The helm is predicted: your ship answers the rudder at once,
and every acknowledged server state is replayed with the inputs the server
has not seen yet - the two agree to the centimetre unless something the
server alone knows (a collision, the ground) intervened, and then the
picture eases onto the corrected place instead of jumping.

> **Important:** Always run commands **without** appended comments.
> In zsh, `#` is not a comment interactively by default — `npm run dev  # → ...`
> passes `#`, `→`, `http://...` as arguments to vite and the start aborts with
> `Unused args`.

> The dependencies `three` + `vite` are already in `node_modules/`.
> If `npm install` complains about the global npm cache (EPERM), redirect the
> cache locally: `npm install --cache "$(pwd)/.npmcache" three vite`.

---

## Controls

| Key | Action |
|-------|--------|
| **A / D** or **← / →** | Rudder — Port / Starboard (change course) |
| **W / S** | Yacht: trim sails · Square-rigger: **set / reef** sails |
| **Q / E / F** | Broadside **Port** / **Starboard** / **Both** |
| **Z** | Switch ammunition: Solid shot · Chain shot · Grape |
| **X** | Cut away wreck (release a fallen mast) |
| **V** | Switch ship (without going through the menu) |
| **Mouse wheel / drag** | Zoom / view — up close you can see the crew working |
| **C** or **1–4** | Camera: **1** Chase · **2** Cockpit · **3** Top-down · **4** Orbit |
| **M / Esc** | Menu / Pause |
| **R** | Reset course (Regatta) / exercise (Training) |
| **G** | Wind gusts & veer on/off |
| **H** | HUD on/off |
| **P** | Rendering style: aquatint / plain (see below) |
| **Space** | Right the boat after a capsize |
| **Mouse wheel** | Zoom · **Mouse drag** | Rotate view |

> **Basic rule:** You steer the **course** (the rudder). From that follows the
> **point of sail (TWA)** relative to the wind and thus the speed — the classic
> "point-and-go" of sailing physics.

---

## The Three Game Modes

1. **Freeride** — Sail freely on the open sea, experience the wind, practise manoeuvres.
2. **Regatta** — A **windward-leeward course** (start line → windward mark →
   leeward mark → finish line). Lap timing + best time, progress,
   distance & compass bearing to the next mark.
3. **Training** — A sequence of **exercises** (holding close-hauled, upwind VMG,
   tacking/jibing, broad reach, heeling, avoiding capsize, reaching a mark)
   with a progress bar.

---

## The Factions

First the **flag** is chosen, then the ship. The faction determines which
ships are available, what they look like, how well the crews are trained —
and who stands against you.

| Faction | Ships | Character |
|--------|---------|----------|
| **Royal Navy** | Hotspur · Lydia · Sutherland | Best gunnery training in the world. Shoots the **hull** and takes the enemy. |
| **Marine Impériale** | Hirondelle · Amélie · Vengeur | Built larger and faster. Shoots the **rigging** to break away. |
| **Armada Española** | Descubierta · El Gamo · San Juan Nepomuceno | Ribs like cathedral pillars — takes the most punishment, fires the slowest. |
| **Pirates** | Seeteufel · Rache · Schwarze Krone | Everything taken: thin-skinned, fast, huge boarding crew, miserable gunners. **Never strike the flag.** |

Each faction provides a ship in three size classes: corvette/sloop, frigate,
ship of the line. The battle scenarios are defined over these classes, not
fixed ships — so any scenario works with any pairing. A Spaniard entering a
duel gets a British ship of the same class to deal with.

The yacht *Nordwind* is available in every faction as a training boat.

Each faction flies its own flag (White Ensign, Tricolore, Spanish red-yellow-red,
the Jolly Roger) and wears its own paint — Nelson's chequer in ochre, the French
red strake, Spanish dark red with yellow, and for the pirates weathered black
with whatever the previous owner had painted on top. In the gun smoke you can
tell friend from foe at a glance.

---

## The Ships

The ship is chosen in the start menu (and in-game with **V**, within your own
faction). Each has its own polar curve, no-go zone, turn rate, inertia and
heeling tendency — the differences are felt, not cosmetic.

Example Royal Navy (the other factions accordingly):

| Ship | Rate | LOA | Close-hauled | Broadside | Character |
|--------|------|-----|---------|-----------|-----------|
| **Nordwind** | Bermuda sloop | 11 m | 32° | — | Light, points high, turns on a dime |
| **HMS Hotspur** | 20-gun sloop-of-war | 28 m | 62° | 90 lb | Smallest square-rigger, nimble and thin-skinned |
| **HMS Lydia** | 36-gun frigate | 43 m | 65° | 234 lb | The classic Hornblower |
| **HMS Sutherland** | 74-gun two-decker | 52 m | 68° | 700 lb | Sluggish as a church, two decks of iron |

### Why a square-rigger feels different

- **It doesn't point high.** At about **six points** (62–68° depending on the
  ship) that's it; any closer and the sails luff and the way runs off.
  This isn't arbitrary — it follows directly from bracing the yards (see below).
- **Its fastest course is further downwind.** While the yacht is fastest on a
  beam (~105°), for square-riggers it's a **broad reach** at ~140°.
- **Mass means inertia.** The frigate takes over two minutes to reach full
  speed, the ship of the line even longer. Luffing up, bearing away and tacking
  take time — you have to think ahead. When going through the wind the ship
  retains "way on" — otherwise she would never come about.
- **It practically doesn't capsize.** Broad hull, lots of ballast: even at 34 kn
  the frigate stays stiff. But she makes considerably more leeway.
- **W / S sets and reefs the sails.** Less canvas means less speed, but also
  less heeling — the right answer in a storm.

### Bracing the yards (why the yards sit the way they do)

The yards rotate with the apparent wind by the rule

```
yard angle = 90° − |AwA| / 2,   clamped to 45°
```

Before the wind (AwA 180°) the yards stand **square**, on a beam (90°) they are
at 45° **hard against the stop** — the rigging would brace no sharper. Exactly
this stop is the physical reason for the large no-go zone: below about 65° AwA
the sail can no longer be trimmed and falls aback. The weather yardarm goes aft,
the canvas bellies to leeward.

### The Guns

**Q** fires the port, **E** the starboard, **F** both broadsides.

- The crews fire **in sequence** — the thunder rolls from bow to stern.
- Each barrel produces muzzle flash, a powder cloud and a ball that
  falls ballistically and kicks up an **impact splash**.
- The smoke **drifts downwind**: to leeward you quickly stand in your own fog.
- The recoil gives a brief **heeling kick** to the opposite side, the guns
  run back and are run out again.
- **Reloading** takes 60 s (sloop, frigate) to 75 s (ship of the line), per side
  separately; French crews need 80 to 100 s.
  The bar in the HUD shows the progress.

---

## Battle and Damage

In **Battle** mode you additionally choose the scenario: single duel,
outnumbered (two opponents) or against a ship of the line. The opponent is
AI-controlled and can only do what the player can — it doesn't sail into the
wind and doesn't run faster than its polar curve.

### Ammunition (key **Z**)

| Load | Effect | Range |
|--------|---------|-----------|
| **Solid shot** | Pierces the hull, dismounts guns, opens leaks | full (~550 m) |
| **Chain shot** | Mows through rigging and sails, leaves the hull intact | short (~300 m) |
| **Grape** | Swarm of small balls, sweeps the deck and the crews | very short (~150 m) |

The Royal Navy shot at the **hull** (beat the enemy down), the French Navy
preferred the **rigging** (disable and escape). Both doctrines are in the AI
and produce noticeably different battles.

### Why almost nothing hits at range

The guns are aimed at an **estimated** range, and the estimation error grows
with distance. Add the roll at the moment of firing — one degree of roll at
400 m is a ship's width off. That's why gunners fired "on the roll", and that's
why the hit rates look like this:

| Range | Solid shot | Chain shot | Grape |
|-----------:|----------:|------------:|-----------:|
| 50 m | ~100 % | ~100 % | ~95 % |
| 200 m | ~66 % | ~99 % | ~85 % |
| 300 m | ~36 % | ~98 % | ~20 % |
| 600 m | ~11 % | — | — |

### What can break

- **Hull** — six sections (bow/midship/quarter × port/starboard).
  A ship is done when *one* side is torn open. Hull planking thickness scales
  with size: what punches through a sloop bounces off a two-decker.
  The HUD shows a **hull plan** with each section individually — an average over
  the whole hull hides exactly what matters: *where* she was hit. A shot-up
  broadside is different from even wear. The three masts and the rudder sit as
  separate markers in the same plan, with condition in percent.
- **Leaks below the waterline** — the pumps hold off a few, not many.
  Water in the ship costs speed, lays her on her side and sinks her in the end.
- **Masts** — **topple** overboard: the broken mast stays caught at its foot in
  the standing rigging, pivots on its track over the gunwale, hits the water
  and lies flat. Then it hangs as a **12-ton wreck alongside**: the ship becomes
  slow and constantly pulls toward the wreck side, until **X** cuts the shrouds.
- **Crew** — Losses at the guns, in the rigging and at the pumps
  (see above). It is the fourth assembly group alongside hull, rig and rudder.
  Not only gunfire costs men: a **mast going overboard** takes the topmen in its
  shrouds with it, and falling spars sweep the deck.
  A collision and a grounding too. Add the **shock** — after such an event morale
  collapses and recovers only slowly.
- **Sails** — first tear, then fly away. As the canvas condition drops,
  **individual panels burst open**: real holes appear in the sailcloth, the
  edges sag and flap. When enough is gone, the sail **blows out of the bolt ropes**
  and drifts downwind in several flapping panels. The upper sails go first —
  that's where the most wind is and where the chain shot goes; the lower sails
  hold the longest.
- **Rudder** — hits astern cost course control.
- **Battery** — dismounted guns visibly shrink your own broadside
  (they disappear from the gun ports).
- **Fire** — spreads, eats canvas and cordage; in the extreme case she
  blows up.
- **Striking the flag** — a beaten opponent doesn't fight to the sinking.

### Not just balls: forces

- **Too much canvas in a storm.** Stagnation pressure goes with the square of
  wind speed. Full sail holds to about 30 kn; at 34 kn the topmasts go overboard
  after a few minutes, at 42 kn in seconds. Reefed, they hold — that's what
  **W / S** is for.
- **Collisions.** Hulls are approximated as a chain of three circles. On impact,
  momentum and damage are calculated from approach velocity and displacement;
  at slow contact the ships foul in the rigging.
- **Grounding.** The seabed is an analytical function — the same one the visible
  terrain is built from. So you can never run aground on something you can't see.
  The surf over the reefs is the warning.

### The wreckage

`debris.js` is a small dedicated rigid-body simulation (no physics framework):

- **Gravity** acts at the centre of mass — so it produces no torque.
- **Buoyancy** per Archimedes, but **distributed over support points along the
  body**. That's where the torque comes from: as long as a mast stands upright,
  its centre of buoyancy sits below its centre of mass — an unstable equilibrium.
  It tips over until it lies flat in the water, all by itself. With a single
  buoyancy point every mast would stand upright like a spar buoy; that was the
  first approach and looked accordingly wrong.
- Oak (720 kg/m³) floats, pine floats well, a gun barrel sinks immediately.
- **Quadratic water drag** at each support point individually — which also damps
  the rotational motion.
- **Free rotation** with quaternion integration; in the air angular momentum is
  practically conserved.
- **Tether constraint** for fallen masts: acts at the mast foot, with correct
  effective mass at the attachment point, so the constraint doesn't oscillate.

---

## Sea State

The sea depends on the wind, **quadratically**. Per Pierson-Moskowitz for a
fully developed sea `Hs = 0.21 · U² / g` — double the wind means roughly four
times the wave height:

| Wind | Significant height | Sea state |
|-----:|------------------:|------------|
| 5 kn | 0.1 m | calm |
| 12 kn | 0.8 m | slight |
| 20 kn | 2.3 m | moderate |
| 30 kn | 5.1 m | rough |
| 35 kn | 6.9 m | very rough |

As the wind grows, so do the **wavelengths** — but only with the square root,
not linearly. Otherwise the sea gets high but so shallow-sloped that it looks
like a gentle swell. This way it stays steep: a storm sea is steep.

What really tells you the wind strength, though, is the **whitecaps**. They
set in at Beaufort 4 and cover the sea increasingly with rising wind — at
Beaufort 6 it's speckled white across the surface, at Beaufort 8 continuously.
Without them even a 3.5 m sea looks flat, because the eye lacks the scale.

Two details that make the difference:

- **The sea follows the wind only sluggishly.** It builds up over about a minute
  and subsides more slowly. Otherwise every gust would pulse the waves.
- **Shader and physics compute with the same surface.** The wavelength
  stretching runs over an accumulated phase time rather than wall-clock time,
  otherwise the whole wave field jumps the moment the wind changes.

---

## The Crew

A ship of this era is nothing without its people. The crew is therefore not
a number decoration, but tied into all three systems — guns, sails, pumps.

| Role | Share | What they're needed for |
|-------|-------:|--------------------------|
| Officers & helmsmen | 7 % | Rudder effect, chain of command, morale |
| Gun crews | 49 % | how many guns are served and how fast |
| Topmen | 22 % | setting and reefing sails |
| Marines | 11 % | Musket fire, boarding defence |
| Carpenters & pumps | 6 % | plugging leaks, pumping water |
| Powder boys | 5 % | supply to the battery |

**Losses.** The great killer aboard was not the ball itself, but the hail of
splinters it tore from the hull — and at close range, grape. Where a hit
strikes decides whom it gets: splinters at the hull hit the gun crews, grape
sweeps the open deck, chain shot takes topmen from the rigging. About a third
of those hit are killed, the rest go below wounded and still fall out.
A hard-fought frigate action thus costs 5–20 % of the crew.

**Consequences.** Missing gun crews means: fewer guns and slower reloads.
Missing topmen means: sluggish sail handling. Missing carpenters means: the
pumps can't keep up with the water. And when losses and loss of leadership
combine, **morale** breaks — a bled-out ship strikes its flag even if the hull
still holds.

**On deck** they actually stand there: `crewview.js` mans the stations with
figures — gun crews at each gun, running out and pulling back in the reload
rhythm, topmen in the shrouds when sails are being worked, a helmsman at the
wheel, carpenters at the pumps (who work faster the more water is in the ship),
powder boys running between hatch and battery. Who has fallen no longer stands
there. The whole crew costs two draw calls (two InstancedMeshes).

---

## The Physics (semi-realistic)

At its core (see `src/physics.js`, fully testable under `tests/`):

- **True Wind Angle (TWA)** from boat course and wind direction — with sign
  (Port/Stbd tack). No direct wind (No-Go zone < 32° → **Luffing**).
- **Apparent wind (AwA)** = composition of true wind and boat speed
  (vector addition).
- **Polar curve**: boat speed as a function of TWA & wind strength (Beaufort-scaled).
  Beam reach (~90°) is the fastest wind angle; optimal upwind VMG is at ~45° TWA.
- **VMG** (Velocity Made Good): up- and downwind progress, visible in the HUD.
- **Heel** — increases with wind and upwind angle; in extreme wind → **Capsize**
  (auto-righting, or with the space bar).
- **Leeway**, **rudder authority** (speed-dependent), **luffing** with bow pressure.
- **Wind** with gusts & veer (fluctuating strength/direction), adjustable.

### 3D Water & Boat (coupled to the wind physics)

- **Gerstner wave sea** (`ocean.js`): true trochoidal waves with horizontal
  displacement — sharp crests, flat troughs, 6 superimposed wavelengths whose
  travel direction follows the **wind direction**. Wave height scales with wind
  strength. JS and GLSL use the same wave table → the boat sits **exactly** on
  the visible wave (buoyancy, pitch & roll from real wave slope).
  Shading: Fresnel sky reflection, sun glitter, scatter light through the
  crests, foam at compressed wave peaks (Jacobian determinant), horizon haze.
- **Wind-correct sails** (`boat.js`/`game.js`): the **boom angle follows the
  apparent wind** — close-hauled nearly amidships, on reaches out, before the
  wind square (±~90°), **always on the leeward side** (swings across when
  tacking/jibing). Mainsail hangs exactly on the swivelling boom, the jib on
  its sheet; the canvas bellies to leeward, fills on reaches, flutters in the
  **No-Go zone**.
- **True hull form**: hull lofted from station cross-sections with a sharp bow,
  classic sheer line, transom stern, bootstripe band and antifouling below the
  waterline; plus fin keel with bulb, rudder blade, forestay/backstay/shrouds,
  railing and cockpit.

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
preference (`localStorage["segel.style"]`, written whenever you press P).
In the plain style the frame goes straight to the canvas, so it renders
exactly as before the aquatint work.

---

## Project Structure

Since Phase 0 of the multiplayer refactor ([Issue #23](https://github.com/latentspace-lab/sailing/issues/23))
the project is an npm workspace. The dividing line is strict: `shared/`
contains pure logic without DOM and without a renderer, `client/` everything
visible.

```
segel-simulator/
├─ packages/
│  ├─ shared/            # @segel/shared — pure logic (TypeScript, no Three.js renderer)
│  │  └─ src/
│  │     ├─ utils.ts         # Angles, interpolation, approach() (dt-invariant smoothing)
│  │     ├─ rng.ts           # mulberry32, derived streams, gauss()
│  │     ├─ timestep.ts      # SIM_DT (30 Hz) + accumulator for the game loop
│  │     ├─ types.ts         # Protocol: ShipState, SeaSync, InputCommand, WorldParams
│  │     ├─ physics.ts       # Sailing physics, BoatDynamics (fixed step)
│  │     ├─ wind.ts          # Wind — pure function of simulation time
│  │     ├─ ocean-math.ts    # Gerstner waves, SeaState (lagging sea state + phase)
│  │     ├─ terrain-math.ts  # Sea chart from a seed: World, depth, reefs
│  │     ├─ pose.ts          # Hull position on the wave + interpolation for the frame
│  │     ├─ ballistics.ts    # Trajectory, salvo launch, hit test
│  │     ├─ damage.ts        # Structure model: hull, masts, rudder, leaks, fire
│  │     ├─ crew.ts          # Crew: roles, losses, effect on all systems
│  │     ├─ collide.ts       # Ship vs. ship, grounding
│  │     ├─ vessels.ts       # Ship catalogue: mass, polar curves, dynamics, batteries
│  │     └─ factions.ts      # Factions: doctrine, training level, flag
│  │
│  ├─ server/            # @segel/server — the game server (Colyseus 0.18)
│  │  ├─ src/index.ts        # startServer(): HTTP + WebSocket transport, room registry
│  │  ├─ src/rooms/BattleRoom.ts  # clients -> ships, messages -> inputs, tick -> patches
│  │  ├─ src/state/GameState.ts   # synchronised schema: ships, wind, sea, tick
│  │  ├─ src/sim/Simulation.ts    # one room's world: wind, sea, ships, guns, collisions, grounding
│  │  ├─ src/sim/ServerShip.ts    # a ship without Three.js: dynamics, damage, crew, guns, pose
│  │  ├─ src/sim/ServerBattery.ts # the deciding half of a battery: salvo, flight, hit test
│  │  ├─ src/sim/Captain.ts       # AI captain (port of the client's fleet.js)
│  │  └─ src/headless.ts          # CLI: run a simulation headless and print timings
│  │
│  └─ client/            # @segel/client — Browser: Three.js, input, HUD
│     ├─ index.html
│     ├─ vite.config.js
│     └─ src/
│        ├─ main.js          # Game loop: fixed simulation, free rendering
│        ├─ game.js          # stepFixed() (simulation) + render(alpha) (frame)
│        ├─ ship.js          # Ship as a unit: model + dynamics + damage + battery
│        ├─ guns.js          # Broadside RENDERING (ballistics in @segel/shared)
│        ├─ ocean.js         # Wave mesh and shader (mathematics in @segel/shared)
│        ├─ terrain.js       # Terrain mesh and surf (sea chart in @segel/shared)
│        ├─ scene.js         # Scene: sky, sun, lights, clouds
│        ├─ boat.js          # 3D yacht: lofted hull, rigging, wind-driven sails
│        ├─ warship.js       # 3D square-rigger: hull with gun ports, masts, square sails
│        ├─ debris.js        # Rigid-body simulation of wreckage (buoyancy, spin)
│        ├─ fleet.js         # Opponents and their captains (doctrine, manoeuvre, fire)
│        ├─ crewview.js      # the people on deck (two InstancedMeshes, animated)
│        ├─ fx.js            # shared effect textures (smoke, fire, holes)
│        ├─ camera.js        # Camera direction (4 modes + mouse orbit)
│        ├─ controls.js      # keyboard/mouse controls
│        ├─ marks.js         # Regatta course: marks, start & finish line, laps
│        ├─ trainer.js       # Training challenges (edge & time logic)
│        ├─ ui.js            # 2D HUD + 2D compass + menu + training panel
│        ├─ audio.js         # voice announcements per nation
│        ├─ styles.css       # visuals
│        └─ physics.js …     # Re-exports from @segel/shared (old import paths)
└─ tests/                # see below
```

### Fixed simulation rate

The simulation runs at **30 Hz** (`SIM_DT`), rendering at display rate.
`main.js` collects elapsed time in an accumulator and dispenses it in whole
steps; the remainder (`alpha`) interpolates ship positions between the last
two steps.

The reason is not elegance but necessity: the physics contains smoothing
terms, and `f(dt₁)` followed by `f(dt₂)` is not the same as `f(dt₁+dt₂)`.
But client prediction demands exactly that — the client replays inputs the
server has already computed. That's why since Phase 0B' there is only **one**
smoother, and it sits in `BoatDynamics.step()`.

---

## Tests

Three levels, because they answer different questions.

```bash
npm test                  # everything (Build + 699 checks, ~60 s)

npm run test:unit         # one module, one assertion      (~0.1 s)
npm run test:regression   # what must not change      (~0.2 s)
npm run test:integration  # multiple modules over time        (~55 s)
npm run test:pending      # additionally the open cases

node tests/run.js ocean ballistics   # only suites whose path contains that
node tests/unit/pose.test.js         # one suite directly, without runner
```

| Level | What it checks |
|---|---|
| `tests/unit/` | Individual modules: angles, random, accumulator, waves, sea chart, hull position, ballistics, damage, crew, sailing physics. Fast and deterministic — if something falls over here, you know immediately where. |
| `tests/regression/` | The guarantees the multiplayer refactor stands on: **dt invariance**, **determinism** (same seed → same battle, including a run with `Math.random` clamped) and a **golden trace** against `tests/fixtures/golden-trace.json`. |
| `tests/integration/` | Multiple modules over time: sailing, ships and rig, geometry, a complete battle, the headless simulation and render interpolation. Plus a **boot smoke test** that starts the built game in Chromium — it catches missing imports that no module test sees. |
| `tests/pending/` | Cases for features that don't exist yet. Runs only with `--pending` and doesn't count against the exit code. |

Re-fixing the golden trace — only when the change is intended:

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
- **Weather**: `wind.js` `variability/gust/veer` increase; `scene.js` sun/Beaufort.
- **Polar curve**: adjust `POLAR_15KTS` in `physics.js`.
- **New ship**: entry in `VESSELS` (`vessels.js`) — hull dimensions, polar curve,
  `noGo`, dynamics and optional `guns`. Rigging `"square"` automatically builds
  a square-rigger, everything else the yacht. Menu, HUD, camera and trainer follow.
- **Armament**: `guns.decks[]` — each deck gets height (fraction of freeboard),
  number of guns per side, longitudinal range and calibre.

---

## Notes / Limitations (semi-realistic, deliberately simplified)

- All ships are lofted 3D hulls from station cross-sections (procedural, no imported mesh).
- Wreckage pieces don't collide with each other or with the ships — they
  react to water, wind and gravity, not to each other. For splinters,
  planks and drifting masts that's adequate and saves a lot of compute.
- Impact holes in the **hull** are applied decals, not real holes in the
  geometry. The tears in the **sailcloth** on the other hand are real: the
  affected triangles are contracted there.
- Boarding is not implemented — the ships foul, nothing more happens.
- Leeway (drift) and rudder authority are simplified, but the **qualitative**
  behaviour (luffing, tacking, heeling, VMG, capsize) is realistic.
- No wave-boat contact rendering (the boat "floats" on the computed water
  height, which exactly matches the water shader → no gaps at the waterline).

## License
Free to experiment, modify and learn.