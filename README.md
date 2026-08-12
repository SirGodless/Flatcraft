# FlatCraft

A 2D sandbox survival game for the browser. Original code, original name,
original basic-style art - inspired by the content scope of a certain
well-known block game up to its 1.16 era (nether biomes, piglins, netherite),
with no content beyond that point.

Required Notice: Copyright SirGodless (https://github.com/SirGodless)

Licensed under the [PolyForm Noncommercial License 1.0.0](./LICENSE).

## Status

Playable: singleplayer in the browser and multiplayer via the dedicated
server (WebSocket transport, accounts, world persistence). See
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the layering that made
the netcode a transport swap instead of a rewrite.

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
| `@flatcraft/dedicated` | Standalone server (Node): serves the client, WebSocket game transport, accounts, world persistence. |

## Development

```sh
npm install
npm run dev        # start the client (Vite) at http://localhost:5173 - singleplayer
npm run typecheck  # typecheck all packages
npm run build      # build all packages (client bundle + dedicated server bundle)
npm test           # run all tests (sim unit tests + multiplayer integration tests)
```

Opened via the Vite dev server (or any static hosting), the game runs in
singleplayer mode: an embedded server in the browser tab, world saved to
IndexedDB. Debug URL params: `?fresh` (new world), `?fog` (fog of war),
`?give=item:count,...`, `?time=18000`, `?portal`.

## Multiplayer (dedicated server)

One Node process serves the game website *and* hosts the world:

```sh
npm install && npm run build
npm start -w @flatcraft/dedicated
```

Open http://localhost:8080 - the client detects the server, shows a login
screen (unknown names register on first login), and connects over
WebSocket on `/ws`. Player state is tied to the account name, the world
autosaves to disk every 60 s and on shutdown.

Configuration via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port (HTTP + WebSocket) |
| `DATA_DIR` | `./data` | World save + accounts |
| `CLIENT_DIR` | `packages/client/dist` | Built client to serve |
| `SEED` | `1337` | Seed for freshly generated worlds |
| `SERVER_NAME` | `FlatCraft` | Name shown on the login screen |

## Run with Docker

```sh
docker compose up -d --build
```

That builds the image (client + server) and starts it on port 8080 with
the world stored in the named volume `flatcraft-data`. Update later with
`git pull && docker compose up -d --build` - the world survives in the
volume. Without compose:

```sh
docker build -t flatcraft .
docker run -d -p 8080:8080 -v flatcraft-data:/data --name flatcraft flatcraft
```

## Behind an Apache reverse proxy

To serve the game at your own domain, copy
[deploy/apache/your_address.conf](./deploy/apache/your_address.conf) into
your Apache config, replace `YOUR_ADDRESS` with your domain and follow
the comments in the file (WebSocket proxying needs one extra directive
on Apache older than 2.4.47). The client automatically uses `wss://`
when the page is served over HTTPS - no game configuration needed.

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
13. ~~Netcode~~ (WebSocket transport behind the existing connection abstraction, dedicated server serving client + game on one port, accounts with register-on-first-login + session tokens, world persistence on disk, Docker image, Apache vhost template)
