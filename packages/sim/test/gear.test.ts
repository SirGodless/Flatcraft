import { describe, expect, it } from "vitest";
import {
  BlockId,
  countInInventory,
  findSpawnX,
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

/** One zombie hit on a player with the given gear; returns damage taken. */
function zombieDamage(armor: string | null, offhand: string | null): number {
  const sim = new Simulation(SEED);
  const { state } = joinPlayer(sim);
  sim.timeOfDay = 18000;
  if (armor) state.armor = { item: armor, count: 1 };
  if (offhand) state.offhand = { item: offhand, count: 1 };
  sim.spawnMob("flatcraft:mob:zombie", state.x, state.y, []);
  for (let i = 0; i < 5 && state.health === 20; i++) sim.tick([]);
  return 20 - state.health;
}

describe("armor and shields", () => {
  it("armor absorbs damage, shields block more on top", () => {
    const bare = zombieDamage(null, null);
    const ironArmor = zombieDamage("flatcraft:item:iron_armor", null);
    const both = zombieDamage("flatcraft:item:iron_armor", "flatcraft:item:iron_shield");
    expect(bare).toBe(3);
    expect(ironArmor).toBe(2); // 3 * 0.7 rounded
    expect(both).toBe(1); // 3 * 0.7 * 0.6 rounded, min 1
  });

  it("recipes exist per the tier plan (iron core for diamond/emerald)", () => {
    expect(RECIPES.get("flatcraft:item:leather_armor")).toBeDefined();
    expect(RECIPES.get("flatcraft:item:wooden_armor")).toBeUndefined(); // 00111111: no wood/stone armor
    expect(RECIPES.get("flatcraft:item:stone_armor")).toBeUndefined();
    expect(RECIPES.get("flatcraft:item:diamond_armor")!.ingredients.get("flatcraft:item:iron_armor")).toBe(1);
    expect(RECIPES.get("flatcraft:item:emerald_shield")!.ingredients.get("flatcraft:item:iron_shield")).toBe(1);
    expect(RECIPES.get("flatcraft:item:wooden_shield")).toBeDefined(); // shields: 11111111
    expect(RECIPES.get("flatcraft:item:netherite_hammer")).toBeDefined();
    // Grappling hooks: from iron on, the previous hook is an ingredient.
    expect(RECIPES.get("flatcraft:item:iron_grappling_hook")!.ingredients.get("flatcraft:item:copper_grappling_hook")).toBe(1);
    expect(RECIPES.get("flatcraft:item:netherite_grappling_hook")!.ingredients.get("flatcraft:item:emerald_grappling_hook")).toBe(1);
    expect(RECIPES.get("flatcraft:item:wooden_grappling_hook")!.ingredients.get("flatcraft:item:string")).toBe(2);
  });

  it("only armor fits the armor slot; anything fits the offhand", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.cursor = { item: "flatcraft:item:diamond", count: 1 };
    const denied = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "armor" }, button: "left" } },
    ]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "not armor" },
    });
    state.cursor = { item: "flatcraft:item:leather_armor", count: 1 };
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "armor" }, button: "left" } }]);
    expect(state.armor?.item).toBe("flatcraft:item:leather_armor");

    state.cursor = { item: "flatcraft:item:wooden_shield", count: 1 };
    sim.tick([{ player, command: { type: "slot_click", slot: { container: "offhand" }, button: "left" } }]);
    expect(state.offhand?.item).toBe("flatcraft:item:wooden_shield");
  });
});

describe("grappling hook", () => {
  it("pulls the player toward a solid anchor within range", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:wooden_grappling_hook", count: 1 };
    // A stone pillar 7 tiles to the right, at head height.
    const px = Math.floor(state.x);
    for (let dy = -3; dy <= 0; dy++) setBlock(sim, px + 7, SURFACE + dy, BlockId.Stone);
    const x0 = state.x;
    sim.tick([{ player, command: { type: "grapple", dx: 1, dy: -0.2 } }]);
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(state.x).toBeGreaterThan(x0 + 3);
  });

  it("rejects when no anchor is in range", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:wooden_grappling_hook", count: 1 };
    // Straight up: open sky.
    const out = sim.tick([{ player, command: { type: "grapple", dx: 0, dy: -1 } }]);
    expect(out).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no anchor in range" },
    });
  });
});

describe("creative mode", () => {
  it("blocks all damage, mines instantly and gives items", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    expect(state.creative).toBe(true);

    sim.timeOfDay = 18000;
    sim.spawnMob("flatcraft:mob:zombie", state.x, state.y, []);
    for (let i = 0; i < 10; i++) sim.tick([]);
    expect(state.health).toBe(20);

    // Instant break, no drops.
    const bx = Math.floor(state.x);
    setBlock(sim, bx + 2, SURFACE - 2, BlockId.Stone);
    setBlock(sim, bx + 2, SURFACE - 1, BlockId.Stone);
    sim.tick([{ player, command: { type: "start_mining", x: bx + 2, y: SURFACE - 2 } }]);
    sim.tick([]);
    expect(sim.world.getBlockGenerating(bx + 2, SURFACE - 2)).toBe(BlockId.Air);
    expect(countInInventory(state.inventory, "flatcraft:item:cobblestone")).toBe(0);

    sim.tick([{ player, command: { type: "creative_give", item: "flatcraft:item:diamond", count: 64 } }]);
    expect(countInInventory(state.inventory, "flatcraft:item:diamond")).toBe(64);

    // Off again: creative_give is rejected.
    sim.tick([{ player, command: { type: "set_creative", on: false } }]);
    const denied = sim.tick([{ player, command: { type: "creative_give", item: "flatcraft:item:diamond", count: 1 } }]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "not in creative mode" },
    });
  });
});
