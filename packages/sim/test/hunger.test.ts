import { describe, expect, it } from "vitest";
import {
  countInInventory,
  itemDef,
  PLAYER_MAX_HUNGER,
  RECIPES,
  Simulation,
  STARVE_MIN_HEALTH,
  type PlayerId,
  type PlayerState,
} from "../src/index.js";

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerState } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

describe("hunger", () => {
  it("food items and cooking recipes are defined", () => {
    expect(itemDef("beef")?.food).toBe(3);
    expect(itemDef("cooked_beef")?.food).toBe(8);
    expect(itemDef("cooked_porkchop")?.food).toBe(8);
    expect(itemDef("cooked_chicken")?.food).toBe(6);
    expect(RECIPES.get("cooked_beef")?.kind).toBe("smelting");
    expect(RECIPES.get("cooked_porkchop")?.kind).toBe("smelting");
    expect(RECIPES.get("cooked_chicken")?.kind).toBe("smelting");
  });

  it("eating restores hunger and consumes the food", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.hunger = 5;
    state.inventory[0] = { item: "cooked_beef", count: 2 };
    sim.tick([{ player, command: { type: "use_item" } }]);
    expect(state.hunger).toBe(13);
    expect(countInInventory(state.inventory, "cooked_beef")).toBe(1);
  });

  it("rejects eating on a full bar", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "beef", count: 1 };
    const out = sim.tick([{ player, command: { type: "use_item" } }]);
    expect(out).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "not hungry" },
    });
    expect(countInInventory(state.inventory, "beef")).toBe(1);
  });

  it("walking and jumping drain the bar over time", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
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
