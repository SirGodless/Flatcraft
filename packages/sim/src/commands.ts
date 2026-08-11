import type { BlockId } from "./world/block.js";

/**
 * Commands are the ONLY way anything outside the simulation requests a state
 * change ("client says what it wants to do"). The simulation validates each
 * command and either applies it or rejects it. In multiplayer these become
 * the client->server messages verbatim, so they must stay plain JSON data.
 */
export type PlayerId = number;

export type Command =
  | { type: "join"; name: string }
  | { type: "leave" }
  | { type: "move"; dx: -1 | 0 | 1; jump: boolean }
  | { type: "break_block"; x: number; y: number }
  | { type: "place_block"; x: number; y: number; block: BlockId };

/** A command attributed to the player who issued it. */
export interface PlayerCommand {
  player: PlayerId;
  command: Command;
}
