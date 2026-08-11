import { describe, expect, it } from "vitest";
import {
  BlockId,
  canHarvest,
  countInInventory,
  findSpawnX,
  miningTicks,
  Simulation,
  surfaceHeight,
  type OutboundEvent,
  type PlayerId,
  type PlayerState,
} from "../src/index.js";

const SEED = 1337;
const SPAWN_X = findSpawnX(SEED);
const SURFACE = surfaceHeight(SEED, SPAWN_X);

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

/** Start mining and tick until the block breaks; returns ticks needed. */
function mineOut(sim: Simulation, player: PlayerId, x: number, y: number, cap = 400): number {
  sim.tick([{ player, command: { type: "start_mining", x, y } }]);
  for (let i = 1; i <= cap; i++) {
    if (sim.world.getBlock(x, y) === BlockId.Air) return i;
    sim.tick([]);
  }
  throw new Error("block did not break within cap");
}

describe("mining rules", () => {
  const pickaxe = { item: "wooden_pickaxe", count: 1 };
  const stonePickaxe = { item: "stone_pickaxe", count: 1 };
  const shovel = { item: "wooden_shovel", count: 1 };

  it("matching tools divide the base time by their speed", () => {
    expect(miningTicks(BlockId.Stone, pickaxe)).toBe(15); // 30 / 2
    expect(miningTicks(BlockId.Stone, stonePickaxe)).toBe(8); // ceil(30 / 4)
    expect(miningTicks(BlockId.Dirt, shovel)).toBe(5); // 10 / 2
    expect(miningTicks(BlockId.Dirt, null)).toBe(10);
  });

  it("applies the wrong-tool penalty when the tier requirement is unmet", () => {
    expect(miningTicks(BlockId.Stone, null)).toBe(99); // 30 * 3.3
    expect(miningTicks(BlockId.IronOre, pickaxe)).toBe(132); // tier 2 needed
    expect(miningTicks(BlockId.IronOre, stonePickaxe)).toBe(10);
  });

  it("gates drops by tool tier like Minecraft", () => {
    expect(canHarvest(BlockId.Stone, null)).toBe(false);
    expect(canHarvest(BlockId.Stone, pickaxe)).toBe(true);
    expect(canHarvest(BlockId.IronOre, pickaxe)).toBe(false);
    expect(canHarvest(BlockId.IronOre, stonePickaxe)).toBe(true);
    expect(canHarvest(BlockId.DiamondOre, stonePickaxe)).toBe(false); // needs tier 3
    expect(canHarvest(BlockId.Dirt, null)).toBe(true);
  });

  it("bedrock is unminable", () => {
    expect(miningTicks(BlockId.Bedrock, stonePickaxe)).toBe(Infinity);
  });
});

describe("mining via commands", () => {
  it("breaks a block after the computed number of ticks", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);
    state.inventory[0] = { item: "wooden_pickaxe", count: 1 };

    // 15 ticks of work; the block must still stand one tick before.
    const ticks = mineOut(sim, player, x, y);
    expect(ticks).toBe(15);
    expect(countInInventory(state.inventory, "cobblestone")).toBe(1);
  });

  it("mining stone bare-handed takes the penalty time and drops nothing", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);

    const ticks = mineOut(sim, player, x, y);
    expect(ticks).toBe(99);
    expect(countInInventory(state.inventory, "cobblestone")).toBe(0);
  });

  it("emits progress events while mining and a clear event on stop", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);

    const first = sim.tick([{ player, command: { type: "start_mining", x, y } }]);
    const progress = first.find((o) => o.event.type === "mining_progress");
    expect(progress?.event).toEqual({
      type: "mining_progress",
      player,
      x,
      y,
      progress: 1,
      total: 99,
    });

    const stopped = sim.tick([{ player, command: { type: "stop_mining" } }]);
    expect(stopped).toContainEqual({
      event: { type: "mining_progress", player, x, y, progress: 0, total: 0 },
    });
    // No further progress after stopping.
    const later = sim.tick([]);
    expect(later.filter((o) => o.event.type === "mining_progress")).toHaveLength(0);
  });

  it("switching the held tool mid-mining changes the total", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);
    state.inventory[1] = { item: "wooden_pickaxe", count: 1 };

    sim.tick([{ player, command: { type: "start_mining", x, y } }]); // bare hand, total 99
    const after = sim.tick([{ player, command: { type: "select_slot", index: 1 } }]);
    const progress = after.find((o) => o.event.type === "mining_progress");
    expect(progress?.event.type === "mining_progress" && progress.event.total).toBe(15);
  });

  it("rejects mining air, bedrock and out-of-reach blocks", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;

    setBlock(sim, x, SURFACE - 3, BlockId.Air);
    const air = sim.tick([{ player, command: { type: "start_mining", x, y: SURFACE - 3 } }]);
    expect(air).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "cannot mine" },
    });

    setBlock(sim, x, SURFACE + 1, BlockId.Bedrock);
    const bedrock = sim.tick([{ player, command: { type: "start_mining", x, y: SURFACE + 1 } }]);
    expect(bedrock).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "cannot mine" },
    });

    const far = sim.tick([{ player, command: { type: "start_mining", x: 50, y: 50 } }]);
    expect(far).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "out of reach" },
    });
    expect(state.mining).toBeNull();
  });

  it("cancels mining when the player moves out of reach", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const x = Math.floor(state.x) + 1;
    const y = Math.floor(state.y);
    setBlock(sim, x, y, BlockId.Stone);

    sim.tick([{ player, command: { type: "start_mining", x, y } }]);
    expect(state.mining).not.toBeNull();
    // Teleport far away (white-box) - next tick must cancel with a clear.
    state.x += 20;
    const out: OutboundEvent[] = sim.tick([]);
    expect(out).toContainEqual({
      event: { type: "mining_progress", player, x, y, progress: 0, total: 0 },
    });
    expect(state.mining).toBeNull();
  });
});
