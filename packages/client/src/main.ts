import { GameServer, createLoopbackPair } from "@flatcraft/server";
import { chunkKey } from "@flatcraft/sim";
import { attachInput } from "./input/input.js";
import { Renderer } from "./render/renderer.js";

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
  const server = new GameServer(/* seed */ 1337);

  // Debug helpers for the embedded server (singleplayer only), e.g. ?time=18000
  const params = new URLSearchParams(location.search);
  const debugTime = params.get("time");
  if (debugTime !== null) {
    server.simulation.timeOfDay = Number(debugTime);
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
  renderer.onUiClosed = () => connection.send({ type: "return_grid" });

  const input = attachInput(renderer.canvas, {
    camera: renderer.camera,
    sendCommand: (command) => connection.send(command),
    screenSize: () => ({ width: renderer.screenWidth, height: renderer.screenHeight }),
    onToggleInventory: () => renderer.toggleInventory(),
    onEscape: () => renderer.closeUI(),
    isOverUI: (x, y) => renderer.isOverUI(x, y),
    onRightClickTile: (x, y) => renderer.tryOpenBlockUI(x, y),
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
