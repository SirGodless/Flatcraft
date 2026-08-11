import type { PlayerId } from "./commands.js";
import type { BlockId } from "./world/block.js";

/**
 * Events describe state changes the simulation *decided* to make. They are
 * what clients render from and, in multiplayer, the server->client messages.
 * Like commands they must remain plain serializable data.
 */
export type SimEvent =
  | { type: "player_joined"; player: PlayerId; name: string; x: number; y: number }
  | { type: "player_left"; player: PlayerId }
  | { type: "block_changed"; x: number; y: number; block: BlockId }
  | { type: "command_rejected"; player: PlayerId; reason: string };
