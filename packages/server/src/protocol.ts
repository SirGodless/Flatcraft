import type { Command, PlayerId, SimEvent } from "@flatcraft/sim";

/**
 * Wire protocol for the WebSocket transport, shared by the browser client
 * and the dedicated server. Plain JSON messages; the first client message
 * on a fresh socket must be an auth request, everything after auth_ok is
 * commands up / event batches down - the same Command/SimEvent types the
 * loopback transport carries.
 */

/** WebSocket endpoint path (kept stable for reverse-proxy configs). */
export const WS_PATH = "/ws";
/** Server-detection endpoint: the client probes this to pick online mode. */
export const INFO_PATH = "/api/info";

/** Response of INFO_PATH. `flatcraft` marks a real dedicated server (a
 * plain static host would answer with HTML or 404). */
export interface ServerInfo {
  flatcraft: true;
  name: string;
  players: number;
}

/** First message on a socket: a session token issued via the anfall-auth
 * login (see @flatcraft/dedicated's /auth/login, /auth/callback). */
export interface AuthRequest {
  type: "auth";
  name: string;
  token: string;
}

export type AuthResponse =
  | { type: "auth_ok"; playerId: PlayerId; name: string; token: string }
  | { type: "auth_error"; reason: string };

export interface CommandMessage {
  type: "command";
  command: Command;
}

export interface EventsMessage {
  type: "events";
  events: SimEvent[];
}

/** Round-trip latency probe (debug overlay only) - sentAt is the client's
 * own clock, echoed back unchanged, so RTT is just (now - sentAt) on
 * receipt; no clock sync between client and server is ever needed. */
export interface PingMessage {
  type: "ping";
  sentAt: number;
}

export interface PongMessage {
  type: "pong";
  sentAt: number;
}

export type ClientMessage = AuthRequest | CommandMessage | PingMessage;
export type ServerMessage = AuthResponse | EventsMessage | PongMessage;
