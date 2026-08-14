import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { BlockId } from "./block.js";

/**
 * A fixed-size grid of tiles. Chunks are flat typed arrays so they can be
 * serialized cheaply (network sync later, save files now).
 */
export class Chunk {
  readonly cx: number;
  readonly cy: number;
  readonly tiles: Uint16Array;
  /** Background wall layer (purely visual backdrop, e.g. cave walls). */
  readonly walls: Uint16Array;
  /** True once a tile actually changed from what's currently in `tiles`/
   * `walls` - never set by world generation itself (World.ensureChunk
   * resets it after generating+stamping a brand new chunk), only by real
   * mutation afterwards. Persistence uses this to skip saving chunks that
   * are still identical to what deterministic generation would produce
   * again anyway - see World.serializeChunks(). */
  dirty = false;
  /** Tick of the last ensureChunk() touch (see World.setCurrentTick) -
   * how World.evictIdle decides a chunk has gone unused long enough to
   * drop from memory. Defaults to 0, i.e. "not accessed yet this
   * session" - correct for a chunk that just came from a bulk load
   * (Simulation.deserialize/World.loadChunks) and hasn't been touched
   * again since: it's fair game for the very next idle sweep, exactly
   * like any other chunk nothing has asked for. */
  lastAccessTick = 0;

  constructor(cx: number, cy: number, tiles?: Uint16Array, walls?: Uint16Array) {
    this.cx = cx;
    this.cy = cy;
    this.tiles = tiles ?? new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT);
    this.walls = walls ?? new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT);
  }

  getBlock(localX: number, localY: number): BlockId {
    return (this.tiles[localY * CHUNK_WIDTH + localX] ?? 0) as BlockId;
  }

  setBlock(localX: number, localY: number, id: BlockId): void {
    const index = localY * CHUNK_WIDTH + localX;
    if (this.tiles[index] === id) return;
    this.tiles[index] = id;
    this.dirty = true;
  }

  getWall(localX: number, localY: number): BlockId {
    return (this.walls[localY * CHUNK_WIDTH + localX] ?? 0) as BlockId;
  }

  setWall(localX: number, localY: number, id: BlockId): void {
    const index = localY * CHUNK_WIDTH + localX;
    if (this.walls[index] === id) return;
    this.walls[index] = id;
    this.dirty = true;
  }
}

export function chunkKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/**
 * Run-length-encodes a tile/wall array as flattened [id, count, id, count,
 * ...] pairs. Terrain is heavily repetitive (long runs of the same block),
 * so this is usually a large reduction over one entry per tile - the point
 * is to make a dirty chunk's *saved* representation compact, independent
 * of whether the host format around it (JSON, a binary region file, ...)
 * does any further compression of its own.
 */
export function encodeRuns(values: Uint16Array): number[] {
  const runs: number[] = [];
  let i = 0;
  while (i < values.length) {
    const id = values[i]!;
    let count = 1;
    while (i + count < values.length && values[i + count] === id) count++;
    runs.push(id, count);
    i += count;
  }
  return runs;
}

/**
 * Inverse of encodeRuns. Requires the runs to sum to exactly `length` -
 * returns undefined otherwise rather than writing a partial/misaligned
 * array. This is a deliberate guard against misreading data that isn't
 * actually run-length-encoded (e.g. a pre-RLE save format's flat
 * one-entry-per-tile array happening to be fed in here): such data will
 * essentially never sum to exactly `length` by coincidence, so the bad
 * chunk is rejected instead of silently decoded into garbage terrain.
 */
export function decodeRuns(runs: readonly number[], length: number): Uint16Array | undefined {
  const out = new Uint16Array(length);
  let i = 0;
  for (let r = 0; r < runs.length; r += 2) {
    const id = runs[r];
    const count = runs[r + 1];
    if (id === undefined || count === undefined || count <= 0 || i + count > length) return undefined;
    out.fill(id, i, i + count);
    i += count;
  }
  return i === length ? out : undefined;
}

/**
 * Rebuilds a Chunk from run-length-encoded tiles/walls (as produced by
 * World.serializeChunks() or a dedicated server's region-file reader),
 * optionally remapping block ids through a save-palette remap (see
 * buildBlockRemap in simulation.ts) - the same treatment
 * Simulation.deserialize applies to bulk-loaded chunks, reused here so a
 * chunk lazily loaded on demand gets identical handling. Returns undefined
 * if either array fails to decode (see decodeRuns) - never throws, so a
 * corrupt/foreign chunk just falls back to fresh generation instead of
 * crashing the caller.
 */
export function decodeChunk(
  cx: number,
  cy: number,
  tileRuns: readonly number[],
  wallRuns: readonly number[] | undefined,
  remap?: ReadonlyMap<number, number> | null,
): Chunk | undefined {
  const size = CHUNK_WIDTH * CHUNK_HEIGHT;
  const tiles = decodeRuns(tileRuns, size);
  if (!tiles) return undefined;
  // Saves from before the wall layer existed have no wallRuns at all -
  // that means "no walls", not "corrupt", so it gets a fresh all-air
  // array instead of going through decodeRuns's strict length check.
  const walls = wallRuns !== undefined ? decodeRuns(wallRuns, size) : new Uint16Array(size);
  if (!walls) return undefined;
  if (remap) {
    for (let i = 0; i < tiles.length; i++) tiles[i] = remap.get(tiles[i]!) ?? tiles[i]!;
    for (let i = 0; i < walls.length; i++) walls[i] = remap.get(walls[i]!) ?? walls[i]!;
  }
  return new Chunk(cx, cy, tiles, walls);
}
