import { GameServer, createLoopbackPair, INFO_PATH, type ClientConnection, type ServerInfo } from "@flatcraft/server";
import {
  addToInventory,
  buildPortal,
  chunkKey,
  findSpawnX,
  itemDef,
  PLAYER_HEIGHT,
  registerBlockJson,
  registerItemJson,
  registerMobJson,
  resolveBlockLinks,
  Simulation,
  surfaceHeight,
  syncItemRecipes,
  type OutboundEvent,
  type PlayerId,
} from "@flatcraft/sim";
import { attachInput } from "./input/input.js";
import { connectWebSocket, type OnlineSession } from "./net/wsConnection.js";
import { Renderer } from "./render/renderer.js";
import { loadSpriteOverrides } from "./render/sprites.js";
import { deleteWorld, loadExplored, loadWorld, saveExplored, saveWorld } from "./save.js";
import {
  disconnectOverlay,
  notLoggedInOverlay,
  PLAYER_COLORS,
  storedPlayerColor,
  storePlayerColor,
} from "./ui/login.js";

/** Max chunk requests sent per frame, to keep event batches small. */
const CHUNK_REQUESTS_PER_FRAME = 12;

/**
 * Bootstrap. Two modes behind the same game code:
 *   - online: the page is served by a FlatCraft dedicated server
 *     (detected via INFO_PATH) - log in, connect over WebSocket.
 *   - singleplayer: any other host (dev server, static hosting) - run an
 *     embedded GameServer over the loopback transport, persist to
 *     IndexedDB.
 * Everything below `runGame` is identical for both; that is the whole
 * point of the transport abstraction.
 */
async function start(): Promise<void> {
  const info = await detectServer();
  if (info) {
    await startOnline(info);
  } else {
    await startSingleplayer();
  }
}

async function detectServer(): Promise<ServerInfo | null> {
  try {
    const response = await fetch(INFO_PATH, { headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return null;
    const body = (await response.json()) as Partial<ServerInfo>;
    return body.flatcraft === true ? (body as ServerInfo) : null;
  } catch {
    return null;
  }
}

interface GameOptions {
  connection: ClientConnection;
  playerId: PlayerId;
  playerName: string;
  playerColor: number;
  /** Called every frame with the elapsed ms (embedded server ticking). */
  onFrame?: (dtMs: number) => void;
  /** One-time hook once the renderer exists (persistence, debug params). */
  afterInit?: (renderer: Renderer) => void;
}

/** All game wiring shared by online and singleplayer mode. */
async function runGame(options: GameOptions): Promise<Renderer> {
  const { connection } = options;
  const params = new URLSearchParams(location.search);

  // Sprite files (datapack or public/sprites) replace procedural art.
  await loadSpriteOverrides();

  const renderer = new Renderer();
  renderer.localPlayerId = options.playerId;
  // Fog of war is fully built but disabled for now; ?fog turns it on.
  renderer.fogEnabled = params.has("fog");
  await renderer.init(document.getElementById("app")!);

  connection.onEvents((events) => {
    for (const event of events) {
      renderer.handleEvent(event);
    }
  });

  // B toggles background-wall placement; place_block commands get the layer.
  let placeBackground = false;
  const sendCommand = (command: Parameters<typeof connection.send>[0]): void => {
    if (command.type === "place_block") {
      connection.send({ ...command, layer: placeBackground ? "bg" : "fg" });
    } else {
      connection.send(command);
    }
  };

  renderer.onCraft = (recipeId) => connection.send({ type: "craft", recipe: recipeId });
  renderer.onUseBlock = (x, y) => connection.send({ type: "use_block", x, y });
  renderer.onCreativeGive = (item, count) => connection.send({ type: "creative_give", item, count });
  renderer.onSlotClick = (slot, button) => connection.send({ type: "slot_click", slot, button });
  renderer.onOpenFurnace = (x, y) => connection.send({ type: "open_furnace", x, y });
  renderer.onOpenChest = (x, y) => connection.send({ type: "open_chest", x, y });
  renderer.onTrade = (villager, trade) => connection.send({ type: "trade", entity: villager, trade });
  renderer.onEnchant = () => connection.send({ type: "enchant" });
  renderer.onUiClosed = () => connection.send({ type: "return_grid" });

  attachInput(renderer.canvas, {
    camera: renderer.camera,
    sendCommand,
    screenSize: () => ({ width: renderer.screenWidth, height: renderer.screenHeight }),
    onToggleInventory: () => renderer.toggleInventory(),
    onEscape: () => renderer.closeUI(),
    isOverUI: (x, y) => renderer.isOverUI(x, y),
    onRightClickTile: (x, y) => renderer.tryOpenBlockUI(x, y),
    onRightClickMob: (x, y) => {
      const mob = renderer.mobKindAt(x, y);
      if (mob?.kind === "villager") {
        renderer.openTrading(mob.id);
        return true;
      }
      return false;
    },
    onUseItem: (x, y) => {
      const item = renderer.selectedItem();
      if (item !== null && itemDef(item)?.container !== undefined) {
        renderer.openBackpack();
        return true;
      }
      if (item !== null && itemDef(item)?.bucket !== undefined) {
        connection.send({ type: "use_bucket", x: Math.floor(x), y: Math.floor(y) });
        return true;
      }
      if (item === "bow") {
        // Shoot toward the cursor, from the player's chest height.
        const pos = renderer.localPlayerPos();
        if (pos) {
          connection.send({ type: "shoot", dx: x - pos.x, dy: y - (pos.y - PLAYER_HEIGHT * 0.6) });
        }
        return true;
      }
      if (item !== null && itemDef(item)?.grapple !== undefined) {
        // Fire the grappling hook toward the cursor.
        const pos = renderer.localPlayerPos();
        if (pos) {
          connection.send({ type: "grapple", dx: x - pos.x, dy: y - (pos.y - PLAYER_HEIGHT / 2) });
        }
        return true;
      }
      if (item !== null && (itemDef(item)?.effect !== undefined || itemDef(item)?.food !== undefined)) {
        connection.send({ type: "use_item" });
        return true;
      }
      return false;
    },
    onAttackAt: (x, y) => {
      const mob = renderer.mobAt(x, y);
      if (mob === null) return false;
      connection.send({ type: "attack", entity: mob });
      return true;
    },
    onUiWheel: (deltaY) => renderer.handleWheel(deltaY),
    onHotbarScroll: (direction) =>
      connection.send({ type: "select_slot", index: renderer.hotbarSlotAfter(direction) }),
    onCycleColor: () => {
      const index = PLAYER_COLORS.indexOf(currentColor as (typeof PLAYER_COLORS)[number]);
      currentColor = PLAYER_COLORS[(index + 1) % PLAYER_COLORS.length]!;
      storePlayerColor(currentColor);
      connection.send({ type: "set_color", color: currentColor });
    },
    onToggleBackground: () => {
      placeBackground = !placeBackground;
      renderer.backgroundMode = placeBackground;
    },
    onToggleCreative: () => connection.send({ type: "set_creative", on: !renderer.creativeMode }),
    onPointerMove: (x, y) => renderer.setPointer(x, y),
  });

  let currentColor = options.playerColor;
  connection.send({ type: "join", name: options.playerName, color: currentColor });
  options.afterInit?.(renderer);

  // Chunks already asked for; re-request after dimension changes.
  const requestedChunks = new Set<string>();
  renderer.onDimensionChanged = () => requestedChunks.clear();
  const requestVisibleChunks = (): void => {
    const range = renderer.visibleChunkRange();
    let budget = CHUNK_REQUESTS_PER_FRAME;
    for (let cy = range.minCy; cy <= range.maxCy && budget > 0; cy++) {
      for (let cx = range.minCx; cx <= range.maxCx && budget > 0; cx++) {
        const key = chunkKey(cx, cy);
        if (requestedChunks.has(key)) continue;
        requestedChunks.add(key);
        connection.send({ type: "request_chunk", cx, cy });
        budget--;
      }
    }
  };

  let last = performance.now();
  const frame = (now: number): void => {
    const dt = now - last;
    last = now;
    requestVisibleChunks();
    options.onFrame?.(dt);
    renderer.draw(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return renderer;
}

/** The server's datapack (mod items/blocks): register before joining,
 * so both sides agree on the registries. */
async function applyServerDatapack(): Promise<void> {
  try {
    const response = await fetch("/api/datapack", { headers: { accept: "application/json" } });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.includes("application/json")) return;
    const pack = (await response.json()) as { blocks?: unknown[]; items?: unknown[]; mobs?: unknown[] };
    for (const raw of pack.blocks ?? []) {
      registerBlockJson(raw, "server datapack");
    }
    resolveBlockLinks();
    for (const raw of pack.items ?? []) {
      registerItemJson(raw, "server datapack");
    }
    syncItemRecipes();
    for (const raw of pack.mobs ?? []) {
      registerMobJson(raw, "server datapack");
    }
  } catch (error) {
    console.warn("server datapack failed to load:", error);
  }
}

/** Online mode: login screen, then WebSocket to the serving host. */
async function startOnline(info: ServerInfo): Promise<void> {
  await applyServerDatapack();
  const session = await login(info);
  const renderer = await runGame({
    connection: session.connection,
    playerId: session.playerId,
    playerName: session.name,
    playerColor: storedPlayerColor(),
  });
  void renderer;
  session.onDisconnect(() => disconnectOverlay());
}

const LOGIN_STORAGE_KEY = "flatcraft.login";

async function login(info: ServerInfo): Promise<OnlineSession> {
  const params = new URLSearchParams(location.search);

  // Returning from the anfall-auth redirect: exchange the one-time code
  // for a session (never sits in the URL/history - see /auth/session).
  const loginCode = params.get("login_code");
  if (loginCode) {
    history.replaceState(null, "", location.pathname);
    try {
      const response = await fetch(`/auth/session?code=${encodeURIComponent(loginCode)}`);
      if (response.ok) {
        const session = (await response.json()) as { name: string; token: string };
        localStorage.setItem(LOGIN_STORAGE_KEY, JSON.stringify(session));
        return await connectWebSocket(session);
      }
    } catch {
      // Session exchange failed - fall through to the not-logged-in screen.
    }
  }

  // Auto-login with a stored session token.
  try {
    const stored = JSON.parse(localStorage.getItem(LOGIN_STORAGE_KEY) ?? "null") as {
      name?: string;
      token?: string;
    } | null;
    if (stored?.name && stored.token) {
      try {
        return await connectWebSocket({ name: stored.name, token: stored.token });
      } catch {
        localStorage.removeItem(LOGIN_STORAGE_KEY);
      }
    }
  } catch {
    localStorage.removeItem(LOGIN_STORAGE_KEY);
  }

  const loginError = params.get("login_error");
  if (loginError) history.replaceState(null, "", location.pathname);
  notLoggedInOverlay(info, loginError ?? undefined);
  // Clicking "Login with anfall-auth" navigates the page away - this
  // promise deliberately never settles.
  return new Promise<OnlineSession>(() => {});
}

/** Singleplayer: embedded server, loopback transport, IndexedDB saves. */
async function startSingleplayer(): Promise<void> {
  const params = new URLSearchParams(location.search);

  // World persistence: one IndexedDB slot; ?fresh starts a new world.
  if (params.has("fresh")) {
    await deleteWorld();
  }
  const save = params.has("fresh") ? null : await loadWorld();
  const server = new GameServer(save ? Simulation.deserialize(save) : /* seed */ 1337);

  // Debug helpers for the embedded server (singleplayer only), e.g. ?time=18000
  const debugTime = params.get("time");
  if (debugTime !== null) {
    server.simulation.timeOfDay = Number(debugTime);
  }
  if (params.get("portal") !== null) {
    // Pre-build a lit portal three tiles right of spawn.
    const sim = server.simulation;
    const sx = findSpawnX(sim.world.seed);
    const sy = surfaceHeight(sim.world.seed, sx) - 1;
    buildPortal(sim.world, sx + 3, sy);
    sim.portals.overworld.set(`${sx + 3},${sy}`, { x: sx + 3, y: sy });
  }

  const playerId = server.simulation.allocatePlayerId();
  const { server: serverEnd, client: connection } = createLoopbackPair(playerId);
  server.addConnection(serverEnd);

  await runGame({
    connection,
    playerId,
    playerName: "Player",
    playerColor: storedPlayerColor(),
    onFrame: (dt) => server.advance(dt),
    afterInit: (renderer) => {
      const persist = (): void => {
        void saveWorld(server.simulation.serialize());
        void saveExplored(renderer.exportFogMemory());
      };
      setInterval(persist, 10_000);
      document.addEventListener("visibilitychange", () => {
        if (document.hidden) persist();
      });
      if (!params.has("fresh")) {
        void loadExplored().then((explored) => {
          if (explored) renderer.importFogMemory(explored);
        });
      }

      // Debug: ?give=item:count,item:count seeds the inventory.
      const give = params.get("give");
      if (give) {
        setTimeout(() => {
          const p = server.simulation.players.get(playerId);
          if (!p) return;
          for (const part of give.split(",")) {
            const [item, count] = part.split(":");
            if (item) addToInventory(p.inventory, item, Number(count ?? "1"));
          }
          connection.send({ type: "select_slot", index: 0 }); // force a sync
        }, 500);
      }

      // Debug: ?spawn=kind,kind,... spawns mobs in a line beside the player.
      const spawn = params.get("spawn");
      if (spawn) {
        setTimeout(() => {
          const p = server.simulation.players.get(playerId);
          if (!p) return;
          const out: OutboundEvent[] = [];
          spawn.split(",").forEach((kind, i) => {
            server.simulation.spawnMob(kind, p.x + 3 + i * 1.5, p.y, out);
          });
          serverEnd.send(out.map((o) => o.event));
        }, 500);
      }
    },
  });
}

void start();
