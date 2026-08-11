import type { PlayerId } from "./commands.js";
import type { ItemStack } from "./inventory.js";
import type { BlockId } from "./world/block.js";

/**
 * Events describe state changes the simulation *decided* to make. They are
 * what clients render from and, in multiplayer, the server->client messages.
 * Like commands they must remain plain serializable data.
 */
export type SimEvent =
  | { type: "player_joined"; player: PlayerId; name: string; x: number; y: number }
  | { type: "player_left"; player: PlayerId }
  | { type: "player_moved"; player: PlayerId; x: number; y: number }
  | { type: "block_changed"; x: number; y: number; block: BlockId }
  /** Mining progress for crack overlays; total 0 clears the overlay. */
  | { type: "mining_progress"; player: PlayerId; x: number; y: number; progress: number; total: number }
  | { type: "chunk_data"; cx: number; cy: number; tiles: number[] }
  /** Full inventory sync for its owner (small enough to send whole),
   * including the cursor stack and crafting grid. */
  | {
      type: "inventory_changed";
      player: PlayerId;
      slots: (ItemStack | null)[];
      selected: number;
      cursor: ItemStack | null;
      craftGrid: (ItemStack | null)[];
    }
  /** Furnace state sync for everyone who can see/use it. */
  | {
      type: "furnace_changed";
      x: number;
      y: number;
      input: ItemStack | null;
      fuel: ItemStack | null;
      output: ItemStack | null;
      burnLeft: number;
      burnTotal: number;
      cookProgress: number;
      cookTotal: number;
    }
  | { type: "command_rejected"; player: PlayerId; reason: string };

/**
 * An event plus its audience. `to` limits delivery to a single player
 * (e.g. the chunk data they requested); omitted means broadcast to all.
 */
export interface OutboundEvent {
  to?: PlayerId;
  event: SimEvent;
}
