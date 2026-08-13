import { describe, expect, it } from "vitest";
import {
  blockDef,
  BlockId,
  countInInventory,
  findSpawnX,
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

describe("placement rules", () => {
  it("foreground needs a cardinal block or a wall behind", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "dirt", count: 10 };
    const bx = Math.floor(state.x);

    // Free-floating in the sky: rejected.
    const denied = sim.tick([{ player, command: { type: "place_block", x: bx + 2, y: SURFACE - 4 } }]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "needs support" },
    });

    // Adjacent to the ground: fine.
    sim.tick([{ player, command: { type: "place_block", x: bx + 2, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx + 2, SURFACE - 1)).toBe(BlockId.Dirt);
    // And stacking onto that block works too.
    sim.tick([{ player, command: { type: "place_block", x: bx + 2, y: SURFACE - 2 } }]);
    expect(sim.world.getBlockGenerating(bx + 2, SURFACE - 2)).toBe(BlockId.Dirt);
  });

  it("background walls need a free wall slot and an adjacent wall", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "dirt", count: 10 };
    const bx = Math.floor(state.x);

    // High in the sky: no walls anywhere nearby.
    const denied = sim.tick([
      { player, command: { type: "place_block", x: bx + 1, y: SURFACE - 5, layer: "bg" } },
    ]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "needs an adjacent wall" },
    });

    // One tile above the surface: natural underground walls sit below.
    const out = sim.tick([
      { player, command: { type: "place_block", x: bx + 1, y: SURFACE - 1, layer: "bg" } },
    ]);
    expect(sim.world.getWall(bx + 1, SURFACE - 1)).toBe(BlockId.Dirt);
    expect(out.some((o) => o.event.type === "wall_changed")).toBe(true);
    // Extending upward from the freshly placed wall works.
    sim.tick([{ player, command: { type: "place_block", x: bx + 1, y: SURFACE - 2, layer: "bg" } }]);
    expect(sim.world.getWall(bx + 1, SURFACE - 2)).toBe(BlockId.Dirt);
  });

  it("hammers mine background walls and drop them", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "iron_hammer", count: 1 };
    const bx = Math.floor(state.x);
    // The tile at surface level has a natural dirt wall; open the
    // foreground so the hammer can reach it.
    setBlock(sim, bx + 1, SURFACE, BlockId.Air);
    expect(sim.world.getWall(bx + 1, SURFACE)).not.toBe(BlockId.Air);

    sim.tick([{ player, command: { type: "start_mining", x: bx + 1, y: SURFACE } }]);
    for (let i = 0; i < 30 && sim.world.getWall(bx + 1, SURFACE) !== BlockId.Air; i++) {
      sim.tick([]);
    }
    expect(sim.world.getWall(bx + 1, SURFACE)).toBe(BlockId.Air);
    // The wall dropped as an item; walk a moment to collect it.
    for (let i = 0; i < 40; i++) sim.tick([]);
    expect(countInInventory(state.inventory, "dirt")).toBeGreaterThan(0);
  });
});

describe("doors, trapdoors, slabs", () => {
  it("doors place two tiles tall, toggle open and closed", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "oak_door", count: 1 };
    const bx = Math.floor(state.x) + 2;
    sim.tick([{ player, command: { type: "place_block", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.OakDoor);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 2)).toBe(BlockId.OakDoor);

    sim.tick([{ player, command: { type: "use_block", x: bx, y: SURFACE - 1 } }]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.OakDoorOpen);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 2)).toBe(BlockId.OakDoorOpen);

    // Breaking one half removes both and drops one door item.
    sim.tick([{ player, command: { type: "use_block", x: bx, y: SURFACE - 1 } }]);
    sim.tick([{ player, command: { type: "start_mining", x: bx, y: SURFACE - 2 } }]);
    for (let i = 0; i < 60; i++) sim.tick([]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Air);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 2)).toBe(BlockId.Air);
  });

  it("slabs catch falling bodies at half height", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const bx = Math.floor(state.x) + 1;
    setBlock(sim, bx, SURFACE - 1, BlockId.OakSlab);
    state.x = bx + 0.5;
    state.y = SURFACE - 4;
    state.vy = 0;
    for (let i = 0; i < 40; i++) sim.tick([]);
    expect(state.y).toBe(SURFACE - 1 + 0.5); // resting on the slab's top
    expect(state.onGround).toBe(true);
  });

  it("portal frames are passable sideways but solid on top", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const bx = Math.floor(state.x) + 1;
    // A single frame block directly in the walking path.
    setBlock(sim, bx, SURFACE - 1, BlockId.PortalFrame);
    sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    for (let i = 0; i < 20; i++) sim.tick([]);
    expect(state.x).toBeGreaterThan(bx + 1); // walked straight through

    // Standing on top still works.
    sim.tick([{ player, command: { type: "move", dx: 0, jump: false } }]);
    state.x = bx + 0.5;
    state.y = SURFACE - 3;
    state.vy = 0;
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(state.y).toBe(SURFACE - 1);
    expect(state.onGround).toBe(true);
  });
});

describe("liquids", () => {
  it("water falls into freshly mined holes", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    // A sealed basin: water resting on a stone plug, cavity below.
    setBlock(sim, bx - 1, SURFACE - 2, BlockId.Stone);
    setBlock(sim, bx + 1, SURFACE - 2, BlockId.Stone);
    setBlock(sim, bx, SURFACE - 2, BlockId.Water);
    setBlock(sim, bx - 1, SURFACE - 1, BlockId.Stone);
    setBlock(sim, bx + 1, SURFACE - 1, BlockId.Stone);
    setBlock(sim, bx, SURFACE - 1, BlockId.Stone); // the plug
    setBlock(sim, bx, SURFACE, BlockId.Stone); // basin floor

    // Pull the plug (creative: instant), the water must follow down.
    sim.tick([{ player, command: { type: "start_mining", x: bx, y: SURFACE - 1 } }]);
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Water);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 2)).toBe(BlockId.Air);
  });

  it("water runs down stairs instead of stranding on the steps", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    const top = SURFACE - 8;
    // A sealed box: staircase descending to the right into a basin.
    for (let x = bx - 1; x <= bx + 7; x++) {
      for (let y = top; y <= SURFACE + 1; y++) setBlock(sim, x, y, BlockId.Air);
      setBlock(sim, x, SURFACE + 1, BlockId.Stone); // basin floor
    }
    for (let y = top; y <= SURFACE + 1; y++) {
      setBlock(sim, bx - 1, y, BlockId.Stone);
      setBlock(sim, bx + 7, y, BlockId.Stone);
    }
    for (let i = 0; i <= 3; i++) {
      for (let y = SURFACE - 4 + i; y <= SURFACE; y++) setBlock(sim, bx + i, y, BlockId.Stone);
    }
    // Full water on the top step, held back by a plug.
    setBlock(sim, bx, SURFACE - 5, BlockId.Water);
    setBlock(sim, bx + 1, SURFACE - 5, BlockId.Stone);

    // Stand on the second step and pull the plug (creative: instant).
    state.x = bx + 1.5;
    state.y = SURFACE - 3;
    state.vy = 0;
    sim.tick([{ player, command: { type: "start_mining", x: bx + 1, y: SURFACE - 5 } }]);
    for (let i = 0; i < 600; i++) sim.tick([]);

    // Every step surface drained; nothing stranded at level 1.
    for (let i = 0; i <= 3; i++) {
      expect(sim.world.getBlockGenerating(bx + i, SURFACE - 5 + i)).toBe(BlockId.Air);
    }
    // All 8 units arrived in the basin: volume is conserved.
    let volume = 0;
    for (let x = bx - 1; x <= bx + 7; x++) {
      for (let y = top; y <= SURFACE + 1; y++) {
        volume += blockDef(sim.world.getBlockGenerating(x, y)).liquid?.level ?? 0;
      }
    }
    expect(volume).toBe(8);
    // It's not just conserved, it's flat: 8 units over 3 basin columns
    // settle to the closest possible split (3+3+2), not a staircase.
    const basinLevels = [bx + 4, bx + 5, bx + 6].map(
      (x) => blockDef(sim.world.getBlockGenerating(x, SURFACE)).liquid?.level,
    );
    expect(basinLevels.reduce((a, b) => a! + b!, 0)).toBe(8);
    expect(Math.max(...(basinLevels as number[])) - Math.min(...(basinLevels as number[]))).toBeLessThanOrEqual(1);
  });

  it("a pond on flat ground settles perfectly level, not a staircase", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    const top = SURFACE - 6;
    const width = 12;
    // A sealed, flat-floored basin.
    for (let x = bx - 1; x <= bx + width; x++) {
      for (let y = top; y <= SURFACE; y++) setBlock(sim, x, y, BlockId.Air);
      setBlock(sim, x, SURFACE, BlockId.Stone);
    }
    for (let y = top; y <= SURFACE; y++) {
      setBlock(sim, bx - 1, y, BlockId.Stone);
      setBlock(sim, bx + width, y, BlockId.Stone);
    }
    // Pour water from one corner only, plugged so it must spread the
    // full width to level out (24 units over 12 columns = 2 each).
    setBlock(sim, bx, top, BlockId.Water);
    setBlock(sim, bx, top + 1, BlockId.Water);
    setBlock(sim, bx, top + 2, BlockId.Water);
    setBlock(sim, bx + 1, top + 2, BlockId.Stone);

    state.x = bx + 1.5;
    state.y = top + 1;
    state.vy = 0;
    sim.tick([{ player, command: { type: "start_mining", x: bx + 1, y: top + 2 } }]);
    for (let i = 0; i < 400; i++) sim.tick([]);

    const levels = [];
    for (let x = bx; x <= bx + width - 1; x++) {
      levels.push(blockDef(sim.world.getBlockGenerating(x, SURFACE - 1)).liquid?.level ?? 0);
    }
    expect(levels).toEqual(new Array(width).fill(2));

    // And it stays that way: no more liquid activity once settled.
    let laterEvents = 0;
    for (let i = 0; i < 100; i++) {
      const out = sim.tick([]);
      laterEvents += out.filter((o) => o.event.type === "block_changed").length;
    }
    expect(laterEvents).toBe(0);
  });

  it("flowing water emits at most one block_changed per cell per tick", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    // A tall sealed water column over a plug; pulling it makes the
    // column fall and spread for many ticks.
    for (let dy = 2; dy <= 5; dy++) {
      setBlock(sim, bx - 1, SURFACE - dy, BlockId.Stone);
      setBlock(sim, bx + 1, SURFACE - dy, BlockId.Stone);
      setBlock(sim, bx, SURFACE - dy, BlockId.Water);
    }
    setBlock(sim, bx, SURFACE - 1, BlockId.Stone); // the plug

    sim.tick([{ player, command: { type: "start_mining", x: bx, y: SURFACE - 1 } }]);
    let sawFlow = false;
    for (let i = 0; i < 100; i++) {
      const out = sim.tick([]);
      const seen = new Set<string>();
      for (const o of out) {
        if (o.event.type !== "block_changed") continue;
        const key = `${o.event.dim}:${o.event.x},${o.event.y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
      if (seen.size > 0) sawFlow = true;
    }
    expect(sawFlow).toBe(true);
  });

  it("water meeting lava hardens to obsidian", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    setBlock(sim, bx, SURFACE - 3, BlockId.Water);
    setBlock(sim, bx, SURFACE - 2, BlockId.Stone); // plug between them
    setBlock(sim, bx, SURFACE - 1, BlockId.Lava);
    setBlock(sim, bx - 1, SURFACE - 3, BlockId.Stone);
    setBlock(sim, bx + 1, SURFACE - 3, BlockId.Stone);
    setBlock(sim, bx - 1, SURFACE - 1, BlockId.Stone);
    setBlock(sim, bx + 1, SURFACE - 1, BlockId.Stone);

    sim.tick([{ player, command: { type: "start_mining", x: bx, y: SURFACE - 2 } }]);
    for (let i = 0; i < 60; i++) sim.tick([]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Obsidian);
  });

  it("diving drains air, resurfacing restores it", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const bx = Math.floor(state.x);
    // A 3-deep water shaft the player is dropped into.
    for (let dy = 1; dy <= 4; dy++) {
      setBlock(sim, bx - 1, SURFACE - dy, BlockId.Stone);
      setBlock(sim, bx + 1, SURFACE - dy, BlockId.Stone);
      if (dy <= 3) setBlock(sim, bx, SURFACE - dy, BlockId.Water);
    }
    state.x = bx + 0.5;
    state.y = SURFACE - 1;
    for (let i = 0; i < 100; i++) sim.tick([]);
    expect(state.air).toBeLessThan(200);
    for (let i = 0; i < 400; i++) sim.tick([]);
    expect(state.health).toBeLessThan(20); // drowning damage set in

    // Teleport out: air refills.
    state.x = bx + 10;
    state.y = surfaceHeight(SEED, bx + 10);
    for (let i = 0; i < 5; i++) sim.tick([]);
    expect(state.air).toBe(200);
  });
});
