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
  | { type: "chunk_data"; cx: number; cy: number; tiles: number[] }
  | { type: "command_rejected"; player: PlayerId; reason: string };

/**
 * An event plus its audience. `to` limits delivery to a single player
 * (e.g. the chunk data they requested); omitted means broadcast to all.
 */
export interface OutboundEvent {
  to?: PlayerId;
  event: SimEvent;
}
