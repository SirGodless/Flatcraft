import type { Entity } from "./entities.js";
import type { FurnaceState } from "./furnace.js";
import type { ItemStack } from "./inventory.js";
import type { PlayerState } from "./simulation.js";
import type { Dimension } from "./world/world.js";

/**
 * Complete simulation snapshot, plain data: JSON- and structured-clone-
 * safe, so it can go to IndexedDB (client) or a file (dedicated server).
 */
export interface SimSave {
  version: 1;
  seed: number;
  tickCount: number;
  timeOfDay: number;
  rng: number;
  nextPlayerId: number;
  nextEntityId: number;
  worlds: {
    overworld: Array<{ cx: number; cy: number; tiles: number[] }>;
    nether: Array<{ cx: number; cy: number; tiles: number[] }>;
  };
  furnaces: FurnaceState[];
  chests?: Array<{ dimension: Dimension; x: number; y: number; slots: (ItemStack | null)[] }>;
  portals: {
    overworld: Array<{ x: number; y: number }>;
    nether: Array<{ x: number; y: number }>;
  };
  entities: Entity[];
  players: PlayerState[];
}
