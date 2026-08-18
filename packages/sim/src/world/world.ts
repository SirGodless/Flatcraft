import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { stampStructures } from "../structures/place.js";
import { BlockId } from "./block.js";
import { Chunk, chunkKey, decodeChunk, encodeRuns } from "./chunk.js";
import { generateDimensionChunk } from "./dimension.js";

/**
 * A registered dimension id (see dimension.ts) - "overworld" and
 * "nether" are just the two the engine ships with, registered the same
 * way a mod's own dimension would be. Not a closed union: a World can
 * be constructed for any id that's been registered with
 * registerDimension before that World is used.
 */
export type Dimension = string;

/**
 * World state: a sparse grid of chunks. Purely data + accessors; world
 * *generation* will live in its own module and populate chunks on demand.
 */
export class World {
  readonly seed: number;
  readonly dimension: Dimension;
  private readonly chunks = new Map<string, Chunk>();
  /** Consulted by ensureChunk before falling back to generation - lets a
   * host (e.g. the dedicated server's region files) hand back a
   * previously-modified chunk on first touch, without World knowing
   * anything about disk/IndexedDB/etc itself (this package stays I/O-free;
   * the loader is just a plain function the host injects). Returning
   * undefined means "nothing saved for this chunk", not an error - the
   * chunk is generated fresh exactly as if no loader were set at all. */
  private chunkLoader: ((cx: number, cy: number) => Chunk | undefined) | undefined;
  /** Set once per simulation tick (see Simulation.tick), so ensureChunk
   * can stamp each chunk it touches with "last used" for idle eviction -
   * see Chunk.lastAccessTick / evictIdle. World itself has no clock of
   * its own (this package stays I/O- and time-free), it just remembers
   * whatever tick it was last told about. */
  private currentTick = 0;

  constructor(seed: number, dimension: Dimension = "overworld") {
    this.seed = seed;
    this.dimension = dimension;
  }

  setChunkLoader(loader: ((cx: number, cy: number) => Chunk | undefined) | undefined): void {
    this.chunkLoader = loader;
  }

  setCurrentTick(tick: number): void {
    this.currentTick = tick;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cy), chunk);
  }

  /** Marks the chunk at (cx, cy) dirty without touching any tile - for
   * state that's anchored to this chunk but doesn't live in Chunk itself
   * (e.g. a chest/furnace's contents, which Simulation tracks
   * separately). A chunk whose only "edit" is a chest being opened for
   * the first time is otherwise indistinguishable from an untouched one
   * and would silently never get saved - see Simulation.ensureChest. A
   * no-op if the chunk isn't currently resident (nothing to mark). */
  touchChunk(cx: number, cy: number): void {
    const chunk = this.getChunk(cx, cy);
    if (chunk) chunk.dirty = true;
  }

  /** Get the chunk: already resident, else previously-saved (via the
   * chunk loader, if one is set), else generated deterministically from
   * the seed. */
  ensureChunk(cx: number, cy: number): Chunk {
    let chunk = this.getChunk(cx, cy);
    if (!chunk) {
      chunk = this.chunkLoader?.(cx, cy);
      if (!chunk) {
        chunk = generateDimensionChunk(this.dimension, this.seed, cx, cy);
        stampStructures(this.seed, this.dimension, chunk);
        // Generation (including structure stamping) writes through the
        // same setBlock/setWall as gameplay does and so marks the chunk
        // dirty as a side effect - but a freshly generated, untouched
        // chunk is by definition identical to what generation would
        // produce again, so it doesn't need saving until something
        // actually changes it afterwards.
        chunk.dirty = false;
      }
      this.setChunk(chunk);
    }
    chunk.lastAccessTick = this.currentTick;
    return chunk;
  }

  /** Like getBlock, but generates the containing chunk if needed (physics
   * must never treat ungenerated terrain as air). */
  getBlockGenerating(x: number, y: number): BlockId {
    this.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
    return this.getBlock(x, y);
  }

  getBlock(x: number, y: number): BlockId {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return BlockId.Air;
    return chunk.getBlock(x - cx * CHUNK_WIDTH, y - cy * CHUNK_HEIGHT);
  }

  setBlock(x: number, y: number, id: BlockId): boolean {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return false;
    chunk.setBlock(x - cx * CHUNK_WIDTH, y - cy * CHUNK_HEIGHT, id);
    return true;
  }

  getWall(x: number, y: number): BlockId {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return BlockId.Air;
    return chunk.getWall(x - cx * CHUNK_WIDTH, y - cy * CHUNK_HEIGHT);
  }

  getWallGenerating(x: number, y: number): BlockId {
    this.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
    return this.getWall(x, y);
  }

  setWall(x: number, y: number, id: BlockId): boolean {
    const cx = Math.floor(x / CHUNK_WIDTH);
    const cy = Math.floor(y / CHUNK_HEIGHT);
    const chunk = this.getChunk(cx, cy);
    if (!chunk) return false;
    chunk.setWall(x - cx * CHUNK_WIDTH, y - cy * CHUNK_HEIGHT, id);
    return true;
  }

  loadedChunks(): Iterable<Chunk> {
    return this.chunks.values();
  }

  /** Only chunks that differ from what generation would produce again
   * (see ensureChunk's dirty reset) - run-length-encoded, since terrain
   * is heavily repetitive. A chunk that was only ever visited, never
   * changed, saves nothing at all and regenerates identically on load. */
  serializeChunks(): Array<{ cx: number; cy: number; tiles: number[]; walls: number[] }> {
    const out: Array<{ cx: number; cy: number; tiles: number[]; walls: number[] }> = [];
    for (const c of this.chunks.values()) {
      if (!c.dirty) continue;
      out.push({ cx: c.cx, cy: c.cy, tiles: encodeRuns(c.tiles), walls: encodeRuns(c.walls) });
    }
    return out;
  }

  /** Loads run-length-encoded dirty chunks (see serializeChunks), each
   * put through `remap` if given (see buildBlockRemap - a renumbered
   * registry between saves). A chunk whose runs fail to decode (see
   * decodeRuns) is skipped rather than loaded corrupt - it simply
   * regenerates fresh on next touch, same as any never-saved chunk. */
  loadChunks(
    data: Array<{ cx: number; cy: number; tiles: number[]; walls?: number[] }>,
    remap?: ReadonlyMap<number, number> | null,
  ): void {
    for (const c of data) {
      const chunk = decodeChunk(c.cx, c.cy, c.tiles, c.walls, remap);
      if (chunk) this.setChunk(chunk);
    }
  }

  /** Marks chunks clean again once a host has *confirmedly* persisted
   * whatever serializeChunks() handed it (e.g. the chunk files actually
   * landed on disk) - never call this before the write is known to have
   * succeeded. Getting that order backwards would mark a chunk clean
   * despite its edits never having reached disk, so a later crash (or
   * evictIdle, once introduced) could lose them silently - exactly the
   * kind of gap Simulation.ensureChest's touchChunk fix exists to avoid
   * elsewhere. No-op for any entry that isn't currently resident. */
  markSaved(entries: Iterable<{ cx: number; cy: number }>): void {
    for (const { cx, cy } of entries) {
      const chunk = this.getChunk(cx, cy);
      if (chunk) chunk.dirty = false;
    }
  }

  /** Drops resident chunks that haven't been touched in `idleTicks` ticks
   * (see Chunk.lastAccessTick) and have no unsaved changes (see
   * Chunk.dirty) - a chunk with pending edits is always kept until a
   * save cycle calls markSaved for it, however idle it looks in the
   * meantime. Nothing is lost either way: a clean chunk is by
   * definition either never modified (regenerates identically from the
   * seed) or already safely persisted (reloads identically via the
   * chunk loader) - eviction just frees the in-memory copy, exactly
   * like never having visited it this session. A chunk still in active
   * use - a player standing in or near it, a live entity ticking
   * through it, anything currently reading/writing it - gets touched
   * again via ensureChunk every tick it's relevant, so it never goes
   * idle in the first place; only genuinely abandoned chunks qualify.
   * Returns the number of chunks evicted, for host-side logging. */
  evictIdle(idleTicks: number): number {
    let evicted = 0;
    for (const [key, chunk] of this.chunks) {
      if (chunk.dirty) continue;
      if (this.currentTick - chunk.lastAccessTick < idleTicks) continue;
      this.chunks.delete(key);
      evicted++;
    }
    return evicted;
  }
}
