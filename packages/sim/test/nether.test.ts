import { describe, expect, it } from "vitest";
import {
  BlockId,
  findSpawnX,
  LAVA_LEVEL,
  NETHER_CEILING,
  NETHER_FLOOR,
  PORTAL_TICKS,
  Simulation,
  surfaceHeight,
  World,
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

/** Build a valid 2x3 portal frame with interior bottom-left at (bx, by). */
function buildFrame(sim: Simulation, bx: number, by: number): void {
  for (let y = by - 3; y <= by + 1; y++) {
    setBlock(sim, bx - 1, y, BlockId.Obsidian);
    setBlock(sim, bx + 2, y, BlockId.Obsidian);
  }
  for (let x = bx - 1; x <= bx + 2; x++) {
    setBlock(sim, x, by - 3, BlockId.Obsidian);
    setBlock(sim, x, by + 1, BlockId.Obsidian);
  }
  for (let y = by - 2; y <= by; y++) {
    setBlock(sim, bx, y, BlockId.Air);
    setBlock(sim, bx + 1, y, BlockId.Air);
  }
}

describe("nether generation", () => {
  it("is deterministic and bounded by bedrock", () => {
    const a = new World(SEED, "nether");
    const b = new World(SEED, "nether");
    expect(Array.from(a.ensureChunk(0, 1).tiles)).toEqual(Array.from(b.ensureChunk(0, 1).tiles));

    for (let x = -32; x < 32; x++) {
      expect(a.getBlockGenerating(x, NETHER_CEILING - 2)).toBe(BlockId.Bedrock);
      expect(a.getBlockGenerating(x, NETHER_FLOOR + 2)).toBe(BlockId.Bedrock);
    }
  });

  it("contains netherrack, open caverns and a lava sea", () => {
    const world = new World(SEED, "nether");
    const found = new Set<BlockId>();
    for (let x = 0; x < 96; x++) {
      for (let y = NETHER_CEILING + 1; y < NETHER_FLOOR; y++) {
        found.add(world.getBlockGenerating(x, y));
      }
    }
    expect(found).toContain(BlockId.Netherrack);
    expect(found).toContain(BlockId.Air);
    expect(found).toContain(BlockId.Lava);
    expect(found).toContain(BlockId.Glowstone);
  });

  it("generates obsidian veins deep in the overworld", () => {
    const world = new World(SEED, "overworld");
    let obsidian = 0;
    for (let cx = -6; cx <= 6; cx++) {
      for (const tile of world.ensureChunk(cx, 7).tiles) {
        if (tile === BlockId.Obsidian) obsidian++;
      }
    }
    expect(obsidian).toBeGreaterThan(0);
  });
});

describe("portals", () => {
  it("lights a valid frame with flint and steel", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const bx = Math.floor(state.x) + 2;
    const by = SURFACE - 1;
    buildFrame(sim, bx, by);
    state.inventory[0] = { item: "flint_and_steel", count: 1 };

    sim.tick([{ player, command: { type: "place_block", x: bx, y: by - 1 } }]);
    expect(sim.world.getBlock(bx, by)).toBe(BlockId.NetherPortal);
    expect(sim.world.getBlock(bx + 1, by - 2)).toBe(BlockId.NetherPortal);
    expect(sim.portals.overworld.size).toBe(1);
  });

  it("rejects lighting without a frame", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flint_and_steel", count: 1 };
    const result = sim.tick([
      { player, command: { type: "place_block", x: Math.floor(state.x) + 1, y: SURFACE - 2 } },
    ]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "no portal frame" },
    });
  });

  it("teleports to the nether after standing in a portal, and back", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const bx = Math.floor(state.x); // portal right at the spawn column
    const by = SURFACE - 1;
    buildFrame(sim, bx, by);
    state.inventory[0] = { item: "flint_and_steel", count: 1 };
    sim.tick([{ player, command: { type: "place_block", x: bx, y: by - 1 } }]);

    // Walk into the portal (already standing at bx) and wait.
    let switched = false;
    for (let i = 0; i < PORTAL_TICKS + 30 && !switched; i++) {
      const out = sim.tick([]);
      switched = out.some((o) => o.event.type === "player_dimension");
    }
    expect(switched).toBe(true);
    expect(state.dimension).toBe("nether");
    expect(sim.portals.nether.size).toBe(1);
    const netherPortal = [...sim.portals.nether.values()][0]!;
    // Arrived at 1:8 scaled coordinates, standing beside a fresh portal.
    expect(Math.abs(netherPortal.x - Math.round((bx + 0.5) / 8))).toBeLessThanOrEqual(2);
    expect(state.x).toBeCloseTo(netherPortal.x - 2.5);
    const nether = sim.worldOf("nether");
    expect(nether.getBlockGenerating(netherPortal.x, netherPortal.y)).toBe(BlockId.NetherPortal);

    // The cooldown prevents an immediate return trip.
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(state.dimension).toBe("nether");

    // Step away, wait out the cooldown, step back in -> back to overworld.
    state.x = netherPortal.x + 8;
    for (let i = 0; i < 110; i++) sim.tick([]);
    state.x = netherPortal.x + 1;
    state.y = netherPortal.y;
    let returned = false;
    for (let i = 0; i < PORTAL_TICKS + 30 && !returned; i++) {
      const out = sim.tick([]);
      returned = out.some(
        (o) => o.event.type === "player_dimension" && o.event.dim === "overworld",
      );
    }
    expect(returned).toBe(true);
    expect(state.dimension).toBe("overworld");
    // Reuses the original portal instead of building a second one.
    expect(sim.portals.overworld.size).toBe(1);
  });

  it("keeps block edits in each dimension separate", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.dimension = "nether";
    const nether = sim.worldOf("nether");
    nether.ensureChunk(0, 1);
    nether.setBlock(3, 40, BlockId.Glowstone);
    expect(sim.worldOf("overworld").getBlockGenerating(3, 40)).not.toBe(BlockId.Glowstone);
  });

  it("lava hurts players standing in it", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    setBlock(sim, Math.floor(state.x), Math.floor(state.y) - 1, BlockId.Lava);
    for (let i = 0; i < 30; i++) sim.tick([]);
    expect(state.health).toBeLessThan(20);
  });
});
