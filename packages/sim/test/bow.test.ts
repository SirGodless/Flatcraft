import { describe, expect, it } from "vitest";
import {
  countInInventory,
  RECIPES,
  Simulation,
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

describe("bow", () => {
  it("bow, arrow and string recipes load", () => {
    expect(RECIPES.get("bow")?.kind).toBe("crafting");
    expect(RECIPES.get("arrow")?.result).toEqual({ item: "arrow", count: 4 });
    expect(RECIPES.get("string")?.result).toEqual({ item: "string", count: 4 });
  });

  it("requires a held bow and arrows in the inventory", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const noBow = sim.tick([{ player, command: { type: "shoot", dx: 1, dy: 0 } }]);
    expect(noBow).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no bow" },
    });

    state.inventory[0] = { item: "bow", count: 1 };
    const noArrows = sim.tick([{ player, command: { type: "shoot", dx: 1, dy: 0 } }]);
    expect(noArrows).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no arrows" },
    });
  });

  it("shooting consumes an arrow and hurts the mob it hits", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.timeOfDay = 18000; // night, so the zombie doesn't burn
    state.inventory[0] = { item: "bow", count: 1 };
    state.inventory[1] = { item: "arrow", count: 3 };
    const zombie = sim.spawnMob("zombie", state.x + 5, state.y, []);

    sim.tick([{ player, command: { type: "shoot", dx: 1, dy: 0 } }]);
    expect(countInInventory(state.inventory, "arrow")).toBe(2);

    let hurt = false;
    for (let i = 0; i < 30 && !hurt; i++) {
      sim.tick([]);
      hurt = !sim.entities.has(zombie.id) || zombie.health < 20;
    }
    expect(hurt).toBe(true);
    // The shooter is never hit by their own arrow.
    expect(state.health).toBe(20);
  });

  it("enforces a fire-rate cooldown", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "bow", count: 1 };
    state.inventory[1] = { item: "arrow", count: 10 };
    sim.tick([{ player, command: { type: "shoot", dx: 1, dy: 0 } }]);
    sim.tick([{ player, command: { type: "shoot", dx: 1, dy: 0 } }]);
    // The second shot fell inside the cooldown: only one arrow gone.
    expect(countInInventory(state.inventory, "arrow")).toBe(9);
  });
});
