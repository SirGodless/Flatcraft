import { describe, expect, it } from "vitest";
import {
  addToInventory,
  BlockId,
  blockDrops,
  countInInventory,
  createInventory,
  findSpawnX,
  ingredientOptions,
  INVENTORY_SIZE,
  itemDef,
  RECIPES,
  removeFromInventory,
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

function give(state: PlayerEntity, item: string, count: number): void {
  addToInventory(state.inventory, item, count);
}

function setBlock(sim: Simulation, x: number, y: number, id: BlockId): void {
  sim.world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
  sim.world.setBlock(x, y, id);
}

describe("recipe data", () => {
  it("loads every recipe JSON with resolvable items", () => {
    expect(RECIPES.size).toBeGreaterThanOrEqual(12);
    for (const recipe of RECIPES.values()) {
      expect(itemDef(recipe.result.item)).toBeDefined();
      for (const key of recipe.ingredients.keys()) {
        // Tag keys ("#planks") resolve to at least one real item.
        const options = ingredientOptions(key);
        expect(options.length).toBeGreaterThan(0);
        for (const item of options) {
          expect(itemDef(item)).toBeDefined();
        }
      }
    }
  });

  it("classifies grid sizes like Minecraft", () => {
    expect(RECIPES.get("oak_planks")!.gridSize).toBe(2); // 1 ingredient
    expect(RECIPES.get("stick")!.gridSize).toBe(2); // 1x2 pattern
    expect(RECIPES.get("crafting_table")!.gridSize).toBe(2); // 2x2 pattern
    expect(RECIPES.get("wooden_pickaxe")!.gridSize).toBe(3); // 3 wide
    expect(RECIPES.get("wooden_sword")!.gridSize).toBe(3); // 3 tall
  });

  it("counts pattern symbols as ingredient totals", () => {
    const pickaxe = RECIPES.get("wooden_pickaxe")!;
    // Plank ingredients are the "#planks" tag: any wood type works.
    expect(pickaxe.ingredients.get("#planks")).toBe(3);
    expect(pickaxe.ingredients.get("stick")).toBe(2);
    expect(ingredientOptions("#planks")).toContain("oak_planks");
    expect(ingredientOptions("#planks")).toContain("birch_planks");
    expect(ingredientOptions("#planks")).toContain("spruce_planks");
  });
});

describe("inventory", () => {
  it("stacks up to 64 and overflows into new slots", () => {
    const slots = createInventory();
    expect(addToInventory(slots, "dirt", 70)).toBe(0);
    expect(slots[0]).toEqual({ item: "dirt", count: 64 });
    expect(slots[1]).toEqual({ item: "dirt", count: 6 });
    expect(countInInventory(slots, "dirt")).toBe(70);
  });

  it("reports overflow when completely full", () => {
    const slots = createInventory();
    const leftover = addToInventory(slots, "dirt", 64 * INVENTORY_SIZE + 5);
    expect(leftover).toBe(5);
  });

  it("removal is all-or-nothing", () => {
    const slots = createInventory();
    addToInventory(slots, "stick", 10);
    expect(removeFromInventory(slots, "stick", 11)).toBe(false);
    expect(countInInventory(slots, "stick")).toBe(10);
    expect(removeFromInventory(slots, "stick", 10)).toBe(true);
    expect(countInInventory(slots, "stick")).toBe(0);
  });

  it("respects maxStack 1 for tools", () => {
    const slots = createInventory();
    addToInventory(slots, "wooden_pickaxe", 2);
    expect(slots[0]).toEqual({ item: "wooden_pickaxe", count: 1 });
    expect(slots[1]).toEqual({ item: "wooden_pickaxe", count: 1 });
  });
});

describe("crafting via commands", () => {
  it("crafts planks from logs (2x2, no table needed)", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    give(state, "oak_log", 2);
    sim.tick([{ player, command: { type: "craft", recipe: "oak_planks" } }]);
    expect(countInInventory(state.inventory, "oak_planks")).toBe(4);
    expect(countInInventory(state.inventory, "oak_log")).toBe(1);
  });

  it("rejects crafting with missing ingredients", () => {
    const sim = new Simulation(SEED);
    const { player } = joinPlayer(sim);
    const result = sim.tick([{ player, command: { type: "craft", recipe: "stick" } }]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "missing ingredients" },
    });
  });

  it("rejects unknown recipes", () => {
    const sim = new Simulation(SEED);
    const { player } = joinPlayer(sim);
    const result = sim.tick([{ player, command: { type: "craft", recipe: "tnt" } }]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "unknown recipe" },
    });
  });

  it("requires a crafting table for 3x3 recipes", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    give(state, "oak_planks", 3);
    give(state, "stick", 2);

    const denied = sim.tick([{ player, command: { type: "craft", recipe: "wooden_pickaxe" } }]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "requires crafting table" },
    });

    setBlock(sim, Math.floor(state.x) + 2, Math.floor(state.y) - 1, BlockId.CraftingTable);
    sim.tick([{ player, command: { type: "craft", recipe: "wooden_pickaxe" } }]);
    expect(countInInventory(state.inventory, "wooden_pickaxe")).toBe(1);
    expect(countInInventory(state.inventory, "oak_planks")).toBe(0);
    expect(countInInventory(state.inventory, "stick")).toBe(0);
  });
});

describe("drops and placement", () => {
  it("mining a block with the right tool yields its drop into the inventory", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);
    state.inventory[0] = { item: "wooden_pickaxe", count: 1 };
    sim.tick([{ player, command: { type: "start_mining", x, y } }]);
    for (let i = 0; i < 20 && sim.world.getBlock(x, y) !== BlockId.Air; i++) {
      sim.tick([]);
    }
    // The drop is an item entity; wait for the nearby player to pick it up.
    for (let i = 0; i < 30; i++) sim.tick([]);
    // Stone drops cobblestone, Minecraft-style.
    expect(countInInventory(state.inventory, "cobblestone")).toBe(1);
    expect(countInInventory(state.inventory, "stone")).toBe(0);
  });

  it("block drops follow the registry (grass->dirt, coal_ore->coal, leaves->nothing)", () => {
    expect(blockDrops(BlockId.Grass)).toEqual({ item: "dirt", count: 1 });
    expect(blockDrops(BlockId.CoalOre)).toEqual({ item: "coal", count: 1 });
    expect(blockDrops(BlockId.OakLeaves)).toBeNull();
    expect(blockDrops(BlockId.Dirt)).toEqual({ item: "dirt", count: 1 });
  });

  it("placing uses the selected hotbar stack and consumes it", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    give(state, "dirt", 2);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y) - 1;
    setBlock(sim, x, y, BlockId.Air);
    sim.tick([{ player, command: { type: "select_slot", index: 0 } }]);
    const result = sim.tick([{ player, command: { type: "place_block", x, y } }]);
    expect(result).toContainEqual({
      event: { type: "block_changed", dim: "overworld", x, y, block: BlockId.Dirt },
    });
    expect(sim.world.getBlock(x, y)).toBe(BlockId.Dirt);
    expect(countInInventory(state.inventory, "dirt")).toBe(1);
  });

  it("rejects placing with an empty hand or a non-block item", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y) - 1;
    setBlock(sim, x, y, BlockId.Air);

    const empty = sim.tick([{ player, command: { type: "place_block", x, y } }]);
    expect(empty).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "nothing to place" },
    });

    give(state, "stick", 1);
    const stick = sim.tick([{ player, command: { type: "place_block", x, y } }]);
    expect(stick).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "item not placeable" },
    });
  });
});
