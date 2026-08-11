import { describe, expect, it } from "vitest";
import {
  BlockId,
  placementsNear,
  Simulation,
  structureLootAt,
  STRUCTURES,
  World,
} from "../src/index.js";

const SEED = 1337;

function findPlacement(dimension: "overworld" | "nether", id: string, range = 40) {
  for (let cx = -range; cx <= range; cx++) {
    for (let cy = 0; cy <= 7; cy++) {
      for (const p of placementsNear(SEED, dimension, cx, cy)) {
        if (p.structure.id === id) return p;
      }
    }
  }
  return null;
}

describe("structures", () => {
  it("parses all structure JSONs", () => {
    expect(STRUCTURES.length).toBeGreaterThanOrEqual(4);
    for (const s of STRUCTURES) {
      expect(s.width).toBeGreaterThan(0);
      expect(s.cells.length).toBe(s.height);
    }
  });

  it("stamps dungeon rooms into the world deterministically", () => {
    const placement = findPlacement("overworld", "dungeon");
    expect(placement).not.toBeNull();
    const { originX, originY, structure } = placement!;
    const a = new World(SEED);
    const b = new World(SEED);
    // Top-left corner of the pattern is cobblestone; interior is air.
    expect(a.getBlockGenerating(originX, originY)).toBe(BlockId.Cobblestone);
    expect(a.getBlockGenerating(originX + 2, originY + 1)).toBe(BlockId.Air);
    // The loot chest sits at the anchor cell of the dungeon pattern.
    expect(a.getBlockGenerating(originX + 4, originY + 3)).toBe(BlockId.Chest);
    // Same in an independently generated world.
    expect(b.getBlockGenerating(originX + 4, originY + 3)).toBe(BlockId.Chest);
    void structure;
  });

  it("rolls loot for structure chests when first opened", () => {
    const placement = findPlacement("overworld", "dungeon");
    expect(placement).not.toBeNull();
    const chestX = placement!.originX + 4;
    const chestY = placement!.originY + 3;
    const loot = structureLootAt(SEED, "overworld", chestX, chestY);
    expect(loot).not.toBeNull();
    expect(loot!.length).toBeGreaterThan(0);
    // Deterministic: the same roll twice.
    expect(structureLootAt(SEED, "overworld", chestX, chestY)).toEqual(loot);

    // Through the simulation: a spawned chest at that position has items.
    const sim = new Simulation(SEED);
    const player = sim.allocatePlayerId();
    sim.tick([{ player, command: { type: "join", name: "T" } }]);
    const state = sim.players.get(player)!;
    state.x = chestX + 0.5; // teleport within reach (white-box)
    state.y = chestY;
    const out = sim.tick([{ player, command: { type: "open_chest", x: chestX, y: chestY } }]);
    const event = out.find((o) => o.event.type === "chest_changed");
    expect(event?.event.type === "chest_changed" && event.event.slots.some((s) => s !== null)).toBe(
      true,
    );
  });

  it("places surface structures on the surface in matching biomes", () => {
    const placement = findPlacement("overworld", "house", 80) ?? findPlacement("overworld", "well", 80);
    expect(placement).not.toBeNull();
  });

  it("places ruins in the nether", () => {
    const placement = findPlacement("nether", "nether_ruin");
    expect(placement).not.toBeNull();
    const world = new World(SEED, "nether");
    const { originX, originY } = placement!;
    expect(world.getBlockGenerating(originX + 3, originY + 2)).toBe(BlockId.Chest);
  });
});
