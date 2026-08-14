import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { stampStructures } from "../structures/place.js";
import { BlockId } from "./block.js";
import { Chunk, chunkKey, decodeChunk, encodeRuns } from "./chunk.js";
import { generateChunk } from "./gen.js";
import { generateNetherChunk } from "./nether.js";

export type Dimension = "overworld" | "nether";

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

  constructor(seed: number, dimension: Dimension = "overworld") {
    this.seed = seed;
    this.dimension = dimension;
  }

  setChunkLoader(loader: ((cx: number, cy: number) => Chunk | undefined) | undefined): void {
    this.chunkLoader = loader;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cy), chunk);
  }

  /** Get the chunk: already resident, else previously-saved (via the
   * chunk loader, if one is set), else generated deterministically from
   * the seed. */
  ensureChunk(cx: number, cy: number): Chunk {
    let chunk = this.getChunk(cx, cy);
    if (!chunk) {
      chunk = this.chunkLoader?.(cx, cy);
      if (!chunk) {
        chunk =
          this.dimension === "nether"
            ? generateNetherChunk(this.seed, cx, cy)
            : generateChunk(this.seed, cx, cy);
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
}
