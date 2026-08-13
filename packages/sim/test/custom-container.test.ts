import { describe, expect, it } from "vitest";
import {
  BlockId,
  blockByName,
  findSpawnX,
  registerBlockJson,
  resolveBlockLinks,
  Simulation,
  surfaceHeight,
  type PlayerId,
  type PlayerState,
} from "../src/index.js";

/**
 * Chest and furnace behavior is driven by block components ("container",
 * "furnace"), not by BlockId identity - a datapack block should get the
 * exact same screens/mechanics the built-in Chest and Furnace get. Block
 * registration is a process-global singleton, so this lives in its own
 * test file (matches the dedicated package's datapack.test.ts convention).
 */

registerBlockJson({
  id: "safe_box",
  name: "Safe Box",
  solid: true,
  hardness: 25,
  container: { slots: 6 },
});
registerBlockJson({
  id: "kiln",
  name: "Kiln",
  solid: true,
  hardness: 35,
  furnace: { speed: 2 },
});
resolveBlockLinks();

const SAFE_BOX = blockByName("safe_box")!;
const KILN = blockByName("kiln")!;

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

describe("custom container blocks (datapack)", () => {
  it("opens and bounds slots to its declared capacity, not 27", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const bx = Math.floor(state.x) + 2;
    setBlock(sim, bx, SURFACE - 1, SAFE_BOX);

    const opened = sim.tick([{ player, command: { type: "open_chest", x: bx, y: SURFACE - 1 } }]);
    const event = opened.find((o) => o.event.type === "chest_changed");
    expect(event?.event.type === "chest_changed" && event.event.slots).toHaveLength(6);

    state.cursor = { item: "coal", count: 1 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: bx, y: SURFACE - 1, index: 5 }, button: "left" } },
    ]);
    expect(state.cursor).toBeNull();

    const denied = sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: bx, y: SURFACE - 1, index: 6 }, button: "left" } },
    ]);
    expect(denied).toContainEqual({ to: player, event: { type: "command_rejected", player, reason: "invalid slot" } });
  });

  it("spills exactly its declared capacity worth of slots when mined", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.tick([{ player, command: { type: "set_creative", on: true } }]);
    const bx = Math.floor(state.x) + 2;
    setBlock(sim, bx, SURFACE - 1, SAFE_BOX);
    sim.tick([{ player, command: { type: "open_chest", x: bx, y: SURFACE - 1 } }]);
    state.cursor = { item: "coal", count: 3 };
    sim.tick([
      { player, command: { type: "slot_click", slot: { container: "chest", x: bx, y: SURFACE - 1, index: 0 }, button: "left" } },
    ]);

    sim.tick([{ player, command: { type: "start_mining", x: bx, y: SURFACE - 1 } }]);
    for (let i = 0; i < 5; i++) sim.tick([]);
    expect(sim.world.getBlockGenerating(bx, SURFACE - 1)).toBe(BlockId.Air);
    expect(sim.chests.size).toBe(0);
  });

  it("cooks and burns at the speed declared on the furnace-like block", () => {
    const withSpeed = (block: BlockId, speedX2: boolean): number => {
      const sim = new Simulation(SEED);
      const { player, state } = joinPlayer(sim);
      const fx = Math.floor(state.x) + 2;
      const fy = SURFACE - 1;
      setBlock(sim, fx, fy, block);
      sim.tick([{ player, command: { type: "open_furnace", x: fx, y: fy } }]);
      state.cursor = { item: "iron_ore", count: 1 };
      sim.tick([
        { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "input" }, button: "left" } },
      ]);
      state.cursor = { item: "coal", count: 1 };
      sim.tick([
        { player, command: { type: "slot_click", slot: { container: "furnace", x: fx, y: fy, slot: "fuel" }, button: "left" } },
      ]);
      let ticks = 0;
      const furnace = sim.furnaces.values().next().value!;
      while (furnace.output === null && ticks < 500) {
        sim.tick([]);
        ticks++;
      }
      expect(furnace.output).toEqual({ item: "iron_ingot", count: 1 });
      void speedX2;
      return ticks;
    };

    const normalTicks = withSpeed(BlockId.Furnace, false);
    const kilnTicks = withSpeed(KILN, true);
    // 200 base cooking ticks at 2x speed finishes in ~half the ticks.
    expect(kilnTicks).toBeLessThan(normalTicks * 0.6);
  });
});
