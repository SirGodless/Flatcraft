import type { ClientConnection } from "@flatcraft/server";
import { WS_PATH, type AuthRequest, type ServerMessage } from "@flatcraft/server";
import type { Command, PlayerId, SimEvent } from "@flatcraft/sim";

/**
 * WebSocket implementation of ClientConnection. Mirrors the loopback
 * transport from the game's point of view: after `connectWebSocket`
 * resolves, the returned connection behaves exactly like the embedded
 * singleplayer one - the rest of the client cannot tell the difference.
 */

/** How often a ping probe is sent while connected (debug overlay only). */
const PING_INTERVAL_MS = 2000;

export interface OnlineSession {
  connection: ClientConnection;
  playerId: PlayerId;
  /** The account name the server authenticated (always use this, not the
   * locally typed one - the server owns identity). */
  name: string;
  /** Session token for auto-login next time. */
  token: string;
  /** Fired once when the socket drops after a successful login. */
  onDisconnect(handler: () => void): void;
  /** Fired with the round-trip time (ms) whenever a ping probe completes -
   * see PING_INTERVAL_MS. Debug overlay only; nothing else depends on it. */
  onPing(handler: (ms: number) => void): void;
}

export function connectWebSocket(auth: { name: string; token: string }): Promise<OnlineSession> {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${proto}://${location.host}${WS_PATH}`);

  return new Promise<OnlineSession>((resolve, reject) => {
    let established = false;
    let eventsHandler: ((events: readonly SimEvent[]) => void) | undefined;
    let disconnectHandler: (() => void) | undefined;
    let pingHandler: ((ms: number) => void) | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    socket.onopen = () => {
      const request: AuthRequest = { type: "auth", ...auth };
      socket.send(JSON.stringify(request));
    };

    socket.onmessage = (raw: MessageEvent<string>) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(raw.data) as ServerMessage;
      } catch {
        return;
      }
      if (message.type === "auth_ok") {
        established = true;
        const connection: ClientConnection = {
          playerId: message.playerId,
          send(command: Command) {
            if (socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: "command", command }));
            }
          },
          onEvents(handler) {
            eventsHandler = handler;
          },
          close() {
            if (pingTimer !== undefined) clearInterval(pingTimer);
            socket.close();
          },
        };
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping", sentAt: performance.now() }));
          }
        }, PING_INTERVAL_MS);
        resolve({
          connection,
          playerId: message.playerId,
          name: message.name,
          token: message.token,
          onDisconnect(handler) {
            disconnectHandler = handler;
          },
          onPing(handler) {
            pingHandler = handler;
          },
        });
      } else if (message.type === "auth_error") {
        reject(new Error(message.reason));
        socket.close();
      } else if (message.type === "events") {
        eventsHandler?.(message.events);
      } else if (message.type === "pong") {
        pingHandler?.(performance.now() - message.sentAt);
      }
    };

    socket.onclose = () => {
      if (pingTimer !== undefined) clearInterval(pingTimer);
      if (established) {
        disconnectHandler?.();
      } else {
        reject(new Error("connection failed"));
      }
    };
    socket.onerror = () => {
      if (!established) reject(new Error("connection failed"));
    };
  });
}
