import { describe, expect, it } from "vitest";
import {
  BlockId,
  countInInventory,
  findSpawnX,
  PLAYER_MAX_HEALTH,
  Simulation,
  surfaceHeight,
  type MobEntity,
  type OutboundEvent,
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

function settle(sim: Simulation, ticks: number): OutboundEvent[] {
  const events: OutboundEvent[] = [];
  for (let i = 0; i < ticks; i++) events.push(...sim.tick([]));
  return events;
}

describe("item entities", () => {
  it("spawned items fall, rest on the ground, and get picked up nearby", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    // Drop an item two tiles above the player's head.
    const item = sim.spawnItem("flatcraft:dimension:overworld", state.x, state.y - 4, { item: "flatcraft:item:coal", count: 3 }, out);
    expect(out.some((o) => o.event.type === "entity_spawned")).toBe(true);
    settle(sim, 40);
    expect(sim.entities.has(item.id)).toBe(false); // picked up
    expect(countInInventory(state.inventory, "flatcraft:item:coal")).toBe(3);
  });

  it("items are not picked up while the pickup delay runs", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    sim.spawnItem("flatcraft:dimension:overworld", state.x, state.y - 1, { item: "flatcraft:item:coal", count: 1 }, out);
    sim.tick([]);
    expect(countInInventory(state.inventory, "flatcraft:item:coal")).toBe(0);
    settle(sim, 15);
    expect(countInInventory(state.inventory, "flatcraft:item:coal")).toBe(1);
  });

  it("far-away items stay in the world", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const item = sim.spawnItem("flatcraft:dimension:overworld", state.x + 10, state.y - 1, { item: "flatcraft:item:coal", count: 1 }, out);
    settle(sim, 40);
    expect(sim.entities.has(item.id)).toBe(true);
  });
});

describe("combat", () => {
  function spawnZombieNear(sim: Simulation, state: PlayerEntity, dx: number): MobEntity {
    const out: OutboundEvent[] = [];
    return sim.spawnMob("flatcraft:mob:zombie", state.x + dx, state.y, out);
  }

  it("kills a zombie with a sword, respecting invulnerability frames", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.timeOfDay = 18000; // night, so daylight burning doesn't interfere
    const zombie = spawnZombieNear(sim, state, 2);
    state.inventory[0] = { item: "flatcraft:item:iron_sword", count: 1 }; // 6 damage

    let attacks = 0;
    // Attack whenever cooldowns allow; zombie has 20 HP -> 4 hits.
    for (let i = 0; i < 200 && sim.entities.has(zombie.id); i++) {
      const out = sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
      if (out.some((o) => o.event.type === "entity_hurt" || o.event.type === "entity_removed")) {
        attacks++;
      }
    }
    expect(sim.entities.has(zombie.id)).toBe(false);
    expect(attacks).toBe(4);
  });

  it("dead mobs drop loot that can be collected", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const pig = sim.spawnMob("flatcraft:mob:pig", state.x + 1.5, state.y, out);
    state.inventory[0] = { item: "flatcraft:item:diamond_sword", count: 1 }; // 7 damage, 2 hits

    for (let i = 0; i < 100 && sim.entities.has(pig.id); i++) {
      sim.tick([{ player, command: { type: "attack", entity: pig.id } }]);
    }
    expect(sim.entities.has(pig.id)).toBe(false);
    // Step onto the dropped loot (knockback may have pushed the pig away).
    const drop = [...sim.entities.values()].find((e) => e.kind === "item");
    expect(drop).toBeDefined();
    state.x = drop!.x;
    settle(sim, 40);
    expect(countInInventory(state.inventory, "flatcraft:item:porkchop")).toBeGreaterThanOrEqual(1);
  });

  it("rejects attacks beyond reach", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const zombie = sim.spawnMob("flatcraft:mob:zombie", state.x + 10, state.y, out);
    const result = sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "out of reach" },
    });
  });

  it("zombies chase the player and hurt them on contact", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    sim.spawnMob("flatcraft:mob:zombie", state.x + 6, state.y, out);
    const events = settle(sim, 200);
    // The zombie reached the player and did damage (it may even have
    // killed them, in which case they respawned at full health).
    const healthEvents = events
      .map((o) => o.event)
      .filter((e) => e.type === "player_health");
    expect(healthEvents.some((e) => e.type === "player_health" && e.health < PLAYER_MAX_HEALTH)).toBe(
      true,
    );
  });

  it("regenerates health over time", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.health = 10;
    settle(sim, 400); // 5 regen intervals
    expect(state.health).toBeGreaterThan(10);
  });

  it("entity_died fires exactly on a lethal hit, right before entity_removed", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    sim.timeOfDay = 18000;
    const zombie = spawnZombieNear(sim, state, 2);
    state.inventory[0] = { item: "flatcraft:item:iron_sword", count: 1 };

    let diedEvents = 0;
    let sawDiedBeforeRemoved = false;
    for (let i = 0; i < 200 && sim.entities.has(zombie.id); i++) {
      const events = sim.tick([{ player, command: { type: "attack", entity: zombie.id } }]);
      const diedIndex = events.findIndex((o) => o.event.type === "entity_died" && o.event.id === zombie.id);
      const removedIndex = events.findIndex((o) => o.event.type === "entity_removed" && o.event.id === zombie.id);
      if (diedIndex !== -1) diedEvents++;
      if (diedIndex !== -1 && removedIndex !== -1 && diedIndex < removedIndex) sawDiedBeforeRemoved = true;
    }
    expect(diedEvents).toBe(1);
    expect(sawDiedBeforeRemoved).toBe(true);
  });

  it("entity_died never fires for a picked-up item or an expired arrow", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    sim.spawnItem("flatcraft:dimension:overworld", state.x, state.y - 1, { item: "flatcraft:item:coal", count: 1 }, out);
    const events = settle(sim, 40); // picked up well within this window
    expect(events.some((o) => o.event.type === "entity_died")).toBe(false);

    // Shoot straight up into open sky: no target, expires via TTL.
    state.inventory[1] = { item: "flatcraft:item:bow", count: 1 };
    state.inventory[2] = { item: "flatcraft:item:arrow", count: 1 };
    sim.tick([{ player, command: { type: "select_slot", index: 1 } }]);
    sim.tick([{ player, command: { type: "shoot", dx: 0, dy: -1 } }]);
    const arrowEvents = settle(sim, 150); // longer than ARROW_TTL
    expect(arrowEvents.some((o) => o.event.type === "entity_died")).toBe(false);
  });
});

describe("entity determinism and spawning", () => {
  it("two simulations with entities stay identical", () => {
    const run = (): Array<[number, number, number]> => {
      const sim = new Simulation(SEED);
      const { player, state } = joinPlayer(sim);
      const out: OutboundEvent[] = [];
      sim.spawnMob("flatcraft:mob:zombie", state.x + 8, state.y, out);
      sim.spawnMob("flatcraft:mob:pig", state.x - 5, state.y, out);
      sim.spawnItem("flatcraft:dimension:overworld", state.x + 3, state.y - 2, { item: "flatcraft:item:coal", count: 1 }, out);
      for (let i = 0; i < 100; i++) {
        sim.tick(i === 50 ? [{ player, command: { type: "move", dx: 1, jump: false } }] : []);
      }
      return [...sim.entities.values()].map((e) => [e.id, e.x, e.y]);
    };
    expect(run()).toEqual(run());
  });

  it("naturally spawns mobs near players over time", () => {
    const sim = new Simulation(SEED);
    joinPlayer(sim);
    settle(sim, 3000);
    expect(sim.entities.size).toBeGreaterThan(0);
  });
});

describe("id allocation", () => {
  it("never hands a mob and a player the same id, whichever comes first", () => {
    const sim = new Simulation(SEED);
    const out: OutboundEvent[] = [];
    // A mob spawned before anyone joins...
    const early = sim.spawnMob("flatcraft:mob:pig", 0, 0, out);
    const { player, state } = joinPlayer(sim);
    // ...and one spawned after both draw from the same allocator.
    const late = sim.spawnMob("flatcraft:mob:pig", state.x + 5, state.y, out);
    const item = sim.spawnItem("flatcraft:dimension:overworld", state.x - 5, state.y, { item: "flatcraft:item:coal", count: 1 }, out);

    const ids = [early.id, late.id, item.id, player];
    expect(new Set(ids).size).toBe(ids.length); // all pairwise distinct
  });
});
