import { describe, expect, it } from "vitest";
import { BlockId, createRng, generateChunk, hashSeed, Simulation, surfaceHeight } from "../src/index.js";

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
  /** Surface y of the column right next to spawn (x = 1), within reach. */
  function nearbySurface(seed: number): { x: number; y: number } {
    return { x: 1, y: surfaceHeight(seed, 1) };
  }

  function run(seed: number): { sim: Simulation; events: unknown[] } {
    const sim = new Simulation(seed);
    const player = sim.allocatePlayerId();
    const target = nearbySurface(seed);
    const events = [
      ...sim.tick([{ player, command: { type: "join", name: "Tester" } }]),
      ...sim.tick([{ player, command: { type: "request_chunk", cx: 0, cy: 0 } }]),
      ...sim.tick([{ player, command: { type: "break_block", x: target.x, y: target.y } }]),
      ...sim.tick([{ player, command: { type: "move", dx: 1, jump: true } }]),
      ...sim.tick([]),
      ...sim.tick([]),
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
    const { x, y } = nearbySurface(1);

    // Above the surface is air (still within reach).
    const airResult = sim.tick([{ player, command: { type: "break_block", x, y: y - 3 } }]);
    expect(airResult).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "cannot break block" },
    });

    // Swap the surface block for bedrock (hardness -1): must be unbreakable.
    sim.world.ensureChunk(0, 0);
    sim.world.setBlock(x, y, BlockId.Bedrock);
    const bedrockResult = sim.tick([{ player, command: { type: "break_block", x, y } }]);
    expect(bedrockResult).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "cannot break block" },
    });
  });

  it("rejects placing into an occupied tile", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const { x, y } = nearbySurface(1);
    const result = sim.tick([
      { player, command: { type: "place_block", x, y: y + 1, block: BlockId.Stone } },
    ]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "space occupied" },
    });
  });

  it("rejects breaking blocks beyond reach", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const result = sim.tick([{ player, command: { type: "break_block", x: 50, y: 50 } }]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "out of reach" },
    });
  });

  it("applies valid break then place, broadcasting block_changed", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const { x, y } = nearbySurface(1);

    const broken = sim.tick([{ player, command: { type: "break_block", x, y } }]);
    expect(broken).toContainEqual({
      event: { type: "block_changed", x, y, block: BlockId.Air },
    });
    expect(sim.world.getBlock(x, y)).toBe(BlockId.Air);

    const placed = sim.tick([{ player, command: { type: "place_block", x, y, block: BlockId.Dirt } }]);
    expect(placed).toContainEqual({
      event: { type: "block_changed", x, y, block: BlockId.Dirt },
    });
    expect(sim.world.getBlock(x, y)).toBe(BlockId.Dirt);
  });

  it("chunk_data replies are addressed to the requesting player only", () => {
    const sim = new Simulation(1);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const result = sim.tick([{ player, command: { type: "request_chunk", cx: 1, cy: 1 } }]);
    const chunkEvents = result.filter((o) => o.event.type === "chunk_data");
    expect(chunkEvents).toHaveLength(1);
    expect(chunkEvents[0]?.to).toBe(player);
  });
});
