import { describe, expect, it } from "vitest";
import {
  BlockId,
  countInInventory,
  findSpawnX,
  itemDef,
  RECIPES,
  Simulation,
  surfaceHeight,
  type PlayerId,
  type PlayerEntity,
} from "../src/index.js";

const SEED = 1337;
const SPAWN_X = findSpawnX(SEED);
const SURFACE = surfaceHeight(SEED, SPAWN_X);

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerEntity } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

function setBlock(sim: Simulation, x: number, y: number, id: BlockId): void {
  sim.world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
  sim.world.setBlock(x, y, id);
}

describe("bucket component", () => {
  it("declares increasing capacity per tier, clay through netherite", () => {
    expect(itemDef("clay_bucket")?.bucket).toBe(1);
    expect(itemDef("copper_bucket")?.bucket).toBe(2);
    expect(itemDef("iron_bucket")?.bucket).toBe(3);
    expect(itemDef("golden_bucket")?.bucket).toBe(4);
    expect(itemDef("diamond_bucket")?.bucket).toBe(5);
    expect(itemDef("emerald_bucket")?.bucket).toBe(6);
    expect(itemDef("netherite_bucket")?.bucket).toBe(7);
  });

  it("diamond and emerald buckets are built on an iron bucket, like other gear", () => {
    const diamond = RECIPES.get("diamond_bucket");
    const emerald = RECIPES.get("emerald_bucket");
    expect(diamond?.ingredients.has("iron_bucket")).toBe(true);
    expect(emerald?.ingredients.has("iron_bucket")).toBe(true);
    // The cheaper tiers don't chain off each other.
    expect(RECIPES.get("copper_bucket")?.ingredients.has("clay_bucket")).toBe(false);
    expect(RECIPES.get("iron_bucket")?.ingredients.has("copper_bucket")).toBe(false);
  });
});

describe("clay", () => {
  it("fires into Fired Clay in a furnace", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const fx = Math.floor(state.x) + 2;
    const fy = SURFACE - 1;
    setBlock(sim, fx, fy, BlockId.Furnace);
    state.cursor = { item: "clay", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "input" }, button: "left" } },
    ]);
    state.cursor = { item: "coal", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "fuel" }, button: "left" } },
    ]);
    for (let i = 0; i < 210; i++) sim.tick([]);
    const furnace = sim.furnaces.values().next().value!;
    expect(furnace.output).toEqual({ item: "fired_clay", count: 1 });
  });
});

describe("bucket use", () => {
  function bucketSetup(item: string): { sim: Simulation; player: PlayerId; state: PlayerEntity; bx: number } {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item, count: 1 };
    sim.tick([{ player, command: { type: "select_slot", index: 0 } }]);
    const bx = Math.floor(state.x) + 2;
    return { sim, player, state, bx };
  }

  it("scoops a full water source, leaving the tile empty", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    setBlock(sim, bx, SURFACE - 1, BlockId.Water);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Air);
    expect(state.inventory[0]?.data).toEqual({ liquid: "water", amount: 1 });
  });

  it("refuses to scoop a partial (flowing) tile", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    setBlock(sim, bx, SURFACE - 1, BlockId.Water3);
    const out = sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(out).toContainEqual({ to: player, event: { type: "command_rejected", player, reason: "nothing to do" } });
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Water3);
    expect(state.inventory[0]?.data).toBeUndefined();
  });

  it("pours a carried charge as a full source and empties the bucket", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    state.inventory[0] = { item: "clay_bucket", count: 1, data: { liquid: "water", amount: 1 } };
    // A 1-tile pocket walled on both sides: otherwise the poured source
    // has nothing to stop it leveling out thin across the open terrain.
    setBlock(sim, bx, SURFACE - 1, BlockId.Air);
    setBlock(sim, bx - 1, SURFACE - 1, BlockId.Stone);
    setBlock(sim, bx + 1, SURFACE - 1, BlockId.Stone);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Water);
    expect(state.inventory[0]?.item).toBe("clay_bucket");
    expect(state.inventory[0]?.data).toBeUndefined();
  });

  it("fills a multi-charge bucket from separate sources up to its capacity", () => {
    const { sim, player, state, bx } = bucketSetup("iron_bucket"); // capacity 3
    // Four isolated 1-tile pools (stone between each) so scooping one
    // doesn't let the liquid-leveling system redistribute its neighbors.
    for (let i = 0; i < 4; i++) {
      setBlock(sim, bx + i * 2, SURFACE - 1, BlockId.Water);
      setBlock(sim, bx + i * 2 + 1, SURFACE - 1, BlockId.Stone);
    }
    for (let i = 0; i < 4; i++) {
      // Walk up to each pool in turn - they're spread further than reach.
      state.x = bx + i * 2 + 0.5;
      sim.tick([{ player, command: { type: "use_bucket", x: bx + i * 2, y: SURFACE - 1 } }]);
    }
    expect(state.inventory[0]?.data).toEqual({ liquid: "water", amount: 3 });
    // The 4th source was left alone: the bucket was already full.
    expect(sim.world.getBlockGenerating(bx + 6, SURFACE - 1)).toBe(BlockId.Water);
  });

  it("refuses to mix lava into a bucket already carrying water", () => {
    const { sim, player, state, bx } = bucketSetup("iron_bucket");
    state.inventory[0] = { item: "iron_bucket", count: 1, data: { liquid: "water", amount: 1 } };
    setBlock(sim, bx, SURFACE - 1, BlockId.Lava);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Lava); // untouched
    expect(state.inventory[0]?.data).toEqual({ liquid: "water", amount: 1 }); // untouched
  });

  it("the clay bucket breaks after pouring lava", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    state.inventory[0] = { item: "clay_bucket", count: 1, data: { liquid: "lava", amount: 1 } };
    setBlock(sim, bx, SURFACE - 1, BlockId.Air);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Lava);
    expect(state.inventory[0]).toBeNull(); // the bucket itself is gone
  });

  it("creative mode spares the clay bucket, like it spares placed blocks", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    state.inventory[0] = { item: "clay_bucket", count: 1, data: { liquid: "lava", amount: 1 } };
    setBlock(sim, bx, SURFACE - 1, BlockId.Air);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(state.inventory[0]?.item).toBe("clay_bucket");
  });

  it("the clay bucket survives pouring water", () => {
    const { sim, player, state, bx } = bucketSetup("clay_bucket");
    state.inventory[0] = { item: "clay_bucket", count: 1, data: { liquid: "water", amount: 1 } };
    setBlock(sim, bx, SURFACE - 1, BlockId.Air);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(state.inventory[0]?.item).toBe("clay_bucket");
  });

  it("a copper bucket (and up) survives pouring lava", () => {
    const { sim, player, state, bx } = bucketSetup("copper_bucket");
    state.inventory[0] = { item: "copper_bucket", count: 1, data: { liquid: "lava", amount: 1 } };
    setBlock(sim, bx, SURFACE - 1, BlockId.Air);
    sim.tick([{ player, command: { type: "use_bucket", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Lava);
    expect(state.inventory[0]?.item).toBe("copper_bucket");
    expect(state.inventory[0]?.data).toBeUndefined();
  });
});
