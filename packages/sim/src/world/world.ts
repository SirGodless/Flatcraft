import { CHUNK_HEIGHT, CHUNK_WIDTH } from "../constants.js";
import { BlockId } from "./block.js";
import { Chunk, chunkKey } from "./chunk.js";
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

  constructor(seed: number, dimension: Dimension = "overworld") {
    this.seed = seed;
    this.dimension = dimension;
  }

  getChunk(cx: number, cy: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cy));
  }

  setChunk(chunk: Chunk): void {
    this.chunks.set(chunkKey(chunk.cx, chunk.cy), chunk);
  }

  /** Get the chunk, generating it deterministically from the seed if needed. */
  ensureChunk(cx: number, cy: number): Chunk {
    let chunk = this.getChunk(cx, cy);
    if (!chunk) {
      chunk =
        this.dimension === "nether"
          ? generateNetherChunk(this.seed, cx, cy)
          : generateChunk(this.seed, cx, cy);
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

  loadedChunks(): Iterable<Chunk> {
    return this.chunks.values();
  }

  /** All generated chunks as plain data (for saves). */
  serializeChunks(): Array<{ cx: number; cy: number; tiles: number[]; walls?: number[] }> {
    return [...this.chunks.values()].map((c) => ({
      cx: c.cx,
      cy: c.cy,
      tiles: Array.from(c.tiles),
      walls: Array.from(c.walls),
    }));
  }

  loadChunks(data: Array<{ cx: number; cy: number; tiles: number[]; walls?: number[] }>): void {
    for (const c of data) {
      this.setChunk(
        new Chunk(c.cx, c.cy, new Uint16Array(c.tiles), c.walls ? new Uint16Array(c.walls) : undefined),
      );
    }
  }
}
