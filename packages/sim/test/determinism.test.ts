import { describe, expect, it } from "vitest";
import { createRng, generateChunk, hashSeed, Simulation } from "../src/index.js";

describe("seeded rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      expect(a()).toBe(b());
    }
  });

  it("produces different sequences for different seeds", () => {
    const a = createRng(42);
    const b = createRng(43);
    const same = Array.from({ length: 20 }, () => a() === b());
    expect(same.every(Boolean)).toBe(false);
  });

  it("hashSeed is stable and order-sensitive", () => {
    expect(hashSeed(1, 2, 3)).toBe(hashSeed(1, 2, 3));
    expect(hashSeed(1, 2, 3)).not.toBe(hashSeed(3, 2, 1));
  });
});

describe("world generation", () => {
  it("is identical for the same seed", () => {
    const a = generateChunk(1337, 0, 0);
    const b = generateChunk(1337, 0, 0);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });

  it("differs across seeds", () => {
    const a = generateChunk(1337, 0, 0);
    const b = generateChunk(7331, 0, 0);
    expect(Array.from(a.tiles)).not.toEqual(Array.from(b.tiles));
  });

  it("is identical for negative chunk coordinates too", () => {
    const a = generateChunk(1337, -3, -2);
    const b = generateChunk(1337, -3, -2);
    expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
  });
});

describe("simulation", () => {
  function run(seed: number): { sim: Simulation; events: unknown[] } {
    const sim = new Simulation(seed);
    const player = sim.allocatePlayerId();
    const events = [
      ...sim.tick([{ player, command: { type: "join", name: "Tester" } }]),
      ...sim.tick([{ player, command: { type: "request_chunk", cx: 0, cy: 0 } }]),
      ...sim.tick([{ player, command: { type: "break_block", x: 5, y: 40 } }]),
      ...sim.tick([{ player, command: { type: "place_block", x: 5, y: 40, block: 1 } }]),
    ];
    return { sim, events };
  }

  it("two instances with the same seed and commands stay identical", () => {
    const a = run(1337);
    const b = run(1337);
    expect(a.events).toEqual(b.events);
    expect(a.sim.tickCount).toBe(b.sim.tickCount);
    expect(Array.from(a.sim.world.ensureChunk(0, 0).tiles)).toEqual(
      Array.from(b.sim.world.ensureChunk(0, 0).tiles),
    );
  });

  it("rejects breaking air and unbreakable blocks", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);

    // Way above the surface is air.
    const airResult = sim.tick([{ player, command: { type: "break_block", x: 0, y: -100 } }]);
    expect(airResult).toEqual([
      { to: player, event: { type: "command_rejected", player, reason: "cannot break block" } },
    ]);

    // Deep down is bedrock (hardness -1).
    const bedrockResult = sim.tick([{ player, command: { type: "break_block", x: 0, y: 300 } }]);
    expect(bedrockResult).toEqual([
      { to: player, event: { type: "command_rejected", player, reason: "cannot break block" } },
    ]);
  });

  it("rejects placing into an occupied tile", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const result = sim.tick([{ player, command: { type: "place_block", x: 0, y: 100, block: 1 } }]);
    expect(result).toEqual([
      { to: player, event: { type: "command_rejected", player, reason: "space occupied" } },
    ]);
  });

  it("applies valid break then place, broadcasting block_changed", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);

    const broken = sim.tick([{ player, command: { type: "break_block", x: 0, y: 100 } }]);
    expect(broken).toEqual([{ event: { type: "block_changed", x: 0, y: 100, block: 0 } }]);
    expect(sim.world.getBlock(0, 100)).toBe(0);

    const placed = sim.tick([{ player, command: { type: "place_block", x: 0, y: 100, block: 2 } }]);
    expect(placed).toEqual([{ event: { type: "block_changed", x: 0, y: 100, block: 2 } }]);
    expect(sim.world.getBlock(0, 100)).toBe(2);
  });

  it("chunk_data replies are addressed to the requesting player only", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const result = sim.tick([{ player, command: { type: "request_chunk", cx: 1, cy: 1 } }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.to).toBe(player);
    expect(result[0]?.event.type).toBe("chunk_data");
  });
});
