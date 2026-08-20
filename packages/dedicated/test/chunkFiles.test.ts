import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId, CHUNK_HEIGHT, CHUNK_WIDTH } from "@flatcraft/sim";
import { ChunkFileStore, type ChunkExtra } from "../src/chunkFiles.js";

const CHUNK_TILES = CHUNK_WIDTH * CHUNK_HEIGHT;
const EMPTY_EXTRA: ChunkExtra = { chests: [], furnaces: [] };

function uniformChunk(cx: number, cy: number, blockId: number): { cx: number; cy: number; tiles: number[]; walls: number[] } {
  return { cx, cy, tiles: [blockId, CHUNK_TILES], walls: [BlockId.Air, CHUNK_TILES] };
}

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("ChunkFileStore", () => {
  it("round-trips terrain for a single chunk", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
  });

  it("returns undefined for a chunk that was never written", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    expect(store.load("flatcraft:dimension:overworld", 1, 1, null)).toBeUndefined(); // never written at all
  });

  it("keeps dimensions separate", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    store.write("flatcraft:dimension:nether", [uniformChunk(0, 0, BlockId.Netherrack)], new Map());
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
    expect(store.load("flatcraft:dimension:nether", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Netherrack);
  });

  it("handles negative chunk coordinates correctly", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    const chunks = [-1, -8, -9, -20].map((cx) => uniformChunk(cx, -1, BlockId.Sand));
    store.write("flatcraft:dimension:overworld", chunks, new Map());
    for (const cx of [-1, -8, -9, -20]) {
      expect(store.load("flatcraft:dimension:overworld", cx, -1, null)?.getBlock(0, 0)).toBe(BlockId.Sand);
    }
  });

  it("applies a block-id remap on load", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, 999)], new Map());
    const remap = new Map([[999, BlockId.DiamondOre]]);
    expect(store.load("flatcraft:dimension:overworld", 0, 0, remap)?.getBlock(0, 0)).toBe(BlockId.DiamondOre);
  });

  it("degrades a corrupt chunk file to 'nothing saved' instead of throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    writeFileSync(join(dir, "flatcraft_dimension_overworld", "c.0.0.bin"), Buffer.from([1, 2, 3]));
    expect(() => store.load("flatcraft:dimension:overworld", 0, 0, null)).not.toThrow();
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)).toBeUndefined();
  });

  it("a later write invalidates the read cache", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Glowstone)], new Map());
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Glowstone);
  });

  it("carries chest/furnace state alongside the chunk's terrain", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    const extra: ChunkExtra = {
      chests: [{ x: 5, y: 5, slots: [{ item: "flatcraft:item:diamond", count: 3 }, null] }],
      furnaces: [
        {
          dimension: "flatcraft:dimension:overworld",
          x: 5,
          y: 6,
          input: null,
          fuel: { item: "flatcraft:item:coal", count: 1 },
          output: null,
          burnLeft: 100,
          burnTotal: 1600,
          cookProgress: 0,
          speed: 1,
        },
      ],
    };
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map([["0,0", extra]]));

    const scanned = store.scanAll();
    expect(scanned).toHaveLength(1);
    expect(scanned[0]!.extra.chests).toEqual(extra.chests);
    expect(scanned[0]!.extra.furnaces).toEqual(extra.furnaces);
  });

  it("scanAll finds every chunk file across both dimensions without decoding terrain", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone), uniformChunk(-5, 3, BlockId.Dirt)], new Map());
    store.write("flatcraft:dimension:nether", [uniformChunk(2, 2, BlockId.Netherrack)], new Map());
    const scanned = store.scanAll();
    expect(scanned).toHaveLength(3);
    expect(scanned.every((s) => s.extra.chests.length === 0 && s.extra.furnaces.length === 0)).toBe(true);
  });

  it("scanAll pre-warms the cache so a later load() doesn't re-read the file", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(dir);
    store.write("flatcraft:dimension:overworld", [uniformChunk(0, 0, BlockId.Stone)], new Map());
    store.scanAll();
    // Corrupt the file on disk *after* scanAll cached it - load() should
    // still succeed from the cache, proving it didn't hit the disk again.
    writeFileSync(join(dir, "flatcraft_dimension_overworld", "c.0.0.bin"), Buffer.from([1, 2, 3]));
    expect(store.load("flatcraft:dimension:overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
  });

  it("scanAll on an empty/nonexistent world directory returns nothing", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-chunkfile-test-"));
    const store = new ChunkFileStore(join(dir, "does-not-exist"));
    expect(store.scanAll()).toEqual([]);
  });
});
