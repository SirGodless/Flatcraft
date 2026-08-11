import { GameServer, createLoopbackPair } from "@flatcraft/server";
import { Renderer } from "./render/renderer.js";

/**
 * Singleplayer bootstrap: an embedded GameServer connected through the
 * loopback transport. The client side of this file must only ever talk to
 * `connection` - switching to a remote server later means replacing the
 * loopback pair with a WebSocket-backed ClientConnection and deleting the
 * embedded server, nothing else.
 */
async function start(): Promise<void> {
  const server = new GameServer(/* seed */ 1337);

  const playerId = server.simulation.allocatePlayerId();
  const { server: serverEnd, client: connection } = createLoopbackPair(playerId);
  server.addConnection(serverEnd);

  const renderer = new Renderer();
  await renderer.init(document.getElementById("app")!);

  connection.onEvents((events) => {
    for (const event of events) {
      renderer.handleEvent(event);
    }
  });

  connection.send({ type: "join", name: "Player" });

  let last = performance.now();
  const frame = (now: number): void => {
    // Server ticks at a fixed rate regardless of frame rate...
    server.advance(now - last);
    last = now;
    // ...while rendering runs per frame on whatever state it has seen.
    renderer.draw();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void start();
