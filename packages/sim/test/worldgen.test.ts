import { describe, expect, it } from "vitest";
import {
  BEDROCK_Y,
  biomeAt,
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_WIDTH,
  SEA_LEVEL,
  surfaceHeight,
  treeAt,
  World,
} from "../src/index.js";

const SEED = 1337;

function freshWorld(): World {
  return new World(SEED);
}

describe("world generation", () => {
  it("is independent of chunk generation order", () => {
    const a = freshWorld();
    a.ensureChunk(0, 0);
    a.ensureChunk(1, 0);
    const b = freshWorld();
    b.ensureChunk(1, 0);
    b.ensureChunk(0, 0);
    expect(Array.from(a.ensureChunk(0, 0).tiles)).toEqual(Array.from(b.ensureChunk(0, 0).tiles));
    expect(Array.from(a.ensureChunk(1, 0).tiles)).toEqual(Array.from(b.ensureChunk(1, 0).tiles));
  });

  it("has a solid bedrock floor", () => {
    const world = freshWorld();
    const chunk = world.ensureChunk(0, Math.floor(BEDROCK_Y / CHUNK_HEIGHT));
    const localBedrockStart = BEDROCK_Y % CHUNK_HEIGHT;
    for (let lx = 0; lx < CHUNK_WIDTH; lx++) {
      for (let ly = localBedrockStart; ly < CHUNK_HEIGHT; ly++) {
        expect(chunk.getBlock(lx, ly)).toBe(BlockId.Bedrock);
      }
    }
  });

  it("covers low terrain with water and never grass", () => {
    const world = freshWorld();
    let lakes = 0;
    for (let x = 0; x < 512; x++) {
      const surface = surfaceHeight(SEED, x);
      if (surface <= SEA_LEVEL) continue;
      lakes++;
      expect(world.getBlockGenerating(x, SEA_LEVEL)).toBe(BlockId.Water);
      expect(world.getBlockGenerating(x, surface)).not.toBe(BlockId.Grass);
    }
    expect(lakes).toBeGreaterThan(0);
  });

  it("carves caves below the surface", () => {
    const world = freshWorld();
    let airBelowGround = 0;
    for (let x = 0; x < 128; x++) {
      const surface = surfaceHeight(SEED, x);
      for (let y = surface + 8; y < 200; y++) {
        if (world.getBlockGenerating(x, y) === BlockId.Air) airBelowGround++;
      }
    }
    expect(airBelowGround).toBeGreaterThan(100);
  });

  it("places shallow and deep ores in their depth bands", () => {
    const world = freshWorld();
    const found = new Set<BlockId>();
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = 0; cy <= 7; cy++) {
        for (const tile of world.ensureChunk(cx, cy).tiles) {
          found.add(tile as BlockId);
        }
      }
    }
    expect(found).toContain(BlockId.CoalOre);
    expect(found).toContain(BlockId.IronOre);
    expect(found).toContain(BlockId.GoldOre);
    expect(found).toContain(BlockId.DiamondOre);
    expect(found).toContain(BlockId.Gravel);
    expect(found).toContain(BlockId.Clay); // rare underground blobs, away from any shore

    // Diamond must never appear above its minimum depth (y >= 192 -> cy >= 6).
    for (let cx = -4; cx <= 4; cx++) {
      for (let cy = 0; cy <= 5; cy++) {
        const tiles = Array.from(world.ensureChunk(cx, cy).tiles);
        expect(tiles).not.toContain(BlockId.DiamondOre);
      }
    }
  });

  it("grows trees in forests, consistent across chunk borders", () => {
    const world = freshWorld();
    // Find a forest tree on dry land.
    let tree = null;
    for (let x = 0; x < 4096 && !tree; x++) {
      if (biomeAt(SEED, x) === "flatcraft:biome:forest") {
        tree = treeAt(SEED, x);
      }
    }
    expect(tree).not.toBeNull();
    // Forests mix oak and birch; the trunk/canopy match the tree's wood.
    const log = tree!.wood === "flatcraft:wood:birch" ? BlockId.BirchLog : BlockId.OakLog;
    const leaves = tree!.wood === "flatcraft:wood:birch" ? BlockId.BirchLeaves : BlockId.OakLeaves;
    // Trunk occupies the column above the surface...
    expect(world.getBlockGenerating(tree!.x, tree!.surface - 1)).toBe(log);
    // ...and the canopy reaches into neighboring columns (and possibly the
    // neighboring chunk - getBlockGenerating loads whatever chunk is needed).
    const topY = tree!.surface - tree!.height;
    expect(world.getBlockGenerating(tree!.x + 1, topY)).toBe(leaves);
    expect(world.getBlockGenerating(tree!.x - 1, topY)).toBe(leaves);
  });

  it("gives spruce a taller trunk and a narrower canopy than round-canopy woods (data-driven wood shape)", () => {
    const world = freshWorld();
    let tree = null;
    for (let x = 0; x < 4096 && !tree; x++) {
      if (biomeAt(SEED, x) === "flatcraft:biome:mountains") {
        const t = treeAt(SEED, x);
        if (t?.wood === "flatcraft:wood:spruce") tree = t;
      }
    }
    expect(tree).not.toBeNull();
    // 4 base + spruce's extra_height:2 + 0..2 roll.
    expect(tree!.height).toBeGreaterThanOrEqual(6);
    const topY = tree!.surface - tree!.height;
    // Narrow canopy_shape: the row just below the top (dy=-1) doesn't
    // reach 2 columns out...
    expect(world.getBlockGenerating(tree!.x + 2, topY - 1)).not.toBe(BlockId.SpruceLeaves);
    // ...but the row at the top (dy=0) does.
    expect(world.getBlockGenerating(tree!.x + 2, topY)).toBe(BlockId.SpruceLeaves);
  });

  it("keeps deserts sandy and snowy peaks snowy", () => {
    const world = freshWorld();
    let desertChecked = false;
    let snowChecked = false;
    for (let x = -2048; x < 2048; x++) {
      const surface = surfaceHeight(SEED, x);
      if (surface > SEA_LEVEL - 1) continue; // skip beaches/underwater
      const biome = biomeAt(SEED, x);
      if (!desertChecked && biome === "flatcraft:biome:desert") {
        expect(world.getBlockGenerating(x, surface)).toBe(BlockId.Sand);
        desertChecked = true;
      }
      if (!snowChecked && biome === "flatcraft:biome:mountains" && surface <= -14) {
        expect(world.getBlockGenerating(x, surface)).toBe(BlockId.Snow);
        snowChecked = true;
      }
      if (desertChecked && snowChecked) break;
    }
    expect(desertChecked).toBe(true);
    expect(snowChecked).toBe(true);
  });

  it("dots clay patches into the shoreline sand", () => {
    const world = freshWorld();
    let clayAtShore = 0;
    for (let x = 0; x < 2048; x++) {
      const surface = surfaceHeight(SEED, x);
      const underwater = surface > SEA_LEVEL;
      const beach = !underwater && surface >= SEA_LEVEL - 1;
      if (!underwater && !beach) continue;
      for (let y = surface; y <= surface + 2; y++) {
        if (world.getBlockGenerating(x, y) === BlockId.Clay) clayAtShore++;
      }
    }
    expect(clayAtShore).toBeGreaterThan(0);
  });
});

describe("background walls", () => {
  it("caves have earth walls behind them, sky has none", () => {
    const world = new World(SEED);
    let cavesWithWalls = 0;
    for (let x = 0; x < 64; x++) {
      const surface = surfaceHeight(SEED, x);
      const chunkAbove = world.ensureChunk(Math.floor(x / 32), Math.floor((surface - 3) / 32));
      const lx = x - Math.floor(x / 32) * 32;
      const lyAbove = surface - 3 - Math.floor((surface - 3) / 32) * 32;
      expect(chunkAbove.getWall(lx, lyAbove)).toBe(BlockId.Air); // sky
      for (let y = surface + 8; y < 200; y++) {
        const chunk = world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
        const ly = y - Math.floor(y / 32) * 32;
        if (chunk.getBlock(lx, ly) === BlockId.Air && chunk.getWall(lx, ly) !== BlockId.Air) {
          cavesWithWalls++;
        }
      }
    }
    expect(cavesWithWalls).toBeGreaterThan(50);
  });
});
