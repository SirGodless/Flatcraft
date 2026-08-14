import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BlockId, CHUNK_HEIGHT, CHUNK_WIDTH } from "@flatcraft/sim";
import { REGION_SIZE, RegionStore, type DirtyChunkRuns } from "../src/regions.js";

const CHUNK_TILES = CHUNK_WIDTH * CHUNK_HEIGHT;

function uniformChunk(cx: number, cy: number, blockId: number): DirtyChunkRuns {
  return { cx, cy, tiles: [blockId, CHUNK_TILES], walls: [BlockId.Air, CHUNK_TILES] };
}

let dir: string | null = null;

afterEach(() => {
  if (dir) {
    rmSync(dir, { recursive: true, force: true });
    dir = null;
  }
});

describe("RegionStore", () => {
  it("round-trips chunks, including ones in different regions", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    // (0,0) and (20,0) fall in different regions at REGION_SIZE=8.
    const a = uniformChunk(0, 0, BlockId.Stone);
    const b = uniformChunk(20, 0, BlockId.Glowstone);
    store.write("overworld", [a, b]);

    const loadedA = store.load("overworld", 0, 0, null);
    const loadedB = store.load("overworld", 20, 0, null);
    expect(loadedA?.getBlock(0, 0)).toBe(BlockId.Stone);
    expect(loadedB?.getBlock(0, 0)).toBe(BlockId.Glowstone);
  });

  it("returns undefined for a chunk that was never written", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    store.write("overworld", [uniformChunk(0, 0, BlockId.Stone)]);
    expect(store.load("overworld", 1, 1, null)).toBeUndefined(); // same region, empty slot
    expect(store.load("overworld", 100, 100, null)).toBeUndefined(); // a region file that doesn't exist at all
  });

  it("keeps dimensions separate", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    store.write("overworld", [uniformChunk(0, 0, BlockId.Stone)]);
    store.write("nether", [uniformChunk(0, 0, BlockId.Netherrack)]);
    expect(store.load("overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
    expect(store.load("nether", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Netherrack);
  });

  it("handles negative chunk coordinates correctly", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    const chunks = [-1, -8, -9, -20].map((cx) => uniformChunk(cx, -1, BlockId.Sand));
    store.write("overworld", chunks);
    for (const cx of [-1, -8, -9, -20]) {
      expect(store.load("overworld", cx, -1, null)?.getBlock(0, 0)).toBe(BlockId.Sand);
    }
  });

  it("applies a block-id remap on load", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    store.write("overworld", [uniformChunk(0, 0, 999)]);
    const remap = new Map([[999, BlockId.DiamondOre]]);
    expect(store.load("overworld", 0, 0, remap)?.getBlock(0, 0)).toBe(BlockId.DiamondOre);
  });

  it("degrades a corrupt region file to 'nothing saved' instead of throwing", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    store.write("overworld", [uniformChunk(0, 0, BlockId.Stone)]);
    // Overwrite with garbage after a valid write.
    const rx = Math.floor(0 / REGION_SIZE);
    const ry = Math.floor(0 / REGION_SIZE);
    writeFileSync(join(dir, "overworld", `r.${rx}.${ry}.bin`), Buffer.from([1, 2, 3]));
    expect(() => store.load("overworld", 0, 0, null)).not.toThrow();
    expect(store.load("overworld", 0, 0, null)).toBeUndefined();
  });

  it("a later write invalidates the read cache", () => {
    dir = mkdtempSync(join(tmpdir(), "flatcraft-region-test-"));
    const store = new RegionStore(dir);
    store.write("overworld", [uniformChunk(0, 0, BlockId.Stone)]);
    expect(store.load("overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Stone);
    store.write("overworld", [uniformChunk(0, 0, BlockId.Glowstone)]);
    expect(store.load("overworld", 0, 0, null)?.getBlock(0, 0)).toBe(BlockId.Glowstone);
  });
});
