import { describe, expect, it } from "vitest";
import {
  isItemEntity,
  isMobEntity,
  mobDef,
  registerMobJson,
  Simulation,
  type OutboundEvent,
  type PlayerId,
  type PlayerEntity,
} from "../src/index.js";

/**
 * ECS unification, stage 6: a mob's datapack def can declare default
 * equipment (armor/offhand) - the damage-handling support (absorption,
 * drop-on-death) already landed in stage 5, this just wires up spawning.
 * Mob registration is a process-global singleton, so this lives in its
 * own test file (matches custom-container.test.ts's convention).
 */

registerMobJson({
  id: "flatcraft:mob:armored_zombie",
  name: "Armored Zombie",
  health: 20,
  speed: 0.05,
  size: { width: 0.6, height: 1.9 },
  equipment: { armor: "flatcraft:item:iron_armor", offhand: "flatcraft:item:wooden_shield" },
});

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerEntity } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

describe("mob equipment (datapack)", () => {
  it("spawns wearing the armor/offhand declared in its def", () => {
    const sim = new Simulation(SEED);
    const out: OutboundEvent[] = [];
    const zombie = sim.spawnMob("flatcraft:mob:armored_zombie", 5, 5, out);
    expect(zombie.armor).toEqual({ item: "flatcraft:item:iron_armor", count: 1 });
    expect(zombie.offhand).toEqual({ item: "flatcraft:item:wooden_shield", count: 1 });
  });

  it("absorbs damage from its armor and drops its gear on death", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.timeOfDay = 18000; // night: no burning
    state.inventory[0] = { item: "flatcraft:item:diamond_sword", count: 1 }; // 7 raw damage
    const out: OutboundEvent[] = [];
    const zombie = sim.spawnMob("flatcraft:mob:armored_zombie", state.x + 1, state.y, out);

    sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
    const hurt = sim.entities.get(zombie.id);
    // Math.max(1, Math.round(7 * (1 - 0.3) * (1 - 0.25))) = 4: iron_armor's
    // 30% absorption stacked with wooden_shield's 25% block, same formula
    // hurtPlayer uses.
    expect(hurt && isMobEntity(hurt) ? hurt.health : undefined).toBe(mobDef("flatcraft:mob:armored_zombie")!.health - 4);

    // Enough hits to kill it: its gear should spill out as item entities.
    for (let i = 0; i < 100 && sim.entities.has(zombie.id); i++) {
      sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
    }
    expect(sim.entities.has(zombie.id)).toBe(false);
    const drops = [...sim.entities.values()].filter(isItemEntity).map((e) => e.stack.item);
    expect(drops).toContain("flatcraft:item:iron_armor");
    expect(drops).toContain("flatcraft:item:wooden_shield");
  });
});
