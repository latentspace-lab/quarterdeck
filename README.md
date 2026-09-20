# Quarterdeck

A 3D sailing simulator in the browser. Sail a modern yacht or command a square-rigger of the Age of Sail — set canvas, fire broadsides, and watch masts topple overboard.

**[Play now](https://latentspace-lab.github.io/quarterdeck/)**

Built with Three.js and Vite. No imported meshes — every hull, mast and sail is procedural.

## What's in the game

- **Semi-realistic sailing physics** — apparent wind, polar curves, VMG, heel, capsize, leeway, luffing
- **Four factions** — Royal Navy, Marine Impériale, Armada Española, Pirates — each with three warships and distinct gunnery doctrine
- **Damage model** — masts fall and drag as wreckage, hulls breach, sails tear and blow away, leaks flood, fires spread, crews take casualties
- **Gerstner wave ocean** coupled to the physics — the boat rides the visible wave
- **Naval aquatint rendering** — the world drawn like a hand-coloured print from 1800
- **Three modes** — Freeride, Regatta (windward–leeward course with lap timing), Training (guided exercises)
- **Multiplayer** — Colyseus game server with client-side prediction and server-authoritative gunnery

## Quick start

```bash
npm run dev
```

Open **http://localhost:5173/quarterdeck/**

### Multiplayer

```bash
npm run server   # terminal 1 — game server on ws://0.0.0.0:2567
npm run dev      # terminal 2 — client
```

### Other commands

```bash
npm run build            # production build
npm run preview          # preview the build
npm run typecheck        # TypeScript check
npm run server:headless  # headless simulation benchmark
npm test                 # all tests (~700 checks)
```

## Controls

| Key | Action |
|-----|--------|
| **A/D** or **←/→** | Rudder |
| **W/S** | Trim sails (yacht) · Set/reef sails (square-rigger) |
| **Q/E** | Broadside port / starboard |
| **Z** | Ammo: round shot · chain · grape |
| **X** | Cut away wreck |
| **C** or **1–4** | Camera mode |
| **P** | Rendering style: aquatint / plain |
| **Space** | Right the boat after capsize |

## Project structure

```
packages/
  shared/    # @quarterdeck/shared — physics, ballistics, damage, crew (pure TS, no renderer)
  server/    # @quarterdeck/server — Colyseus game server
  client/    # @quarterdeck/client — Three.js renderer, input, HUD
tests/
  unit/         regression/         integration/
```

## License

[GNU General Public License v3.0](LICENSE)
