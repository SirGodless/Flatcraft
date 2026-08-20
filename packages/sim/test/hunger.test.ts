import { describe, expect, it } from "vitest";
import {
  countInInventory,
  itemDef,
  PLAYER_MAX_HUNGER,
  RECIPES,
  Simulation,
  STARVE_MIN_HEALTH,
  type PlayerId,
  type PlayerEntity,
} from "../src/index.js";

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerEntity } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

describe("hunger", () => {
  it("food items and cooking recipes are defined", () => {
    expect(itemDef("flatcraft:item:beef")?.food?.hunger).toBe(3);
    expect(itemDef("flatcraft:item:cooked_beef")?.food?.hunger).toBe(8);
    expect(itemDef("flatcraft:item:cooked_porkchop")?.food?.hunger).toBe(8);
    expect(itemDef("flatcraft:item:cooked_chicken")?.food?.hunger).toBe(6);
    // Cooked food also carries saturation (buffers hunger drain).
    expect(itemDef("flatcraft:item:cooked_beef")?.food?.saturation).toBe(8);
    expect(RECIPES.get("flatcraft:item:cooked_beef")?.kind).toBe("smelting");
    expect(RECIPES.get("flatcraft:item:cooked_porkchop")?.kind).toBe("smelting");
    expect(RECIPES.get("flatcraft:item:cooked_chicken")?.kind).toBe("smelting");
  });

  it("eating takes eat_ticks, then restores hunger and consumes the food", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.hunger = 5;
    state.saturation = 0;
    state.inventory[0] = { item: "flatcraft:item:cooked_beef", count: 2 };
    sim.tick([{ player, command: { type: "use_item" } }]);
    // Still chewing: nothing consumed yet.
    expect(countInInventory(state.inventory, "flatcraft:item:cooked_beef")).toBe(2);
    for (let i = 0; i < itemDef("flatcraft:item:cooked_beef")!.food!.eatTicks + 2; i++) sim.tick([]);
    expect(state.hunger).toBe(13);
    expect(state.saturation).toBeGreaterThan(0);
    expect(countInInventory(state.inventory, "flatcraft:item:cooked_beef")).toBe(1);
  });

  it("rejects eating on a full bar", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:beef", count: 1 };
    const out = sim.tick([{ player, command: { type: "use_item" } }]);
    expect(out).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "not hungry" },
    });
    expect(countInInventory(state.inventory, "flatcraft:item:beef")).toBe(1);
  });

  it("walking and jumping drain the bar over time (saturation first)", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.saturation = 0; // spend the starting saturation buffer
    sim.tick([{ player, command: { type: "move", dx: 1, jump: true } }]);
    for (let i = 0; i < 900; i++) sim.tick([]);
    expect(state.hunger).toBeLessThan(PLAYER_MAX_HUNGER);
  });

  it("no passive regeneration while hungry", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.hunger = 10;
    state.health = 10;
    for (let i = 0; i < 200; i++) sim.tick([]);
    expect(state.health).toBe(10);
  });

  it("regenerates on a nearly full bar", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.health = 15;
    for (let i = 0; i < 200; i++) sim.tick([]);
    expect(state.health).toBeGreaterThan(15);
  });

  it("starving wears you down to 1 HP but never kills", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.hunger = 0;
    state.health = 5;
    for (let i = 0; i < 600; i++) sim.tick([]);
    expect(state.health).toBe(STARVE_MIN_HEALTH);
  });
});
