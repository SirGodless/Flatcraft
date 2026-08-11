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
3. World generation (overworld, caves, nether)
4. Physics & collision
5. Inventory & crafting
6. Block interactions
7. Entities/mobs
8. Netcode: WebSocket transport, listen server & dedicated server
