import { describe, expect, it } from "vitest";
import {
  BlockId,
  countInInventory,
  Simulation,
  type OutboundEvent,
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

function setBlock(sim: Simulation, x: number, y: number, id: BlockId): void {
  sim.world.ensureChunk(Math.floor(x / 32), Math.floor(y / 32));
  sim.world.setBlock(x, y, id);
}

describe("chests", () => {
  function chestSetup(): { sim: Simulation; player: PlayerId; state: PlayerState; cx: number; cy: number } {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const cx = Math.floor(state.x) + 2;
    const cy = Math.floor(state.y) - 1;
    setBlock(sim, cx, cy, BlockId.Chest);
    return { sim, player, state, cx, cy };
  }

  it("stores and returns items via cursor clicks", () => {
    const { sim, player, state, cx, cy } = chestSetup();
    state.cursor = { item: "diamond", count: 5 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: cx, y: cy, index: 3 }, button: "left" } },
    ]);
    expect(state.cursor).toBeNull();
    expect(sim.chests.values().next().value!.slots[3]).toEqual({ item: "diamond", count: 5 });

    // Take half back with a right click.
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: cx, y: cy, index: 3 }, button: "right" } },
    ]);
    expect(state.cursor).toEqual({ item: "diamond", count: 3 });
  });

  it("open_chest replies with contents and breaking spills them", () => {
    const { sim, player, state, cx, cy } = chestSetup();
    state.cursor = { item: "coal", count: 7 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: cx, y: cy, index: 0 }, button: "left" } },
    ]);
    const opened = sim.tick([{ player, command: { type: "open_chest", x: cx, y: cy } }]);
    const event = opened.find((o) => o.event.type === "chest_changed");
    expect(event?.event.type === "chest_changed" && event.event.slots[0]).toEqual({ item: "coal", count: 7 });

    // Break the chest: contents + the chest itself drop as item entities.
    state.inventory[0] = { item: "iron_axe", count: 1 };
    sim.tick([{ player, command: { type: "start_mining", x: cx, y: cy } }]);
    for (let i = 0; i < 20 && sim.world.getBlock(cx, cy) !== BlockId.Air; i++) sim.tick([]);
    expect(sim.chests.size).toBe(0);
    state.x = cx + 0.5; // step under the spilled items
    for (let i = 0; i < 40; i++) sim.tick([]);
    expect(countInInventory(state.inventory, "coal")).toBe(7);
    expect(countInInventory(state.inventory, "chest")).toBe(1);
  });

  it("rejects chest clicks out of reach or on missing chests", () => {
    const { sim, player } = chestSetup();
    const result = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: 100, y: 5, index: 0 }, button: "left" } },
    ]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "out of reach" },
    });
  });
});

describe("backpacks", () => {
  it("stores items inside the held backpack stack", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "backpack", count: 1 };
    state.cursor = { item: "coal", count: 9 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "backpack", index: 2 }, button: "left" } },
    ]);
    expect(state.cursor).toBeNull();
    expect(state.inventory[0]?.data?.slots[2]).toEqual({ item: "coal", count: 9 });
  });

  it("rejects backpack clicks without one in hand and forbids nesting", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const noBag = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "backpack", index: 0 }, button: "left" } },
    ]);
    expect(noBag).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no backpack in hand" },
    });

    state.inventory[0] = { item: "backpack", count: 1 };
    state.cursor = { item: "backpack", count: 1 };
    const nested = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "backpack", index: 0 }, button: "left" } },
    ]);
    expect(nested).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "backpack in backpack" },
    });
  });

  it("backpack contents survive save/load", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "backpack", count: 1 };
    state.cursor = { item: "diamond", count: 3 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "backpack", index: 8 }, button: "left" } },
    ]);

    const restored = Simulation.deserialize(sim.serialize());
    const rejoinId = restored.allocatePlayerId();
    restored.tick([{ player: rejoinId, command: { type: "join", name: "T" } }]);
    const rejoined = restored.players.get(rejoinId)!;
    expect(rejoined.inventory[0]?.data?.slots[8]).toEqual({ item: "diamond", count: 3 });
  });

  it("chest contents survive save/load", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const cx = Math.floor(state.x) + 2;
    const cy = Math.floor(state.y) - 1;
    setBlock(sim, cx, cy, BlockId.Chest);
    state.cursor = { item: "glowstone_dust", count: 12 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: cx, y: cy, index: 10 }, button: "left" } },
    ]);

    const restored = Simulation.deserialize(sim.serialize());
    expect(restored.chests.values().next().value!.slots[10]).toEqual({
      item: "glowstone_dust",
      count: 12,
    });
  });
});
