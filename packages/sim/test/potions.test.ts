import { describe, expect, it } from "vitest";
import {
  attackDamage,
  BlockId,
  countInInventory,
  EFFECT_DURATION_TICKS,
  miningTicks,
  RECIPES,
  Simulation,
  type PlayerId,
  type PlayerEntity,
} from "../src/index.js";

const SEED = 1337;

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

describe("brewing", () => {
  it("brewing recipes load and require a brewing stand", () => {
    expect(RECIPES.get("flatcraft:item:potion_speed")?.kind).toBe("brewing");
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:glass_bottle", count: 1 };
    state.inventory[1] = { item: "flatcraft:item:feather", count: 1 };
    state.inventory[2] = { item: "flatcraft:item:glowstone_dust", count: 1 };

    const denied = sim.tick([{ player, command: { type: "craft", recipe: "flatcraft:item:potion_speed" } }]);
    expect(denied).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "requires brewing stand" },
    });

    setBlock(sim, Math.floor(state.x) + 2, Math.floor(state.y) - 1, BlockId.BrewingStand);
    sim.tick([{ player, command: { type: "craft", recipe: "flatcraft:item:potion_speed" } }]);
    expect(countInInventory(state.inventory, "flatcraft:item:potion_speed")).toBe(1);
    expect(countInInventory(state.inventory, "flatcraft:item:glass_bottle")).toBe(0);
  });
});

describe("potion effects", () => {
  it("drinking applies the effect, returns the bottle, and expires", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:potion_speed", count: 1 };
    sim.tick([{ player, command: { type: "use_item" } }]);
    expect(state.effects["speed"]).toBeGreaterThan(EFFECT_DURATION_TICKS - 5);
    expect(countInInventory(state.inventory, "flatcraft:item:glass_bottle")).toBe(1);
    expect(countInInventory(state.inventory, "flatcraft:item:potion_speed")).toBe(0);

    state.effects["speed"] = 3;
    for (let i = 0; i < 5; i++) sim.tick([]);
    expect(state.effects["speed"]).toBeUndefined();
  });

  it("speed makes the player walk faster", () => {
    const run = (potion: boolean): number => {
      const sim = new Simulation(SEED);
      const { player, state } = joinPlayer(sim);
      if (potion) {
        state.inventory[0] = { item: "flatcraft:item:potion_speed", count: 1 };
        sim.tick([{ player, command: { type: "use_item" } }]);
      }
      const x0 = state.x;
      sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
      for (let i = 0; i < 20; i++) sim.tick([]);
      return state.x - x0;
    };
    expect(run(true)).toBeGreaterThan(run(false) * 1.2);
  });

  it("regeneration heals faster than the passive rate", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:potion_regeneration", count: 1 };
    sim.tick([{ player, command: { type: "use_item" } }]);
    state.health = 5;
    for (let i = 0; i < 200; i++) sim.tick([]);
    expect(state.health).toBeGreaterThanOrEqual(9); // 200 ticks / 40 = 5 HP + passive
  });

  it("strength adds melee damage", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.timeOfDay = 18000;
    const zombie = sim.spawnMob("flatcraft:mob:zombie", state.x + 1.5, state.y, []);
    state.inventory[0] = { item: "flatcraft:item:potion_strength", count: 1 };
    sim.tick([{ player, command: { type: "use_item" } }]);
    sim.tick([{ player, command: { type: "select_slot", index: 1 } }]); // bare hand
    sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
    // Hand (1) + strength (3) = 4 damage.
    expect(zombie.health).toBe(16);
  });
});

describe("enchanting", () => {
  it("enchants the held tool for lapis at an enchanting table, up to level 3", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    setBlock(sim, Math.floor(state.x) + 2, Math.floor(state.y) - 1, BlockId.EnchantingTable);
    state.inventory[0] = { item: "flatcraft:item:diamond_pickaxe", count: 1 };
    state.inventory[1] = { item: "flatcraft:item:lapis_lazuli", count: 64 };

    for (let i = 0; i < 3; i++) {
      sim.tick([{ player, command: { type: "enchant" } }]);
    }
    expect(state.inventory[0]?.ench).toEqual([{ id: "flatcraft:enchant:efficiency", level: 3 }]);
    expect(countInInventory(state.inventory, "flatcraft:item:lapis_lazuli")).toBe(64 - 24);

    const maxed = sim.tick([{ player, command: { type: "enchant" } }]);
    expect(maxed).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "already maxed" },
    });
  });

  it("requires the table and lapis; swords get sharpness", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    state.inventory[0] = { item: "flatcraft:item:iron_sword", count: 1 };

    const noTable = sim.tick([{ player, command: { type: "enchant" } }]);
    expect(noTable).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "requires enchanting table" },
    });

    setBlock(sim, Math.floor(state.x) + 2, Math.floor(state.y) - 1, BlockId.EnchantingTable);
    const noLapis = sim.tick([{ player, command: { type: "enchant" } }]);
    expect(noLapis).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "missing lapis" },
    });

    state.inventory[1] = { item: "flatcraft:item:lapis_lazuli", count: 8 };
    sim.tick([{ player, command: { type: "enchant" } }]);
    expect(state.inventory[0]?.ench).toEqual([{ id: "flatcraft:enchant:sharpness", level: 1 }]);
  });

  it("efficiency mines faster and sharpness hits harder", () => {
    const plain = { item: "flatcraft:item:diamond_pickaxe", count: 1 };
    const enchanted = { item: "flatcraft:item:diamond_pickaxe", count: 1, ench: [{ id: "flatcraft:enchant:efficiency", level: 3 }] };
    expect(miningTicks(BlockId.Stone, enchanted)).toBeLessThan(miningTicks(BlockId.Stone, plain));

    const sword = { item: "flatcraft:item:iron_sword", count: 1 };
    const sharp = { item: "flatcraft:item:iron_sword", count: 1, ench: [{ id: "flatcraft:enchant:sharpness", level: 2 }] };
    expect(attackDamage(sharp)).toBe(attackDamage(sword) + 4);
  });
});
