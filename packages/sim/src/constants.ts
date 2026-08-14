/** Simulation tick rate. All game logic advances in fixed steps of TICK_MS. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** Chunk dimensions in tiles. Chunks are the unit of world streaming and sync. */
export const CHUNK_WIDTH = 32;
export const CHUNK_HEIGHT = 32;

/** A resident chunk that's gone unused this long (see Chunk.lastAccessTick)
 * is safe to drop from memory - see World.evictIdle. */
export const CHUNK_IDLE_EVICT_TICKS = 6000; // 5 minutes
