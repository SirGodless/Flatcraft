import { describe, expect, it } from "vitest";
import {
  BlockId,
  canHarvest,
  clickStack,
  countInInventory,
  findSpawnX,
  matchGrid,
  RECIPES,
  Simulation,
  surfaceHeight,
  type ItemStack,
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

function grid(cells: Record<number, ItemStack>): (ItemStack | null)[] {
  const g: (ItemStack | null)[] = new Array(9).fill(null);
  for (const [index, stack] of Object.entries(cells)) {
    g[Number(index)] = stack;
  }
  return g;
}

const recipes = (): Iterable<import("../src/index.js").Recipe> => RECIPES.values();

describe("grid matching", () => {
  it("matches shaped patterns position-independently", () => {
    const planks = { item: "oak_planks", count: 1 };
    // crafting_table is a 2x2 of planks; try it in two corners of the 3x3.
    expect(matchGrid(grid({ 0: planks, 1: planks, 3: planks, 4: planks }), recipes(), 3)?.id).toBe(
      "crafting_table",
    );
    expect(matchGrid(grid({ 4: planks, 5: planks, 7: planks, 8: planks }), recipes(), 3)?.id).toBe(
      "crafting_table",
    );
  });

  it("matches the stick column (1x2 pattern) anywhere", () => {
    const planks = { item: "oak_planks", count: 1 };
    expect(matchGrid(grid({ 2: planks, 5: planks }), recipes(), 3)?.id).toBe("stick");
    expect(matchGrid(grid({ 3: planks, 6: planks }), recipes(), 3)?.id).toBe("stick");
    // Horizontal does NOT match a vertical pattern.
    expect(matchGrid(grid({ 3: planks, 4: planks }), recipes(), 3)).toBeNull();
  });

  it("matches shapeless recipes and respects grid size limits", () => {
    const log = { item: "oak_log", count: 3 };
    expect(matchGrid(grid({ 5: log }), recipes(), 2)?.id).toBe("oak_planks");
    // A 3x3-only recipe is unavailable in the 2x2 inventory grid.
    const planks = { item: "oak_planks", count: 1 };
    const stick = { item: "stick", count: 1 };
    const pickaxeGrid = grid({
      0: planks,
      1: planks,
      2: planks,
      4: stick,
      7: stick,
    });
    expect(matchGrid(pickaxeGrid, recipes(), 3)?.id).toBe("wooden_pickaxe");
    expect(matchGrid(pickaxeGrid, recipes(), 2)).toBeNull();
  });

  it("rejects patterns with wrong extra items", () => {
    const planks = { item: "oak_planks", count: 1 };
    const dirt = { item: "dirt", count: 1 };
    expect(matchGrid(grid({ 0: planks, 1: planks, 3: planks, 4: dirt }), recipes(), 3)).toBeNull();
  });
});

describe("cursor click mechanics", () => {
  it("left click picks up, places, merges and swaps", () => {
    expect(clickStack(null, { item: "dirt", count: 5 }, "left")).toEqual({
      cursor: { item: "dirt", count: 5 },
      slot: null,
    });
    expect(clickStack({ item: "dirt", count: 5 }, null, "left")).toEqual({
      cursor: null,
      slot: { item: "dirt", count: 5 },
    });
    expect(clickStack({ item: "dirt", count: 5 }, { item: "dirt", count: 62 }, "left")).toEqual({
      cursor: { item: "dirt", count: 3 },
      slot: { item: "dirt", count: 64 },
    });
    expect(clickStack({ item: "dirt", count: 5 }, { item: "sand", count: 2 }, "left")).toEqual({
      cursor: { item: "sand", count: 2 },
      slot: { item: "dirt", count: 5 },
    });
  });

  it("right click takes half and places one", () => {
    expect(clickStack(null, { item: "dirt", count: 5 }, "right")).toEqual({
      cursor: { item: "dirt", count: 3 },
      slot: { item: "dirt", count: 2 },
    });
    expect(clickStack({ item: "dirt", count: 5 }, null, "right")).toEqual({
      cursor: { item: "dirt", count: 4 },
      slot: { item: "dirt", count: 1 },
    });
  });
});

describe("grid crafting via commands", () => {
  it("crafts through the 2x2 grid with cursor clicks", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "oak_log", count: 1 };

    // Pick up the log and drop it into grid cell 0.
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "inventory", index: 0 }, button: "left" } }]);
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "craft_grid", index: 0 }, button: "left" } }]);
    // Take the result (4 planks).
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "craft_result" }, button: "left" } }]);
    expect(state.cursor).toEqual({ item: "oak_planks", count: 4 });
    expect(state.craftGrid.every((c) => c === null)).toBe(true);

    // Closing the UI returns the cursor to the inventory.
    sim.tick([{ player, command: { type: "return_grid" } }]);
    expect(state.cursor).toBeNull();
    expect(countInInventory(state.inventory, "oak_planks")).toBe(4);
  });

  it("blocks 3x3 grid cells and recipes without a crafting table", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const denied = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "craft_grid", index: 8 }, button: "left" } },
    ]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "requires crafting table" },
    });

    // With a table placed nearby the same click works.
    setBlock(sim, Math.floor(state.x) + 2, SURFACE - 1, BlockId.CraftingTable);
    state.cursor = { item: "dirt", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "craft_grid", index: 8 }, button: "left" } },
    ]);
    expect(state.craftGrid[8]).toEqual({ item: "dirt", count: 1 });
  });

  it("consumes one item per grid cell when taking the result", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.craftGrid[0] = { item: "oak_planks", count: 3 };
    state.craftGrid[3] = { item: "oak_planks", count: 1 };
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "craft_result" }, button: "left" } }]);
    expect(state.cursor).toEqual({ item: "stick", count: 4 });
    expect(state.craftGrid[0]).toEqual({ item: "oak_planks", count: 2 });
    expect(state.craftGrid[3]).toBeNull();
  });
});

describe("furnace", () => {
  function furnaceSetup(): {
    sim: Simulation;
    player: PlayerId;
    state: PlayerEntity;
    fx: number;
    fy: number;
  } {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const fx = Math.floor(state.x) + 2;
    const fy = SURFACE - 1;
    setBlock(sim, fx, fy, BlockId.Furnace);
    return { sim, player, state, fx, fy };
  }

  it("smelts iron ore into ingots while burning coal", () => {
    const { sim, player, state, fx, fy } = furnaceSetup();
    state.cursor = { item: "iron_ore", count: 2 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "input" }, button: "left" } },
    ]);
    state.cursor = { item: "coal", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "fuel" }, button: "left" } },
    ]);

    // 200 ticks per item; run enough ticks for both.
    for (let i = 0; i < 410; i++) sim.tick([]);
    const furnace = sim.furnaces.values().next().value!;
    expect(furnace.output).toEqual({ item: "iron_ingot", count: 2 });
    expect(furnace.input).toBeNull();
    expect(furnace.fuel).toBeNull(); // one coal consumed on ignition

    // Take the output with the cursor.
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "output" }, button: "left" } },
    ]);
    expect(state.cursor).toEqual({ item: "iron_ingot", count: 2 });
  });

  it("rejects non-fuel in the fuel slot and keeps output take-only", () => {
    const { sim, player, state, fx, fy } = furnaceSetup();
    state.cursor = { item: "dirt", count: 1 };
    const denied = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "fuel" }, button: "left" } },
    ]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "not a fuel" },
    });

    // Placing into output does nothing.
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "output" }, button: "left" } },
    ]);
    expect(state.cursor).toEqual({ item: "dirt", count: 1 });
  });

  it("does not burn fuel with nothing to cook", () => {
    const { sim, player, state, fx, fy } = furnaceSetup();
    state.cursor = { item: "coal", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "fuel" }, button: "left" } },
    ]);
    for (let i = 0; i < 50; i++) sim.tick([]);
    const furnace = sim.furnaces.values().next().value!;
    expect(furnace.fuel).toEqual({ item: "coal", count: 1 });
    expect(furnace.burnLeft).toBe(0);
  });

  it("hands its contents to the miner when broken", () => {
    const { sim, player, state, fx, fy } = furnaceSetup();
    state.cursor = { item: "iron_ore", count: 3 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "input" }, button: "left" } },
    ]);
    state.inventory[0] = { item: "iron_pickaxe", count: 1 };
    sim.tick([{ player, command: { type: "start_mining", x: fx, y: fy } }]);
    for (let i = 0; i < 20 && sim.world.getBlock(fx, fy) !== BlockId.Air; i++) {
      sim.tick([]);
    }
    expect(sim.world.getBlock(fx, fy)).toBe(BlockId.Air);
    // Contents go straight to the miner; the furnace block itself drops
    // as an item entity - step next to it to collect it.
    expect(countInInventory(state.inventory, "iron_ore")).toBe(3);
    state.x = fx + 0.5;
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(countInInventory(state.inventory, "furnace")).toBe(1);
    expect(sim.furnaces.size).toBe(0);
  });

  it("open_furnace replies with the current state", () => {
    const { sim, player, fx, fy } = furnaceSetup();
    const result = sim.tick([{ player, command: { type: "open_furnace", x: fx, y: fy } }]);
    const event = result.find((o) => o.event.type === "furnace_changed");
    expect(event?.to).toBe(player);
    expect(event?.event.type === "furnace_changed" && event.event.x).toBe(fx);
  });

  it("smelting recipes exist for ores, sand and cobblestone", () => {
    expect(RECIPES.get("iron_ingot")?.kind).toBe("smelting");
    expect(RECIPES.get("gold_ingot")?.kind).toBe("smelting");
    expect(RECIPES.get("glass")?.kind).toBe("smelting");
    expect(RECIPES.get("stone")?.kind).toBe("smelting");
  });

  it("tool tier chain: stone pick -> iron ore -> iron pick -> diamond", () => {
    expect(canHarvest(BlockId.IronOre, { item: "stone_pickaxe", count: 1 })).toBe(true);
    expect(canHarvest(BlockId.DiamondOre, { item: "iron_pickaxe", count: 1 })).toBe(true);
    expect(canHarvest(BlockId.DiamondOre, { item: "golden_pickaxe", count: 1 })).toBe(false);
    expect(canHarvest(BlockId.Stone, { item: "diamond_pickaxe", count: 1 })).toBe(true);
  });
});
