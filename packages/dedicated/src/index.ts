import { GameServer } from "@flatcraft/server";
import { TICK_MS, TICK_RATE } from "@flatcraft/sim";

/**
 * Dedicated server entry point: the same GameServer the client embeds,
 * driven by a Node interval instead of requestAnimationFrame. A WebSocket
 * listener that turns sockets into ServerConnections plugs in here later.
 */
const server = new GameServer(/* seed */ 1337);

console.log(`FlatCraft dedicated server - ${TICK_RATE} ticks/s (headless stub, no networking yet)`);

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  server.advance(now - last);
  last = now;
}, TICK_MS);
