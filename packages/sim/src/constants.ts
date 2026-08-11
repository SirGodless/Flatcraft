/** Simulation tick rate. All game logic advances in fixed steps of TICK_MS. */
export const TICK_RATE = 20;
export const TICK_MS = 1000 / TICK_RATE;

/** Chunk dimensions in tiles. Chunks are the unit of world streaming and sync. */
export const CHUNK_WIDTH = 32;
export const CHUNK_HEIGHT = 32;
