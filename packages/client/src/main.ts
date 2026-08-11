import { GameServer, createLoopbackPair } from "@flatcraft/server";
import { buildPortal, chunkKey, findSpawnX, Simulation, surfaceHeight } from "@flatcraft/sim";
import { attachInput } from "./input/input.js";
import { Renderer } from "./render/renderer.js";
import { deleteWorld, loadWorld, saveWorld } from "./save.js";

/** Max chunk requests sent per frame, to keep event batches small. */
const CHUNK_REQUESTS_PER_FRAME = 12;

/**
 * Singleplayer bootstrap: an embedded GameServer connected through the
 * loopback transport. The client side of this file must only ever talk to
 * `connection` - switching to a remote server later means replacing the
 * loopback pair with a WebSocket-backed ClientConnection and deleting the
 * embedded server, nothing else.
 */
async function start(): Promise<void> {
  const params = new URLSearchParams(location.search);

  // World persistence: one IndexedDB slot; ?fresh starts a new world.
  if (params.has("fresh")) {
    await deleteWorld();
  }
  const save = params.has("fresh") ? null : await loadWorld();
  const server = new GameServer(save ? Simulation.deserialize(save) : /* seed */ 1337);
  const persist = (): void => {
    void saveWorld(server.simulation.serialize());
  };
  setInterval(persist, 10_000);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) persist();
  });

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

  const renderer = new Renderer();
  renderer.localPlayerId = playerId;
  await renderer.init(document.getElementById("app")!);

  connection.onEvents((events) => {
    for (const event of events) {
      renderer.handleEvent(event);
    }
  });

  renderer.onCraft = (recipeId) => connection.send({ type: "craft", recipe: recipeId });
  renderer.onSlotClick = (slot, button) => connection.send({ type: "slot_click", slot, button });
  renderer.onOpenFurnace = (x, y) => connection.send({ type: "open_furnace", x, y });
  renderer.onOpenChest = (x, y) => connection.send({ type: "open_chest", x, y });
  renderer.onTrade = (villager, trade) => connection.send({ type: "trade", entity: villager, trade });
  renderer.onEnchant = () => connection.send({ type: "enchant" });
  renderer.onUiClosed = () => connection.send({ type: "return_grid" });

  const input = attachInput(renderer.canvas, {
    camera: renderer.camera,
    sendCommand: (command) => connection.send(command),
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
    onUseItem: () => {
      if (renderer.selectedItem() === "backpack") {
        renderer.openBackpack();
        return true;
      }
      if (renderer.selectedItem()?.startsWith("potion_")) {
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
    onPointerMove: (x, y) => renderer.setPointer(x, y),
  });

  connection.send({ type: "join", name: "Player" });

  // Chunks already asked for; in multiplayer this would need re-request on
  // timeout, in singleplayer the loopback server always answers.
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
    // Server ticks at a fixed rate regardless of frame rate...
    server.advance(dt);
    // ...while rendering runs per frame, interpolating between ticks.
    renderer.draw(dt);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
