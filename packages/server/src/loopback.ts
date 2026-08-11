import type { Command, PlayerId, SimEvent } from "@flatcraft/sim";
import type { ClientConnection, ServerConnection } from "./transport.js";

/**
 * In-process transport: connects a client and a server living in the same
 * runtime (singleplayer, or the hosting player of a listen server).
 * Messages are structured-cloned so both sides only ever exchange
 * serializable data - the same constraint a real network imposes.
 */
export function createLoopbackPair(playerId: PlayerId): {
  server: ServerConnection;
  client: ClientConnection;
} {
  let commandHandler: ((command: Command) => void) | undefined;
  let eventsHandler: ((events: readonly SimEvent[]) => void) | undefined;

  const server: ServerConnection = {
    playerId,
    send(events) {
      eventsHandler?.(structuredClone(events));
    },
    onCommand(handler) {
      commandHandler = handler;
    },
    close() {
      commandHandler = undefined;
    },
  };

  const client: ClientConnection = {
    playerId,
    send(command) {
      commandHandler?.(structuredClone(command));
    },
    onEvents(handler) {
      eventsHandler = handler;
    },
    close() {
      eventsHandler = undefined;
    },
  };

  return { server, client };
}
