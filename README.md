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

Open http://localhost:8080 - the client detects the server and connects
over WebSocket on `/ws`. Player state is tied to the account name, the
world autosaves to disk every 60 s and on shutdown.

### Login (anfall-auth / OIDC)

Identity comes entirely from [anfall-auth](https://github.com/SirGodless/anfall-auth),
a self-hosted OIDC provider - there's no local username/password anymore.
The account name is the anfall-auth username (`preferred_username` claim).

1. Register a client at anfall-auth (as an admin, requires an existing
   session - see anfall-auth's README):
   ```sh
   curl -X POST https://auth.anfall.net/api/clients/admin/register \
     -H "Content-Type: application/json" -b cookies.txt \
     -d '{"name":"flatcraft","redirectUris":["https://flatcraft.anfall.net/auth/callback"]}'
   ```
2. Set `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (from step 1)
   and `PUBLIC_URL` (this server's own public origin) - see below.
3. Players click "Login with anfall-auth" on the title screen, log in at
   anfall-auth, get redirected back and are in.

Without all four of `OIDC_ISSUER`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`/`PUBLIC_URL`
set, `/auth/login` answers `501` and nobody can log in - the server starts
fine either way (useful for local dev without a real anfall-auth instance,
combined with `DedicatedServer.issueSession` in tests).

Configuration via environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Listen port (HTTP + WebSocket) |
| `DATA_DIR` | `./data` | World save + accounts |
| `CLIENT_DIR` | `packages/client/dist` | Built client to serve |
| `CONTENT_DIR` | repo-root `content/` | Content packages (flatcraft + installed mods) |
| `SEED` | `1337` | Seed for freshly generated worlds |
| `SERVER_NAME` | `FlatCraft` | Name shown on the login screen |
| `OIDC_ISSUER` | - | anfall-auth issuer URL, e.g. `https://auth.anfall.net` |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | - | From the client registered at anfall-auth |
| `PUBLIC_URL` | - | This server's own public origin, e.g. `https://flatcraft.anfall.net` |

## Run with Docker

```sh
cp .env.example .env   # fill in OIDC_ISSUER/OIDC_CLIENT_ID/OIDC_CLIENT_SECRET/PUBLIC_URL
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

## Datapack & modding

Every kind of content - blocks, items, mobs, dimensions, biomes,
multiblocks, enchants, liquids, structures, veins, woods, nether
layers, trades - is data, not code, validated through one generic
content-type engine (`packages/sim/src/registry/generic.ts`) rather
than a hand-written validator per type. Every id is namespaced
`<package>:<type>:<name>` (e.g. `flatcraft:item:bow`); a `ref` field
(e.g. a block's `drops.item`) is checked to actually resolve to
something registered, exhaustively, once at boot - a broken reference
refuses to start the server rather than failing silently in-game.
Numeric block ids exist only as a dense in-memory/on-disk storage
detail (a chunk's tile grid is a `Uint16Array`); saves carry an
id->name palette, so they're never load-bearing identity.

`flatcraft`'s own content lives at `content/flatcraft/` (repo root) -
loaded through the exact same path a third-party content package would
use, no special case for built-in content. A content package is a
directory (or `.zip`) under `content/`:

```
content/my_mod/
  content.json               # { "id": "my_mod", "version": "0.1.0" }
  blocks/my_block.json
  items/my_item.json
  sprites/block/my_block.png  # optional, else procedural fallback
  sprites/item/my_item.png
  scripts/main.ts             # optional - see below
```

A content package's data is served to every connecting client via
`/api/content` on join (already parsed, so the client never needs its
own JSON-schema-shaped parser), and its sprites via `/sprites/`.
`scripts/*.ts` files run server-side in a real V8 isolate
(`isolated-vm`) and register content/behavior through the same engine
APIs a JSON file would use; the already-compiled JS is then served to
connecting clients too (`/api/scripts`), which run it in a Worker
nested inside a sandboxed, opaque-origin iframe (no DOM/cookie/storage
access, no network) - see `packages/dedicated/src/sandbox.ts` and
`packages/client/src/sandbox/` for the full story.

**Sprites** normally live in the repo:
`packages/client/public/sprites/<type>/<id>.png` (e.g.
`item/golden_shovel.png`, `block/stone.png` to re-skin a built-in).
Commit the PNG, rebuild/redeploy, done - the manifest is generated
automatically and the dedicated server ships them to every client.
Rules: PNG, 8 bit per channel, dimensions a multiple of 2, no upper
size limit. Item/mob/entity sprites may use any aspect ratio - they're
rendered as free-standing icons/entities, fit to size rather than
stretched (e.g. a tall-and-narrow spear icon stays tall and narrow).
Block sprites must stay square and exactly `TILE_PX`x`TILE_PX`, since
they're tiled pixel-for-pixel onto the world grid - a mismatched block
sprite logs a console warning at load time instead of silently
misaligning in-game. Separately, a block/item/mob with neither a real
sprite nor a declared procedural fallback shows a loud magenta
missing-texture placeholder and logs its own console warning, rather
than silently guessing. A content package's own
`sprites/<type>/<id>.png` works the same way and wins over the repo
version.

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
14. ~~Content expansion~~ (copper + netherite material tiers; recipe ingredient tags - any wood works in wood recipes; birch/spruce trees with stairs/slabs/fences/doors/trapdoors per wood; Terraria-style placement rules + background-wall building (B) and hammers to mine walls; armor + offhand + shields with tiered recipes; grappling hooks with 10+2/tier range; walk-in portal frames; creative mode on a hidden keybind; finite flowing water/lava with swimming and diving air)
15. ~~Datapack engine~~ (every item/block/recipe is a component-based JSON file with strict validation; string ids everywhere with a save palette instead of load-bearing numbers; saturation/eat-time/weapon-knockback/enchant lists as data; sprite files with procedural fallback; server-side mod datapacks synced to clients on join)
