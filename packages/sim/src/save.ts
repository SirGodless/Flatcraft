import type { Entity, PlayerEntity } from "./entities.js";
import type { FurnaceState } from "./furnace.js";
import type { ItemStack } from "./inventory.js";
import type { Dimension } from "./world/world.js";

/**
 * Complete simulation snapshot, plain data: JSON- and structured-clone-
 * safe, so it can go to IndexedDB (client) or a file (dedicated server).
 */
export interface SimSave {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  /**
   * Numeric block id -> canonical string id at save time. On load,
   * chunks are remapped by name, so the numbers in `worlds` are never
   * load-bearing: block ids can be renumbered (or added by mods)
   * without corrupting existing worlds. Absent in version-1 saves.
   */
  blockPalette?: Record<number, string>;
  seed: number;
  tickCount: number;
  timeOfDay: number;
  rng: number;
  /** Single allocator for both player and entity ids (one shared id space). */
  nextId: number;
  /**
   * One entry per registered dimension (see world/dimension.ts) - not a
   * fixed overworld/nether pair, since version 6, so a mod's own
   * dimension round-trips the same way the built-in two do. Only chunks
   * that differ from what deterministic generation would produce again
   * (World.serializeChunks skips anything still "clean") - a chunk that
   * was only ever visited, never changed, simply isn't here and
   * regenerates identically on load. `tiles`/`walls` are run-length-
   * encoded as flattened [id, count, id, count, ...] pairs (see
   * encodeRuns/decodeRuns in world/chunk.ts), not one entry per tile -
   * since version 5. `walls` is optional only for saves from before the
   * wall layer existed. Versions before 6 stored this as a fixed
   * `{overworld: [...], nether: [...]}` object instead of this array -
   * see Simulation.deserialize for the migration.
   */
  worlds: Array<{
    dim: Dimension;
    chunks: Array<{ cx: number; cy: number; tiles: number[]; walls?: number[] }>;
  }>;
  furnaces: FurnaceState[];
  chests?: Array<{ dimension: Dimension; x: number; y: number; slots: (ItemStack | null)[] }>;
  /** One entry per registered dimension, same reasoning and same
   * pre-version-6 migration as `worlds`. */
  portals: Array<{ dim: Dimension; positions: Array<{ x: number; y: number }> }>;
  /** Never contains player-kind entities - those are saved separately
   * below (both connected and disconnected-but-saved players). */
  entities: Entity[];
  players: PlayerEntity[];
}
