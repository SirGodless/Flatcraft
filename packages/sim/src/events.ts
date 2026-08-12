import type { PlayerId } from "./commands.js";
import type { EntityId } from "./entities.js";
import type { ItemStack } from "./inventory.js";
import type { BlockId } from "./world/block.js";
import type { Dimension } from "./world/world.js";

/**
 * Events describe state changes the simulation *decided* to make. They are
 * what clients render from and, in multiplayer, the server->client messages.
 * Like commands they must remain plain serializable data.
 */
export type SimEvent =
  | { type: "player_joined"; player: PlayerId; name: string; x: number; y: number; dim: Dimension; color: number }
  | { type: "player_left"; player: PlayerId }
  /** A player changed their body color. */
  | { type: "player_color"; player: PlayerId; color: number }
  | { type: "player_moved"; player: PlayerId; x: number; y: number }
  /** A player switched dimension (portal); position is the arrival spot. */
  | { type: "player_dimension"; player: PlayerId; dim: Dimension; x: number; y: number }
  | { type: "player_health"; player: PlayerId; health: number; max: number }
  /** Hunger bar sync (sent to its owner). */
  | { type: "player_hunger"; player: PlayerId; hunger: number; max: number }
  /** Active potion effects with remaining ticks (sent to the owner). */
  | { type: "player_effects"; player: PlayerId; effects: Record<string, number> }
  /** Time-of-day sync, sent on join and periodically (clients advance it
   * locally between updates). */
  | { type: "time_changed"; time: number }
  /** stack is present for item entities so clients can render the icon. */
  | { type: "entity_spawned"; id: EntityId; kind: string; dim: Dimension; x: number; y: number; stack?: ItemStack }
  | { type: "entity_moved"; id: EntityId; x: number; y: number }
  | { type: "entity_hurt"; id: EntityId; health: number }
  | { type: "entity_removed"; id: EntityId }
  | { type: "block_changed"; dim: Dimension; x: number; y: number; block: BlockId }
  /** Background wall layer changed (hammer mining / wall placement). */
  | { type: "wall_changed"; dim: Dimension; x: number; y: number; block: BlockId }
  /** Creative mode toggled (sent to the owner). */
  | { type: "player_creative"; player: PlayerId; on: boolean }
  /** Remaining air ticks while diving (sent to the owner). */
  | { type: "player_air"; player: PlayerId; air: number; max: number }
  /** Mining progress for crack overlays; total 0 clears the overlay. */
  | { type: "mining_progress"; player: PlayerId; x: number; y: number; progress: number; total: number }
  | { type: "chunk_data"; dim: Dimension; cx: number; cy: number; tiles: number[]; walls: number[] }
  /** Full inventory sync for its owner (small enough to send whole),
   * including the cursor stack and crafting grid. */
  | {
      type: "inventory_changed";
      player: PlayerId;
      slots: (ItemStack | null)[];
      selected: number;
      cursor: ItemStack | null;
      craftGrid: (ItemStack | null)[];
      armor: ItemStack | null;
      offhand: ItemStack | null;
    }
  /** Chest contents sync. */
  | { type: "chest_changed"; dim: Dimension; x: number; y: number; slots: (ItemStack | null)[] }
  /** Furnace state sync for everyone who can see/use it. */
  | {
      type: "furnace_changed";
      dim: Dimension;
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
