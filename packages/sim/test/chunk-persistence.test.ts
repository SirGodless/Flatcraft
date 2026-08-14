import { describe, expect, it } from "vitest";
import {
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_WIDTH,
  Chunk,
  decodeChunk,
  decodeRuns,
  encodeRuns,
  Simulation,
  World,
  type PlayerId,
} from "../src/index.js";

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player };
}

describe("run-length encoding", () => {
  it("round-trips uniform, striped and random data", () => {
    const size = CHUNK_WIDTH * CHUNK_HEIGHT;
    const uniform = new Uint16Array(size).fill(BlockId.Stone);
    const striped = new Uint16Array(size).map((_, i) => (i % 2 === 0 ? BlockId.Stone : BlockId.Air));
    const random = new Uint16Array(size).map(() => Math.floor(Math.random() * 50));

    for (const values of [uniform, striped, random]) {
      const runs = encodeRuns(values);
      const decoded = decodeRuns(runs, size);
      expect(decoded).toEqual(values);
    }
  });

  it("compresses a uniform array down to a single run", () => {
    const values = new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT).fill(BlockId.Stone);
    expect(encodeRuns(values)).toEqual([BlockId.Stone, values.length]);
  });

  it("rejects runs that don't sum to the expected length", () => {
    expect(decodeRuns([BlockId.Stone, 5], 10)).toBeUndefined(); // too short
    expect(decodeRuns([BlockId.Stone, 20], 10)).toBeUndefined(); // too long
    expect(decodeRuns([BlockId.Stone, 0], 0)).toBeUndefined(); // zero-length run is invalid
    // A pre-RLE flat array (one entry per tile, no run pairing) essentially
    // never happens to sum to the right length when misread as [id,count]
    // pairs - this is the actual defense against old-format data.
    const flatArray = Array.from({ length: 1024 }, () => 1);
    expect(decodeRuns(flatArray, 1024)).toBeUndefined();
  });
});

describe("chunk dirty tracking", () => {
  it("setBlock/setWall mark a chunk dirty only on an actual change", () => {
    const chunk = new Chunk(0, 0);
    expect(chunk.dirty).toBe(false);
    chunk.setBlock(1, 1, BlockId.Air); // already air - no-op
    expect(chunk.dirty).toBe(false);
    chunk.setBlock(1, 1, BlockId.Stone);
    expect(chunk.dirty).toBe(true);
  });

  it("freshly generated chunks (including stamped structures) are never dirty", () => {
    const world = new World(SEED);
    for (let cx = -2; cx <= 2; cx++) {
      expect(world.ensureChunk(cx, 0).dirty).toBe(false);
    }
  });

  it("only actually-modified chunks are saved; untouched chunks regenerate identically", () => {
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.ensureChunk(1, 0);
    world.setBlock(5, 5, BlockId.Glowstone); // touches chunk (0,0)
    expect(world.serializeChunks()).toHaveLength(1);
    expect(world.serializeChunks()[0]).toMatchObject({ cx: 0, cy: 0 });

    const restored = new World(SEED);
    restored.loadChunks(world.serializeChunks());
    expect(restored.getBlock(5, 5)).toBe(BlockId.Glowstone);
    // Chunk (1,0) was never saved - but regenerating it from the same
    // seed reproduces it exactly, so nothing is actually lost.
    expect(Array.from(restored.ensureChunk(1, 0).tiles)).toEqual(
      Array.from(world.ensureChunk(1, 0).tiles),
    );
  });

  it("a chunk loaded from a save is not itself dirty", () => {
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(2, 2, BlockId.Glowstone);
    const restored = new World(SEED);
    restored.loadChunks(world.serializeChunks());
    expect(restored.getChunk(0, 0)!.dirty).toBe(false);
  });

  it("opening a chest marks its chunk dirty even with no block edits", () => {
    // A chest placed via a raw tile write (not setBlock) - like one a
    // structure stamped in - starts out clean, same as any other
    // generated-but-untouched chunk.
    const sim = new Simulation(SEED);
    const { player } = joinPlayer(sim);
    const state = sim.players.get(player)!;
    const cx = Math.floor(state.x) + 1;
    const cy = Math.floor(state.y) - 1;
    const chunkX = Math.floor(cx / CHUNK_WIDTH);
    const chunkY = Math.floor(cy / CHUNK_HEIGHT);
    const localX = cx - chunkX * CHUNK_WIDTH;
    const localY = cy - chunkY * CHUNK_HEIGHT;
    const chunk = new Chunk(chunkX, chunkY);
    chunk.tiles[localY * CHUNK_WIDTH + localX] = BlockId.Chest;
    sim.world.setChunk(chunk);
    expect(sim.world.getChunk(chunkX, chunkY)!.dirty).toBe(false);

    sim.tick([{ player, command: { type: "open_chest", x: cx, y: cy } }]);
    expect(sim.world.getChunk(chunkX, chunkY)!.dirty).toBe(true);
    expect(sim.chests.size).toBe(1);
  });
});

describe("chunk loader (lazy on-demand persistence hook)", () => {
  it("ensureChunk prefers a loader-provided chunk over fresh generation", () => {
    const world = new World(SEED);
    const saved = new Chunk(3, 3);
    saved.setBlock(0, 0, BlockId.DiamondOre);
    world.setChunkLoader((cx, cy) => (cx === 3 && cy === 3 ? saved : undefined));
    const chunk = world.ensureChunk(3, 3);
    expect(chunk).toBe(saved);
    expect(chunk.getBlock(0, 0)).toBe(BlockId.DiamondOre);
  });

  it("falls back to generation when the loader has nothing for a chunk", () => {
    const world = new World(SEED);
    world.setChunkLoader(() => undefined);
    const generated = new World(SEED).ensureChunk(0, 0);
    expect(Array.from(world.ensureChunk(0, 0).tiles)).toEqual(Array.from(generated.tiles));
  });
});

describe("decodeChunk", () => {
  it("applies a block-id remap after decoding, not to the raw runs", () => {
    const tiles = new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT).fill(999);
    const runs = encodeRuns(tiles);
    const remap = new Map([[999, BlockId.Glowstone]]);
    const chunk = decodeChunk(0, 0, runs, undefined, remap);
    expect(chunk).toBeDefined();
    expect(chunk!.getBlock(0, 0)).toBe(BlockId.Glowstone);
  });

  it("returns undefined for corrupt runs instead of a partially-built chunk", () => {
    expect(decodeChunk(0, 0, [BlockId.Stone, 5], [])).toBeUndefined();
  });

  it("defaults missing walls to all-air (pre-wall-layer saves)", () => {
    const tiles = new Uint16Array(CHUNK_WIDTH * CHUNK_HEIGHT).fill(BlockId.Stone);
    const chunk = decodeChunk(0, 0, encodeRuns(tiles), undefined);
    expect(chunk).toBeDefined();
    expect(chunk!.getWall(0, 0)).toBe(BlockId.Air);
  });
});
