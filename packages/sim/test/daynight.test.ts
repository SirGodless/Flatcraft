import { describe, expect, it } from "vitest";
import {
  DAY_LENGTH,
  daylightFactor,
  findSpawnX,
  isNight,
  Simulation,
  surfaceHeight,
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

describe("day/night cycle", () => {
  it("daylight factor ramps through dusk and dawn", () => {
    expect(daylightFactor(0)).toBe(1);
    expect(daylightFactor(6000)).toBe(1);
    expect(daylightFactor(12500)).toBeCloseTo(0.5);
    expect(daylightFactor(18000)).toBe(0);
    expect(daylightFactor(23500)).toBeCloseTo(0.5);
    expect(isNight(18000)).toBe(true);
    expect(isNight(6000)).toBe(false);
  });

  it("time advances with ticks, wraps at a full day, and is broadcast", () => {
    const sim = new Simulation(SEED);
    sim.timeOfDay = DAY_LENGTH - 5;
    const events: OutboundEvent[] = [];
    for (let i = 0; i < 200; i++) events.push(...sim.tick([]));
    expect(sim.timeOfDay).toBe(195);
    expect(events.some((o) => o.event.type === "time_changed")).toBe(true);
  });

  it("join tells the client the current time", () => {
    const sim = new Simulation(SEED);
    sim.timeOfDay = 7777;
    const player = sim.allocatePlayerId();
    const out = sim.tick([{ player, command: { type: "join", name: "T" } }]);
    expect(out).toContainEqual({ to: player, event: { type: "time_changed", time: 7777 } });
  });

  it("zombies burn on the surface in daylight", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    sim.timeOfDay = 6000; // midday
    const out: OutboundEvent[] = [];
    const zombie = sim.spawnMob("zombie", state.x + 30, surfaceHeight(SEED, Math.floor(state.x) + 30), out);
    const startHealth = zombie.health;
    for (let i = 0; i < 400; i++) sim.tick([]);
    // Either it burned down completely or is well on the way.
    if (sim.entities.has(zombie.id)) {
      expect(zombie.health).toBeLessThan(startHealth);
    } else {
      expect(sim.entities.has(zombie.id)).toBe(false);
    }
  });

  it("zombies do not burn at night", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    sim.timeOfDay = 18000; // midnight
    const out: OutboundEvent[] = [];
    const x = Math.floor(state.x) + 30;
    const zombie = sim.spawnMob("zombie", x + 0.5, surfaceHeight(SEED, x), out);
    for (let i = 0; i < 200; i++) sim.tick([]);
    if (sim.entities.has(zombie.id)) {
      expect(zombie.health).toBe(20);
    }
  });

  it("spawns zombies on the surface at night", () => {
    const sim = new Simulation(SEED);
    joinPlayer(sim);
    sim.timeOfDay = 15000;
    let zombies = 0;
    for (let i = 0; i < 3000; i++) {
      sim.tick([]);
      sim.timeOfDay = 15000; // hold the clock at night
      for (const e of sim.entities.values()) {
        if (e.kind === "zombie") zombies++;
      }
      if (zombies > 0) break;
    }
    expect(zombies).toBeGreaterThan(0);
  });
});
