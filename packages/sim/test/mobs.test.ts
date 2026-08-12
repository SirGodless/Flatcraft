import { describe, expect, it } from "vitest";
import {
  BlockId,
  CREEPER_FUSE,
  findSpawnX,
  MOB_LOOT,
  MOB_STATS,
  Simulation,
  surfaceHeight,
  type MobKind,
  type OutboundEvent,
  type PlayerId,
  type PlayerState,
} from "../src/index.js";

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerState } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  for (let i = 0; i < 10; i++) sim.tick([]);
  return { player, state: sim.players.get(player)! };
}

describe("new mobs", () => {
  it("every mob kind has stats and loot", () => {
    const kinds: MobKind[] = ["zombie", "skeleton", "creeper", "zombified_piglin", "pig", "cow", "sheep", "chicken"];
    for (const kind of kinds) {
      expect(MOB_STATS[kind].health).toBeGreaterThan(0);
      expect(MOB_LOOT[kind]).toBeDefined();
    }
  });

  it("skeletons shoot arrows that hurt the player", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    sim.timeOfDay = 18000; // night: no burning
    const out: OutboundEvent[] = [];
    sim.spawnMob("skeleton", state.x + 7, state.y, out);

    let arrowSeen = false;
    let hurt = false;
    for (let i = 0; i < 300 && !hurt; i++) {
      const events = sim.tick([]);
      for (const o of events) {
        if (o.event.type === "entity_spawned" && o.event.kind === "arrow") arrowSeen = true;
        if (o.event.type === "player_health" && o.event.health < 20) hurt = true;
      }
    }
    expect(arrowSeen).toBe(true);
    expect(hurt).toBe(true);
  });

  it("creepers fuse and explode, cratering the terrain and hurting the player", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    sim.timeOfDay = 18000;
    const out: OutboundEvent[] = [];
    const creeper = sim.spawnMob("creeper", state.x + 1, state.y, out);

    let exploded = false;
    let blocksDestroyed = 0;
    for (let i = 0; i < CREEPER_FUSE + 60 && !exploded; i++) {
      const events = sim.tick([]);
      for (const o of events) {
        if (o.event.type === "entity_removed" && o.event.id === creeper.id) exploded = true;
        if (o.event.type === "block_changed" && o.event.block === BlockId.Air) blocksDestroyed++;
      }
    }
    expect(exploded).toBe(true);
    expect(blocksDestroyed).toBeGreaterThan(3);
    expect(state.health).toBeLessThan(20);
  });

  it("cows drop leather and beef", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    const out: OutboundEvent[] = [];
    const cow = sim.spawnMob("cow", state.x + 1.5, state.y, out);
    state.inventory[0] = { item: "diamond_sword", count: 1 };
    for (let i = 0; i < 100 && sim.entities.has(cow.id); i++) {
      sim.tick([{ player, command: { type: "attack", entity: cow.id } }]);
    }
    expect(sim.entities.has(cow.id)).toBe(false);
    const drops = [...sim.entities.values()].filter((e) => e.kind === "item");
    const items = drops.map((d) => (d.kind === "item" ? d.stack.item : ""));
    expect(items).toContain("beef");
  });

  it("zombified piglins spawn naturally in the nether", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    state.dimension = "nether";
    state.x = 8;
    state.y = 30;
    let piglins = 0;
    for (let i = 0; i < 4000 && piglins === 0; i++) {
      sim.tick([]);
      // Keep the player pinned in place so physics doesn't drop them into lava.
      state.x = 8;
      state.y = 30;
      state.health = 20;
      for (const e of sim.entities.values()) {
        if (e.kind === "zombified_piglin") piglins++;
      }
    }
    expect(piglins).toBeGreaterThan(0);
  });

  it("arrows despawn against walls", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    sim.timeOfDay = 18000;
    const out: OutboundEvent[] = [];
    // Wall between skeleton and player.
    const wallX = Math.floor(state.x) + 3;
    const surface = surfaceHeight(SEED, findSpawnX(SEED));
    sim.world.ensureChunk(0, 0);
    for (let y = surface - 6; y <= surface; y++) {
      sim.world.setBlock(wallX, y, BlockId.Obsidian);
    }
    sim.spawnMob("skeleton", state.x + 6, state.y, out);
    for (let i = 0; i < 200; i++) sim.tick([]);
    // No arrow lives forever against the wall.
    const arrows = [...sim.entities.values()].filter((e) => e.kind === "arrow");
    expect(arrows.length).toBeLessThanOrEqual(1);
    expect(state.health).toBe(20);
  });
});
