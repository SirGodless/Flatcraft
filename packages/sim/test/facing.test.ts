import { describe, expect, it } from "vitest";
import { Simulation, type PlayerId, type PlayerEntity } from "../src/index.js";

/**
 * Other players (and the client's own local marker) need to know which
 * way a player is facing and what's visibly in their hands, so the
 * renderer can mirror the held-item icons to the correct side. Facing
 * comes from the last nonzero move direction; held items come from the
 * selected hotbar slot and the offhand.
 */

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerEntity } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

describe("facing and held-item sync", () => {
  it("defaults to facing right on join, with empty hands", () => {
    const sim = new Simulation(1337);
    const player = sim.allocatePlayerId();
    const out = sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const joined = out.find((o) => o.event.type === "player_joined");
    expect(joined?.event.type === "player_joined" && joined.event).toMatchObject({
      facing: "right",
      main: null,
      off: null,
    });
  });

  it("updates facing on movement and holds it once input stops", () => {
    const sim = new Simulation(1337);
    const { player, state } = joinPlayer(sim);
    expect(state.facing).toBe("right"); // default

    let out = sim.tick([{ player, command: { type: "move", dx: -1, jump: false } }]);
    expect(state.facing).toBe("left");
    expect(out).toContainEqual({
      event: { type: "player_gear", player, facing: "left", main: null, off: null },
    });

    // Stopping (dx: 0) doesn't flip facing back.
    out = sim.tick([{ player, command: { type: "move", dx: 0, jump: false } }]);
    expect(state.facing).toBe("left");
    expect(out.some((o) => o.event.type === "player_gear")).toBe(false);

    out = sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    expect(state.facing).toBe("right");
    expect(out).toContainEqual({
      event: { type: "player_gear", player, facing: "right", main: null, off: null },
    });
  });

  it("broadcasts when the selected hotbar item changes", () => {
    const sim = new Simulation(1337);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:stick", count: 1 };
    state.inventory[1] = { item: "flatcraft:item:coal", count: 1 };

    let out = sim.tick([{ player, command: { type: "select_slot", index: 0 } }]);
    expect(out).toContainEqual({
      event: { type: "player_gear", player, facing: "right", main: "flatcraft:item:stick", off: null },
    });

    out = sim.tick([{ player, command: { type: "select_slot", index: 1 } }]);
    expect(out).toContainEqual({
      event: { type: "player_gear", player, facing: "right", main: "flatcraft:item:coal", off: null },
    });

    // Selecting the same slot again is a no-op, no re-broadcast.
    out = sim.tick([{ player, command: { type: "select_slot", index: 1 } }]);
    expect(out.some((o) => o.event.type === "player_gear")).toBe(false);
  });

  it("broadcasts when the offhand changes, via any mutation path", () => {
    const sim = new Simulation(1337);
    const { player, state } = joinPlayer(sim);
    state.cursor = { item: "flatcraft:item:wooden_shield", count: 1 };
    const out = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "offhand" }, button: "left" } },
    ]);
    expect(out).toContainEqual({
      event: { type: "player_gear", player, facing: "right", main: null, off: "flatcraft:item:wooden_shield" },
    });
  });

  it("replays current facing and held items to a joining player", () => {
    const sim = new Simulation(1337);
    const { player: first, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:stick", count: 1 };
    sim.tick([{ player: first, command: { type: "select_slot", index: 0 } }]);
    sim.tick([{ player: first, command: { type: "move", dx: -1, jump: false } }]);

    const second = sim.allocatePlayerId();
    const out = sim.tick([{ player: second, command: { type: "join", name: "Late" } }]);
    const replay = out.find((o) => o.event.type === "player_joined" && o.event.player === first);
    expect(replay?.event.type === "player_joined" && replay.event).toMatchObject({
      facing: "left",
      main: "flatcraft:item:stick",
      off: null,
    });
  });

  it("defaults facing on a save from before this field existed", () => {
    const sim = new Simulation(1337);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "move", dx: -1, jump: false } }]);
    expect(state.facing).toBe("left");
    sim.tick([{ player, command: { type: "leave" } }]);

    const save = sim.serialize();
    // Simulate a save written before "facing" existed.
    delete (save.players[0] as { facing?: unknown }).facing;
    const restored = Simulation.deserialize(save);

    const rejoined = restored.allocatePlayerId();
    const out = restored.tick([{ player: rejoined, command: { type: "join", name: "T" } }]);
    expect(restored.players.get(rejoined)?.facing).toBe("right");
    const joined = out.find((o) => o.event.type === "player_joined");
    expect(joined?.event.type === "player_joined" && joined.event.facing).toBe("right");
  });
});
