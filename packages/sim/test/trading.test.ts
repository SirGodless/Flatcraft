import { describe, expect, it } from "vitest";
import {
  countInInventory,
  itemDef,
  Simulation,
  TRADES,
  type OutboundEvent,
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

describe("villager trading", () => {
  it("loads trades from JSON with resolvable items", () => {
    expect(TRADES.length).toBeGreaterThanOrEqual(8);
    for (const trade of TRADES) {
      expect(itemDef(trade.cost.item)).toBeDefined();
      expect(itemDef(trade.result.item)).toBeDefined();
    }
    // The elytra is purchasable, as planned.
    expect(TRADES.some((t) => t.result.item === "flatcraft:item:elytra")).toBe(true);
  });

  it("exchanges cost for result through a villager", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const villager = sim.spawnMob("flatcraft:mob:villager", state.x + 1.5, state.y, out);
    const coalTrade = TRADES.findIndex((t) => t.cost.item === "flatcraft:item:coal");
    state.inventory[0] = { item: "flatcraft:item:coal", count: 20 };

    sim.tick([{ player, command: { type: "trade", entity: villager.id, trade: coalTrade } }]);
    expect(countInInventory(state.inventory, "flatcraft:item:emerald")).toBe(1);
    expect(countInInventory(state.inventory, "flatcraft:item:coal")).toBe(8);
  });

  it("rejects trades without the items, out of range, or on non-villagers", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const villager = sim.spawnMob("flatcraft:mob:villager", state.x + 1.5, state.y, out);

    const broke = sim.tick([{ player, command: { type: "trade", entity: villager.id, trade: 0 } }]);
    expect(broke).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "missing items" },
    });

    const pig = sim.spawnMob("flatcraft:mob:pig", state.x + 1, state.y, out);
    const notVillager = sim.tick([{ player, command: { type: "trade", entity: pig.id, trade: 0 } }]);
    expect(notVillager).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no villager" },
    });

    const far = sim.spawnMob("flatcraft:mob:villager", state.x + 30, state.y, out);
    const outOfReach = sim.tick([{ player, command: { type: "trade", entity: far.id, trade: 0 } }]);
    expect(outOfReach).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "out of reach" },
    });
  });

  it("villagers wander and drop nothing when killed", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const villager = sim.spawnMob("flatcraft:mob:villager", state.x + 1.5, state.y, out);
    state.inventory[0] = { item: "flatcraft:item:diamond_sword", count: 1 };
    for (let i = 0; i < 100 && sim.entities.has(villager.id); i++) {
      sim.tick([{ player, command: { type: "attack", entity: villager.id } }]);
    }
    expect(sim.entities.has(villager.id)).toBe(false);
    expect([...sim.entities.values()].filter((e) => e.kind === "item")).toHaveLength(0);
  });
});
