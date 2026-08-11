# FlatCraft

A 2D sandbox survival game for the browser. Original code, original name,
original basic-style art - inspired by the content scope of a certain
well-known block game up to its 1.16 era (nether biomes, piglins, netherite),
with no content beyond that point.

Required Notice: Copyright SirGodless (https://github.com/SirGodless)

Licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

## Status

Early scaffolding. Singleplayer core is being built first; the architecture
is multiplayer-ready from day one (see [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md)).

## Tech stack

- **TypeScript** everywhere - one language for simulation, client and server,
  so the deterministic game core is shared verbatim between browser and Node.
- **PixiJS** (WebGL/WebGPU) for fast 2D tile rendering.
- **Vite** for dev server and bundling.
- **Node.js** for the future headless dedicated server.
- npm workspaces monorepo, no further framework.

## Packages

| Package | Purpose |
| --- | --- |
| `@flatcraft/sim` | Deterministic tick-based game simulation. Pure logic: no DOM, no rendering, no wall clock, no `Math.random`. |
| `@flatcraft/server` | Authoritative server loop (`GameServer`) + transport abstraction. Embedded in the client for singleplayer/hosting, reused by the dedicated server. |
| `@flatcraft/client` | Browser client: PixiJS rendering, input, UI. Talks to the game exclusively through a `ClientConnection`. |
| `@flatcraft/dedicated` | Headless Node entry point for the future standalone server. |

## Development

```sh
npm install
npm run dev        # start the client (Vite) at http://localhost:5173
npm run typecheck  # typecheck all packages
npm run build      # build all packages
```

## Roadmap

1. ~~Project scaffolding, architecture~~
2. ~~Tilemap/chunk system + rendering~~ (placeholder heightmap terrain, chunk streaming via commands/events, baked-chunk PixiJS rendering, camera + break/place)
3. ~~World generation: overworld~~ (biomes: desert/plains/forest/mountains, lakes, caves, ore veins, trees; nether comes with its own milestone later)
4. ~~Physics & collision~~ (AABB player physics: gravity, jumping, walking, tile collision; server-side reach + entity-blocking checks; interpolated rendering)
5. ~~Inventory & crafting~~ (36-slot inventory + hotbar, Minecraft-style block drops, recipes as datapack-style JSON files in `packages/sim/src/data/recipes/`, 2x2 anywhere / 3x3 needs a crafting table)
6. ~~Block interactions~~ (hold-to-mine with progress + crack overlay, Minecraft tool tiers/speeds, tier-gated drops; no durability by design)
7. ~~Furnace & full tool chain~~ (real crafting grid UI with cursor clicks, furnace block entity with fuel/cook ticking and its own screen, smelting recipes as JSON, iron/golden/diamond tools)
8. ~~Entities/mobs~~ (item entities with magnet pickup, zombies that chase and melee, wandering pigs, natural spawning, sword combat with knockback, hearts/fall damage/death drops/respawn)
9. ~~Day/night & dimensions~~ (24000-tick day cycle with night-time surface hostiles and daylight burning; nether dimension with its own worldgen, obsidian-frame portals lit by flint and steel, 1:8 coordinate scaling)
10. ~~Survival content~~ (skeletons/creepers/farm animals/zombified piglins, villagers with JSON-defined trades, chests + backpacks, background walls, JSON-defined structures with loot, potions/brewing, simplified enchanting, elytra gliding, world saving to IndexedDB)
11. ~~Fog of war~~ (360-degree raycast visibility with per-dimension exploration memory - explored areas stay dimly visible; the miner potion reveals ores through the fog. Currently disabled by default, turn on with `?fog`)
12. ~~Hunger & bow~~ (activity-driven hunger bar gating regeneration, food incl. furnace-cooked meats, bow + craftable arrows)
13. Netcode: WebSocket transport, listen server & dedicated server
