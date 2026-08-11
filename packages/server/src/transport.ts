import type { Command, PlayerId, SimEvent } from "@flatcraft/sim";

/**
 * Transport abstraction. The GameServer only ever talks to these interfaces;
 * it does not know whether a connection is an in-process loopback
 * (singleplayer / listen server host) or a WebSocket (remote player).
 * Adding real netcode later means implementing this pair over WebSocket -
 * no change to server or simulation code.
 */

/** Server-side handle to one connected client. */
export interface ServerConnection {
  readonly playerId: PlayerId;
  send(events: readonly SimEvent[]): void;
  onCommand(handler: (command: Command) => void): void;
  close(): void;
}

/** Client-side handle to the server. */
export interface ClientConnection {
  readonly playerId: PlayerId;
  send(command: Command): void;
  onEvents(handler: (events: readonly SimEvent[]) => void): void;
  close(): void;
}
