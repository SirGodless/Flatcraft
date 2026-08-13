import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, relative, resolve } from "node:path";
import { GameServer, INFO_PATH, WS_PATH } from "@flatcraft/server";
import type { AuthRequest, ClientMessage, ServerConnection, ServerInfo, ServerMessage } from "@flatcraft/server";
import {
  registerBlockJson,
  registerItemJson,
  resolveBlockLinks,
  Simulation,
  syncItemRecipes,
  TICK_MS,
  type Command,
  type SimSave,
} from "@flatcraft/sim";
import { WebSocketServer, type WebSocket } from "ws";
import { Accounts } from "./accounts.js";
import { OidcLogin, type OidcConfig } from "./oidc.js";

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
  seed?: number | undefined;
  serverName?: string | undefined;
  saveIntervalMs?: number | undefined;
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

export async function startDedicatedServer(options: DedicatedOptions): Promise<DedicatedServer> {
  const log = options.log ?? ((message: string) => console.log(message));
  const dataDir = resolve(options.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const worldFile = join(dataDir, "world.json");
  const accounts = new Accounts(join(dataDir, "accounts.json"));
  const oidcLogin = options.oidc ? new OidcLogin(options.oidc) : null;
  const serverName = options.serverName ?? "FlatCraft";
  const clientDir = options.clientDir ? resolve(options.clientDir) : null;

  // --- Server datapack (mods): DATA_DIR/datapack/{blocks,items,sprites} ---
  // Loaded before the world, so modded blocks resolve in the save palette;
  // the raw JSONs are re-served to clients via /api/datapack.
  const datapackDir = join(dataDir, "datapack");
  const packBlocks: unknown[] = [];
  const packItems: unknown[] = [];
  const spritesDir = join(datapackDir, "sprites");
  const readPackDir = (sub: string, into: unknown[]): void => {
    const dir = join(datapackDir, sub);
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).sort()) {
      if (!file.endsWith(".json")) continue;
      into.push(JSON.parse(readFileSync(join(dir, file), "utf8")));
    }
  };
  readPackDir("blocks", packBlocks);
  readPackDir("items", packItems);
  for (const raw of packBlocks) {
    registerBlockJson(raw, "datapack/blocks");
  }
  resolveBlockLinks();
  for (const raw of packItems) {
    registerItemJson(raw, "datapack/items");
  }
  syncItemRecipes();
  if (packBlocks.length > 0 || packItems.length > 0) {
    log(`datapack loaded: ${packBlocks.length} blocks, ${packItems.length} items`);
  }
  // Sprites come from two places: the repo (shipped inside the client
  // build, dist/sprites) and the server datapack; the datapack wins on
  // conflicts. The manifest is the union of both.
  const clientSpritesDir = clientDir ? join(clientDir, "sprites") : null;
  const spriteSet = new Set<string>();
  const collectSprites = (base: string, dir = base): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) collectSprites(base, full);
      else if (entry.name.endsWith(".png")) spriteSet.add(relative(base, full).replaceAll("\\", "/"));
    }
  };
  if (clientSpritesDir) collectSprites(clientSpritesDir);
  collectSprites(spritesDir);
  const spriteEntries = [...spriteSet];

  // --- World: load from disk or start fresh ---
  let simulation: Simulation;
  if (existsSync(worldFile)) {
    try {
      const save = JSON.parse(readFileSync(worldFile, "utf8")) as SimSave;
      simulation = Simulation.deserialize(save);
      log(`world loaded from ${worldFile} (tick ${simulation.tickCount})`);
    } catch (error) {
      // Never overwrite a corrupt save silently - keep it for inspection.
      const backup = `${worldFile}.corrupt-${Date.now()}`;
      renameSync(worldFile, backup);
      log(`world file was unreadable, moved to ${backup}; starting fresh (${String(error)})`);
      simulation = new Simulation(options.seed ?? 1337);
    }
  } else {
    simulation = new Simulation(options.seed ?? 1337);
    log(`new world (seed ${options.seed ?? 1337})`);
  }
  const gameServer = new GameServer(simulation);

  const save = (): void => {
    const data = JSON.stringify(gameServer.simulation.serialize());
    const tmp = `${worldFile}.tmp`;
    writeFileSync(tmp, data);
    renameSync(tmp, worldFile);
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
    if (urlPath === "/api/datapack") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ blocks: packBlocks, items: packItems, sprites: spriteEntries }));
      return;
    }
    if (urlPath === "/sprites/manifest.json") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(spriteEntries));
      return;
    }
    if (urlPath.startsWith("/sprites/")) {
      const spritePath = urlPath.slice("/sprites/".length);
      // Datapack sprites override the repo-shipped ones.
      if (existsSync(join(spritesDir, spritePath))) {
        serveFile(spritesDir, spritePath, response);
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
    });
    response.end(content);
  } catch {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end("read error");
  }
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
