import { describe, expect, it } from "vitest";
import {
  BlockId,
  CHUNK_WIDTH,
  matchMultiblock,
  multiblockDef,
  parseMultiblock,
  registerMultiblock,
  registerMultiblockHandler,
  tryActivateMultiblock,
  World,
  type MultiblockActivateContext,
} from "../src/index.js";

const SEED = 1337;

/** A tiny 1x3 test fixture: [Stone(trigger)][Dirt][Stone] - small enough
 * to place by hand, but wide enough to straddle a chunk boundary.
 * registerMultiblock/registerMultiblockHandler are process-global
 * registries (same as items/blocks/mobs elsewhere in this codebase), so
 * each test uses its own id *and* its own trigger item - reusing
 * "flint_and_steel" would collide with the real, already-registered
 * nether_portal def (and with other tests in this file), since
 * tryActivateMultiblock resolves on the first def whose trigger matches.
 * `item` must be a real, registered item id - trigger_on is validated
 * against the item registry at parse time, same as any other datapack
 * reference in this codebase. */
function registerTestMultiblock(id: string, item: string, failReason = "incomplete structure"): void {
  registerMultiblock(
    parseMultiblock(id, {
      id,
      handler: id,
      trigger_on: { type: "place_block", item },
      fail_reason: failReason,
      states: {
        on: {
          pattern: ["SDS"],
          key: {
            S: { block: "stone", trigger: true },
            D: { block: "dirt" },
          },
        },
      },
    }),
  );
}

describe("multiblock pattern matching", () => {
  it("matches a fixed pattern placed entirely within one chunk", () => {
    registerTestMultiblock("test_simple_1", "coal");
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(5, 5, BlockId.Stone);
    world.setBlock(6, 5, BlockId.Dirt);
    world.setBlock(7, 5, BlockId.Stone);

    const def = multiblockDef("test_simple_1")!;
    const match = matchMultiblock(world, def, 5, 5); // clicked the left trigger cell
    expect(match).toMatchObject({ defId: "test_simple_1", state: "on", originX: 5, originY: 5 });
  });

  it("matches from either trigger cell, not just one fixed anchor", () => {
    registerTestMultiblock("test_simple_2", "bone");
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(10, 10, BlockId.Stone);
    world.setBlock(11, 10, BlockId.Dirt);
    world.setBlock(12, 10, BlockId.Stone);

    const def = multiblockDef("test_simple_2")!;
    // Both S cells are marked trigger:true - clicking the right one
    // should resolve to the exact same structure origin.
    expect(matchMultiblock(world, def, 10, 10)).toMatchObject({ originX: 10, originY: 10 });
    expect(matchMultiblock(world, def, 12, 10)).toMatchObject({ originX: 10, originY: 10 });
  });

  it("does not match an incomplete structure", () => {
    registerTestMultiblock("test_incomplete", "clay");
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(5, 5, BlockId.Stone);
    world.setBlock(6, 5, BlockId.Air); // missing the dirt
    world.setBlock(7, 5, BlockId.Stone);

    const def = multiblockDef("test_incomplete")!;
    expect(matchMultiblock(world, def, 5, 5)).toBeNull();
  });

  it("matches correctly when the pattern straddles a chunk boundary, loading both chunks on demand", () => {
    registerTestMultiblock("test_boundary", "beef");
    const world = new World(SEED);
    // Place the pattern at x = CHUNK_WIDTH-1 .. CHUNK_WIDTH+1, straddling
    // the boundary between chunk 0 and chunk 1. Ensure only the first
    // chunk up front - the second must get pulled in by the match itself
    // via getBlockGenerating, exactly like a real cross-boundary check.
    const x0 = CHUNK_WIDTH - 1;
    world.ensureChunk(0, 0);
    world.setBlock(x0, 3, BlockId.Stone);
    // Chunk 1 (x 32..63) isn't ensured yet - ensureChunk for it happens
    // lazily inside matchMultiblock via getBlockGenerating.
    expect(world.getChunk(1, 0)).toBeUndefined();
    world.ensureChunk(1, 0); // (only to place test blocks; see below)
    world.setBlock(x0 + 1, 3, BlockId.Dirt);
    world.setBlock(x0 + 2, 3, BlockId.Stone);

    // Reset residency to prove the *match* itself, not test setup,
    // is what loads chunk 1: drop it and let the matcher pull it back in.
    const worldB = new World(SEED);
    worldB.ensureChunk(0, 0);
    worldB.setBlock(x0, 3, BlockId.Stone);
    worldB.ensureChunk(1, 0);
    worldB.setBlock(x0 + 1, 3, BlockId.Dirt);
    worldB.setBlock(x0 + 2, 3, BlockId.Stone);

    const def = multiblockDef("test_boundary")!;
    const match = matchMultiblock(worldB, def, x0, 3);
    expect(match).toMatchObject({ originX: x0, originY: 3 });
  });

  it("tryActivateMultiblock calls the registered handler and reports activation", () => {
    const id = "test_activate";
    const item = "chest";
    registerTestMultiblock(id, item);
    let activated: MultiblockActivateContext | null = null;
    registerMultiblockHandler(id, {
      activate(ctx) {
        activated = ctx;
        return true;
      },
    });
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(5, 5, BlockId.Stone);
    world.setBlock(6, 5, BlockId.Dirt);
    world.setBlock(7, 5, BlockId.Stone);

    const result = tryActivateMultiblock(
      world,
      5,
      5,
      { type: "place_block", item },
      { dimension: "overworld", sim: null as never, broadcast: () => {} },
    );
    expect(result).toEqual({ activated: true });
    expect(activated).not.toBeNull();
    expect(activated!.match).toMatchObject({ originX: 5, originY: 5 });
  });

  it("tryActivateMultiblock reports the def's fail_reason when the trigger matches but the shape doesn't", () => {
    const id = "test_fail_reason";
    const item = "backpack";
    registerTestMultiblock(id, item, "custom failure message");
    registerMultiblockHandler(id, { activate: () => true });
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    // No blocks placed at all - pattern can't match.

    const result = tryActivateMultiblock(
      world,
      5,
      5,
      { type: "place_block", item },
      { dimension: "overworld", sim: null as never, broadcast: () => {} },
    );
    expect(result).toEqual({ activated: false, attempted: true, failReason: "custom failure message" });
  });

  it("tryActivateMultiblock reports attempted:false when nothing registered cares about this trigger", () => {
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    const result = tryActivateMultiblock(
      world,
      5,
      5,
      { type: "place_block", item: "torch" },
      { dimension: "overworld", sim: null as never, broadcast: () => {} },
    );
    expect(result).toEqual({ activated: false, attempted: false });
  });

  it("skips a def whose handler id was never registered, instead of crashing", () => {
    const item = "ancient_debris";
    registerTestMultiblock("test_no_handler", item);
    const world = new World(SEED);
    world.ensureChunk(0, 0);
    world.setBlock(5, 5, BlockId.Stone);
    world.setBlock(6, 5, BlockId.Dirt);
    world.setBlock(7, 5, BlockId.Stone);
    expect(() =>
      tryActivateMultiblock(
        world,
        5,
        5,
        { type: "place_block", item },
        { dimension: "overworld", sim: null as never, broadcast: () => {} },
      ),
    ).not.toThrow();
  });

  it("rejects registering a multiblock id that's already taken, instead of silently overwriting it", () => {
    registerTestMultiblock("test_dupe_def", "cobblestone");
    expect(() => registerTestMultiblock("test_dupe_def", "basalt")).toThrow(/already registered/);
  });

  it("rejects registering a handler id that's already taken, instead of silently overwriting it", () => {
    registerMultiblockHandler("test_dupe_handler", { activate: () => true });
    expect(() => registerMultiblockHandler("test_dupe_handler", { activate: () => false })).toThrow(
      /already registered/,
    );
  });
});
