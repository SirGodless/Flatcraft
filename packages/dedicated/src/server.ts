import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverContentDir, type ContentPackage } from "@flatcraft/content";
import { GameServer, INFO_PATH, WS_PATH } from "@flatcraft/server";
import type { AuthRequest, ClientMessage, ServerConnection, ServerInfo, ServerMessage } from "@flatcraft/server";
import {
  buildBlockRemap,
  CHUNK_HEIGHT,
  CHUNK_WIDTH,
  furnaceKey,
  loadContentPackage,
  Simulation,
  TICK_MS,
  validateAllContent,
  type Command,
  type Dimension,
  type SimSave,
} from "@flatcraft/sim";
import { WebSocketServer, type WebSocket } from "ws";
import { Accounts } from "./accounts.js";
import { type ChunkExtra, ChunkFileStore } from "./chunkFiles.js";
import { OidcLogin, type OidcConfig } from "./oidc.js";
import { compileContentScripts, runCompiledScripts } from "./sandbox.js";

/**
 * The dedicated server: one Node process, one port.
 *   - serves the built browser client (static files)
 *   - answers INFO_PATH so the client switches into online mode
 *   - upgrades WS_PATH to the game's WebSocket transport
 *   - persists the world to disk (autosave + on shutdown)
 *
 * Exported as a factory so tests can spin up real servers on ephemeral
 * ports; `main.ts` is just env parsing around this.
 */

export interface DedicatedOptions {
  port: number;
  /** World + accounts live here. */
  dataDir: string;
  /** Built client to serve; omit to run headless (API/WS only). */
  clientDir?: string | undefined;
  /** The `content/` directory holding `flatcraft/` (and any other
   * installed content packages) - discovered and registered before
   * anything else touches the block/item/mob/... registries. Defaults
   * to the repo-root `content/` directory next to this build. */
  contentDir?: string | undefined;
  seed?: number | undefined;
  serverName?: string | undefined;
  saveIntervalMs?: number | undefined;
  /** Start from a fresh world instead of loading world.json + the
   * world/ region files - both are kept as timestamped backups, not
   * deleted, in case this was set by mistake. Implies resetPlayers
   * (there's no old save left to load player state from either way). */
  resetWorld?: boolean | undefined;
  /** Keep the world (blocks, mobs, dropped items) but drop every
   * player's saved state, so the next join with any given name starts
   * fresh - full health, empty inventory, default spawn. */
  resetPlayers?: boolean | undefined;
  log?: ((message: string) => void) | undefined;
  /** anfall-auth login (see oidc.ts); omit to run /auth/* as 501s (tests
   * bootstrap sessions directly via DedicatedServer.issueSession instead). */
  oidc?: OidcConfig | undefined;
}

export interface DedicatedServer {
  /** The actually bound port (relevant when options.port was 0). */
  port: number;
  gameServer: GameServer;
  save(): void;
  close(): Promise<void>;
  /** Issues a session the same way a successful anfall-auth login would -
   * for tests, and any other trusted bootstrap need. Not reachable over the
   * wire or HTTP. */
  issueSession(name: string): { name: string; token: string };
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Repo-root `content/` lives 3 levels above this file whether it's
 * running unbundled (packages/dedicated/src) or as the esbuild-bundled
 * dist/server.mjs (packages/dedicated/dist) - "src"/"dist" sit at the
 * same depth, so the same relative path resolves correctly either way.
 * That assumption breaks once server.mjs is copied somewhere else
 * entirely (e.g. flattened straight into /app by the Docker image) -
 * CONTENT_DIR exists precisely for that case; the Dockerfile sets it
 * explicitly rather than relying on this fallback. */
const here = dirname(fileURLToPath(import.meta.url));

/** Every content package under contentDir (block/item/mob/... registries,
 * flatcraft's own vanilla content included - no privileged shortcut)
 * loads exactly once per process - a second startDedicatedServer() call
 * in the same process (every test file that spins up its own server)
 * must not try to register "flatcraft:block:stone" a second time.
 * Cached as a promise, not a boolean, so concurrent callers await the
 * same load rather than racing a second one. */
let baseContentLoaded: Promise<readonly ContentPackage[]> | null = null;

function ensureBaseContentLoaded(contentDir: string): Promise<readonly ContentPackage[]> {
  if (!baseContentLoaded) {
    baseContentLoaded = (async () => {
      const packages = discoverContentDir(contentDir);
      const flatcraft = packages.find((p) => p.id === "flatcraft");
      if (!flatcraft) {
        throw new Error(`no "flatcraft" content package found under "${contentDir}"`);
      }
      // flatcraft first - every other package's content may reference
      // flatcraft-namespaced ids (a mod item that places a vanilla
      // block, a mod block that drops a vanilla item), and
      // loadContentPackage resolves cross-references eagerly as each
      // package's own directories drain rather than deferring to the
      // end, so load order here has to match that assumption.
      await loadContentPackage(flatcraft);
      for (const pkg of packages) {
        if (pkg.id === "flatcraft") continue;
        await loadContentPackage(pkg);
      }
      return packages;
    })();
  }
  return baseContentLoaded;
}

export async function startDedicatedServer(options: DedicatedOptions): Promise<DedicatedServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const contentDir = resolve(options.contentDir ?? join(here, "../../../content"));
  const contentPackages = await ensureBaseContentLoaded(contentDir);

  // Declared before the Simulation itself exists (its construction below
  // depends on world-load/reset options resolved later in boot) so
  // content-package scripts can be loaded - and their registrations
  // validated by validateAllContent below - ahead of the Simulation that
  // their bridge calls (world/rng/spawnItem) ultimately act on. Those
  // bridge calls only ever run from a later tick hook or handler
  // invocation, never from a script's own top-level load, so `simulation`
  // is always assigned by the time getSim() is actually called.
  let simulation: Simulation | undefined;
  const getSim = (): Simulation => {
    if (!simulation) {
      throw new Error(
        "a content-package script touched the live simulation before it exists - bridge calls are only valid from a tick hook or handler invoked after boot completes, not from a script's own top-level code",
      );
    }
    return simulation;
  };

  const dataDir = resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const worldFile = join(dataDir, "world.json");
  const accounts = new Accounts(join(dataDir, "accounts.json"));
  const oidcLogin = options.oidc ? new OidcLogin(options.oidc) : null;
  const serverName = options.serverName ?? "FlatCraft";
  const clientDir = options.clientDir ? resolve(options.clientDir) : null;

  // Content-package scripts (content/<pkg>/scripts/*.ts) compile once
  // here - the resulting JS is reused both to run them server-side
  // (isolated-vm, below) and to serve them to connecting clients'
  // Worker+iframe sandbox via /api/scripts (Stage 9 - the client never
  // transpiles TS itself, same asymmetry as /api/content already
  // serving pre-parsed JSON rather than making the client parse
  // anything mod-shaped on its own). Compiling before validateAllContent
  // runs so a multiblock/dimension JSON referencing a script-registered
  // handler id resolves during that same validation pass instead of
  // looking like a dangling reference. A script that fails to compile or
  // throws at top-level load is a hard boot failure (propagates out of
  // these calls), matching validateAllContent's own "refuse to start
  // rather than run with broken content" rule.
  const scriptBundles = compileContentScripts(contentPackages);
  runCompiledScripts(scriptBundles, getSim, log);

  // Hard stop, not a warning: every content reference (currently
  // multiblock handlers) must resolve to something actually registered,
  // checked exhaustively so every problem shows up at once instead of a
  // fix-one-restart-find-the-next loop. Refusing to boot here is
  // deliberate - silently starting with some content broken just means
  // someone discovers "why isn't my item in the game" in-game instead
  // of at startup, which is exactly the confusion this exists to avoid.
  const contentProblems = validateAllContent();
  if (contentProblems.length > 0) {
    throw new Error(`content validation failed:\n${contentProblems.map((p) => `  - ${p}`).join("\n")}`);
  }

  // Sprites come from two places: the repo (shipped inside the client
  // build, dist/sprites) and any discovered content package's own
  // sprites/ directory (already sitting in memory as part of pkg.files -
  // discoverContentDir walks every file under a package, not just its
  // JSON) - a content package overrides the repo default on conflict,
  // later-loaded packages override earlier ones. The manifest is the
  // union of both; a content-package sprite is served straight from
  // memory (no disk read), the repo-shipped fallback still reads from
  // clientDir/sprites since that side of the client build isn't loaded
  // into memory here.
  const clientSpritesDir = clientDir ? join(clientDir, "sprites") : null;
  const contentSprites = new Map<string, Uint8Array>();
  for (const pkg of contentPackages) {
    for (const [path, bytes] of pkg.files) {
      if (path.startsWith("sprites/") && path.endsWith(".png")) {
        contentSprites.set(path.slice("sprites/".length), bytes);
      }
    }
  }
  const spriteSet = new Set<string>(contentSprites.keys());
  const collectClientSprites = (base: string, dir = base): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectClientSprites(base, full);
      else if (entry.name.endsWith(".png")) spriteSet.add(relative(base, full).replaceAll("\\", "/"));
    }
  };
  if (clientSpritesDir) collectClientSprites(clientSpritesDir);
  const spriteEntries = [...spriteSet];

  // --- World: load from disk or start fresh ---
  // world.json holds only what isn't chunk-anchored (entities, players,
  // portals, seed, tick/time/rng, the block palette). Terrain, chests and
  // furnaces all live in world/<dimension>/c.<cx>.<cy>.bin chunk files
  // (see chunkFiles.ts) - one per modified chunk, keeping a chunk's
  // terrain and any container contents anchored within it as a single
  // consistent unit (see Simulation.ensureChest/World.touchChunk: opening
  // a chest always dirties its chunk, so the two can never desync). Only
  // terrain is loaded lazily, on first touch; chest/furnace state is
  // hydrated eagerly at boot (see scanAll() below) so container ticking
  // doesn't depend on a player having wandered near enough yet.
  const worldDir = join(dataDir, "world");
  if (options.resetWorld) {
    // Renamed, not deleted - a mistaken RESET_WORLD=true doesn't have to
    // mean permanent data loss, same philosophy as the corrupt-save
    // backup below.
    if (existsSync(worldFile)) {
      const backup = `${worldFile}.reset-${Date.now()}`;
      renameSync(worldFile, backup);
      log(`RESET_WORLD set: previous world meta moved to ${backup}`);
    }
    if (existsSync(worldDir)) {
      const backup = `${worldDir}.reset-${Date.now()}`;
      renameSync(worldDir, backup);
      log(`RESET_WORLD set: previous world terrain moved to ${backup}`);
    }
  }
  /** The palette a freshly-loaded meta file's chunk remap is based on -
   * undefined when there was no save to load from, or the meta file was
   * corrupt (see the catch branch below). Either way buildBlockRemap
   * below turns that into "no remap", which is exactly right: a brand
   * new Simulation just uses whatever ids are current, and any chunk
   * file it later writes and reloads within this same run (e.g. after
   * idle eviction - see Simulation.evictIdleChunks) was written by that
   * same current registry, so nothing needs remapping either. */
  let blockPalette: Record<number, string> | undefined;
  if (existsSync(worldFile)) {
    try {
      const meta = JSON.parse(readFileSync(worldFile, "utf8")) as Omit<SimSave, "worlds" | "furnaces" | "chests">;
      blockPalette = meta.blockPalette;
      simulation = Simulation.deserialize({
        ...meta,
        worlds: [],
        furnaces: [],
        chests: [],
      });
      log(`world loaded from ${worldFile} (tick ${simulation.tickCount})`);
    } catch (error) {
      // Never overwrite a corrupt save silently - keep it for inspection.
      const backup = `${worldFile}.corrupt-${Date.now()}`;
      renameSync(worldFile, backup);
      // The chunk files next to it describe terrain for the simulation
      // we're discarding, not the fresh one about to replace it - move
      // them aside too, the same way RESET_WORLD backs up both halves,
      // so the new simulation's chunk loader (wired unconditionally
      // below) can't pick up orphaned terrain from the old, now-gone
      // world and present it as if it belonged to the new one.
      if (existsSync(worldDir)) {
        const terrainBackup = `${worldDir}.corrupt-${Date.now()}`;
        renameSync(worldDir, terrainBackup);
        log(`its chunk files were moved to ${terrainBackup} along with it`);
      }
      log(`world file was unreadable, moved to ${backup}; starting fresh (${String(error)})`);
      simulation = new Simulation(options.seed ?? 1337);
    }
  } else {
    simulation = new Simulation(options.seed ?? 1337);
    log(`new world (seed ${options.seed ?? 1337})`);
  }
  if (options.resetPlayers && !options.resetWorld) {
    // resetWorld already implies this - there's no old player state left
    // to load from a freshly generated world anyway.
    simulation.resetPlayers();
    log("RESET_PLAYERS set: all saved player state (position/inventory/health) cleared");
  }
  // Every dimension this simulation actually has a World for (see
  // Simulation's constructor - one per currently-registered dimension,
  // not a fixed overworld/nether pair), computed once here rather than
  // hardcoded, so a mod's own dimension gets exactly the same chunk-
  // loader wiring and save/hydration handling as the built-in two.
  const DIMENSIONS = [...simulation.worlds.keys()];
  // Wired unconditionally, even for a brand new world: idle eviction (see
  // Simulation.evictIdleChunks) can drop a chunk from memory and expect
  // it back later purely from a file this same process wrote itself
  // earlier in the run, long before any restart happens.
  const chunkFileStore = new ChunkFileStore(worldDir);
  const remap = buildBlockRemap(blockPalette);
  for (const dim of DIMENSIONS) {
    simulation.worldOf(dim).setChunkLoader((cx, cy) => chunkFileStore.load(dim, cx, cy, remap));
  }
  // Chest/furnace item ids are strings, not the numeric block ids a
  // renumbered palette would affect, so no remap is needed here. A fresh
  // world's worldDir has nothing to scan yet, so this is just a no-op
  // empty loop in that case.
  let hydratedContainers = 0;
  for (const { dim, extra } of chunkFileStore.scanAll()) {
    for (const f of extra.furnaces) simulation.furnaces.set(furnaceKey(f.dimension, f.x, f.y), f);
    for (const c of extra.chests) {
      simulation.chests.set(furnaceKey(dim, c.x, c.y), { dimension: dim, x: c.x, y: c.y, slots: c.slots });
    }
    hydratedContainers += extra.furnaces.length + extra.chests.length;
  }
  if (hydratedContainers > 0) log(`${hydratedContainers} saved chest(s)/furnace(s) restored`);
  const gameServer = new GameServer(simulation);

  const chunkKeyFor = (x: number, y: number): string =>
    `${Math.floor(x / CHUNK_WIDTH)},${Math.floor(y / CHUNK_HEIGHT)}`;

  const save = (): void => {
    const full = gameServer.simulation.serialize();
    const { worlds, furnaces, chests, ...meta } = full;
    const tmp = `${worldFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(meta));
    renameSync(tmp, worldFile);
    for (const { dim, chunks } of worlds) {
      if (chunks.length === 0) continue;
      // Every chunk with a chest/furnace is guaranteed to also be in
      // chunks - opening one always dirties its chunk (see
      // World.touchChunk) - so bucketing here never orphans container
      // state against a chunk file that doesn't get written.
      const extraByChunk = new Map<string, ChunkExtra>();
      const bucket = (dimension: Dimension, x: number, y: number): ChunkExtra => {
        const key = chunkKeyFor(x, y);
        let entry = extraByChunk.get(key);
        if (!entry) {
          entry = { chests: [], furnaces: [] };
          extraByChunk.set(key, entry);
        }
        return entry;
      };
      for (const f of furnaces) {
        if (f.dimension === dim) bucket(dim, f.x, f.y).furnaces.push(f);
      }
      for (const c of chests ?? []) {
        if (c.dimension === dim) bucket(dim, c.x, c.y).chests.push({ x: c.x, y: c.y, slots: c.slots });
      }
      chunkFileStore.write(dim, chunks, extraByChunk);
      // Only mark chunks clean after the write above actually succeeded -
      // see World.markSaved's doc comment for why the order matters.
      gameServer.simulation.worldOf(dim).markSaved(chunks);
    }
    // Idle chunks are only evictable once clean, so sweeping right after
    // a save catches everything the save just settled - see
    // Simulation.evictIdleChunks.
    const evicted = gameServer.simulation.evictIdleChunks();
    if (evicted > 0) log(`${evicted} idle chunk(s) evicted from memory`);
  };

  // --- Game loop + autosave ---
  let last = Date.now();
  const tickTimer = setInterval(() => {
    const now = Date.now();
    gameServer.advance(now - last);
    last = now;
  }, TICK_MS);
  const saveTimer = setInterval(save, options.saveIntervalMs ?? 60_000);

  // --- HTTP: client files + server info ---
  const httpServer = createServer((request, response) => {
    const urlPath = (request.url ?? "/").split("?")[0] ?? "/";
    if (urlPath === INFO_PATH) {
      const info: ServerInfo = {
        flatcraft: true,
        name: serverName,
        players: gameServer.simulation.players.size,
      };
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(info));
      return;
    }
    if (urlPath === "/api/content") {
      // { [packageId]: { [path]: json } } - every discovered content
      // package except "flatcraft" (the client already has that one
      // bundled at build time - see client/src/content.ts's
      // loadBundledFlatcraftContent) and every JSON file under it
      // (content.json's own manifest and anything non-JSON, e.g.
      // sprites/, excluded - only what loadContentPackage wants). The
      // client re-encodes each value back to bytes and hands the whole
      // thing to the exact same loadContentPackage() this server
      // itself calls at boot - no separate client-side content format,
      // no privileged shortcut for whichever host does the I/O.
      const packages: Record<string, Record<string, unknown>> = {};
      const jsonDecoder = new TextDecoder();
      for (const pkg of contentPackages) {
        if (pkg.id === "flatcraft") continue;
        const files: Record<string, unknown> = {};
        for (const [path, bytes] of pkg.files) {
          if (path === "content.json" || !path.endsWith(".json")) continue;
          files[path] = JSON.parse(jsonDecoder.decode(bytes));
        }
        packages[pkg.id] = files;
      }
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(packages));
      return;
    }
    if (urlPath === "/api/scripts") {
      // { [packageId]: string[] } - already-compiled JS (see
      // compileContentScripts above), in load order, one entry per
      // content package that has a scripts/ directory. The client's
      // Worker+iframe sandbox (Stage 9) evals these directly; it never
      // sees or transpiles the original TypeScript.
      const scripts: Record<string, string[]> = {};
      for (const [packageId, files] of scriptBundles) {
        scripts[packageId] = files.map((f) => f.code);
      }
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(scripts));
      return;
    }
    if (urlPath === "/sprites/manifest.json") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(spriteEntries));
      return;
    }
    if (urlPath.startsWith("/sprites/")) {
      const spritePath = urlPath.slice("/sprites/".length);
      // A content package's own sprite overrides the repo-shipped one.
      const contentBytes = contentSprites.get(spritePath);
      if (contentBytes) {
        serveBytes(spritePath, contentBytes, response);
      } else if (clientSpritesDir) {
        serveFile(clientSpritesDir, spritePath, response);
      } else {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("not found");
      }
      return;
    }
    if (urlPath === "/auth/login" || urlPath === "/auth/callback" || urlPath === "/auth/session") {
      handleAuthRoute(urlPath, oidcLogin, accounts, request, response);
      return;
    }
    serveStatic(clientDir, request, response);
  });

  // --- WebSocket: auth handshake, then the game transport ---
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.split("?")[0] !== WS_PATH) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      handleSocket(ws);
    });
  });

  /** Account names with a live connection (one session per account). */
  const activeNames = new Set<string>();

  function handleSocket(ws: WebSocket): void {
    let connection: (ServerConnection & { handler?: (command: Command) => void }) | null = null;
    let accountName: string | null = null;

    const sendMessage = (message: ServerMessage): void => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message));
      }
    };

    // Sockets that never authenticate get dropped.
    const authTimeout = setTimeout(() => {
      if (!connection) ws.close();
    }, 10_000);

    ws.on("message", (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return;
      }
      if (!connection) {
        if (message.type !== "auth") return;
        const result = accounts.authenticate(message as AuthRequest);
        if (!result.ok) {
          sendMessage({ type: "auth_error", reason: result.reason });
          ws.close();
          return;
        }
        if (activeNames.has(result.name)) {
          sendMessage({ type: "auth_error", reason: "already connected" });
          ws.close();
          return;
        }
        clearTimeout(authTimeout);
        accountName = result.name;
        activeNames.add(result.name);
        const playerId = gameServer.simulation.allocatePlayerId();
        connection = {
          playerId,
          send(events) {
            sendMessage({ type: "events", events: [...events] });
          },
          onCommand(handler) {
            this.handler = handler;
          },
          close() {
            ws.close();
          },
        };
        gameServer.addConnection(connection);
        sendMessage({ type: "auth_ok", playerId, name: result.name, token: result.token });
        log(`${result.name} connected (player ${playerId})`);
        return;
      }
      if (message.type === "ping") {
        sendMessage({ type: "pong", sentAt: message.sentAt });
        return;
      }
      if (message.type === "command") {
        let command = message.command;
        if (typeof command !== "object" || command === null || typeof command.type !== "string") {
          return;
        }
        // Identity is the account's, never the client's claim.
        if (command.type === "join") {
          command = { ...command, name: accountName! };
        }
        connection.handler?.(command);
      }
    });

    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (connection) {
        gameServer.removeConnection(connection);
        connection = null;
      }
      if (accountName) {
        activeNames.delete(accountName);
        log(`${accountName} disconnected`);
        accountName = null;
      }
    });
    ws.on("error", () => ws.close());
  }

  await new Promise<void>((resolvePromise) => {
    httpServer.listen(options.port, resolvePromise);
  });
  const address = httpServer.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  log(`listening on http://localhost:${port} (WebSocket on ${WS_PATH})`);

  return {
    port,
    gameServer,
    save,
    issueSession: (name: string) => accounts.establishSession(name),
    async close(): Promise<void> {
      clearInterval(tickTimer);
      clearInterval(saveTimer);
      for (const client of wss.clients) {
        client.terminate();
      }
      save();
      await new Promise<void>((resolvePromise) => {
        httpServer.close(() => resolvePromise());
      });
    },
  };
}

/** Serve one file from a base directory, path-traversal safe. */
function serveFile(baseDir: string, relativePath: string, response: ServerResponse): void {
  const filePath = normalize(join(baseDir, relativePath));
  if (!filePath.startsWith(baseDir) || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  try {
    const content = readFileSync(filePath);
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": relativePath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      // sandbox.html's own bootstrap module script (and the module
      // Worker it spawns - see client/src/sandbox/host.ts) load from
      // inside a deliberately opaque-origin iframe (sandbox="allow-
      // scripts", no allow-same-origin). A module script/worker always
      // enforces a CORS check, even for what's nominally "the same
      // server" - an opaque origin is never same-origin with anything,
      // itself included, so without this header the sandbox's own
      // harness code fails to load at all. Every file served here is
      // public static content already (the whole client bundle,
      // sprites) with no per-user/cookie-gated access to protect, so a
      // permissive origin is the correct answer, not a workaround.
      "access-control-allow-origin": "*",
    });
    response.end(content);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("read error");
  }
}

/** Serve one file's bytes already held in memory (a content package's
 * own sprites/ file - see discoverContentDir/pkg.files) - same headers
 * as serveFile, just no disk read since there's nothing to read from. */
function serveBytes(path: string, bytes: Uint8Array, response: ServerResponse): void {
  response.writeHead(200, {
    "content-type": MIME_TYPES[extname(path)] ?? "application/octet-stream",
    "cache-control": "no-cache",
    // Same opaque-origin/CORS reasoning as serveFile above.
    "access-control-allow-origin": "*",
  });
  response.end(Buffer.from(bytes));
}

function serveStatic(
  clientDir: string | null,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!clientDir) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("FlatCraft dedicated server (no client bundled)");
    return;
  }
  const urlPath = (request.url ?? "/").split("?")[0] ?? "/";
  serveFile(clientDir, urlPath === "/" ? "index.html" : urlPath.slice(1), response);
}

/** /auth/login, /auth/callback, /auth/session - see oidc.ts. */
function handleAuthRoute(
  urlPath: string,
  oidcLogin: OidcLogin | null,
  accounts: Accounts,
  request: IncomingMessage,
  response: ServerResponse,
): void {
  if (!oidcLogin) {
    response.writeHead(501, { "content-type": "text/plain; charset=utf-8" });
    response.end("OIDC login is not configured on this server");
    return;
  }

  if (urlPath === "/auth/login") {
    void oidcLogin
      .buildAuthorizationRedirect()
      .then((redirectTo) => {
        response.writeHead(302, { location: redirectTo.href });
        response.end();
      })
      .catch((error: unknown) => {
        response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
        response.end(`oidc error: ${error instanceof Error ? error.message : String(error)}`);
      });
    return;
  }

  if (urlPath === "/auth/callback") {
    void oidcLogin
      .handleCallback(request)
      .then(({ name }) => {
        const session = accounts.establishSession(name);
        const code = oidcLogin.issuePendingSession(session.name, session.token);
        response.writeHead(302, { location: `/?login_code=${encodeURIComponent(code)}` });
        response.end();
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        response.writeHead(302, { location: `/?login_error=${encodeURIComponent(message)}` });
        response.end();
      });
    return;
  }

  // /auth/session
  const code = new URL(request.url ?? "/", "http://internal").searchParams.get("code");
  const session = code ? oidcLogin.claimPendingSession(code) : null;
  if (!session) {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "not found" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(session));
}

export type { Server };
