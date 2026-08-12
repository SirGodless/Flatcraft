import { describe, expect, it } from "vitest";
import {
  findSpawnX,
  Simulation,
  surfaceHeight,
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

/** Put the player high in the air and start moving right. */
function launch(sim: Simulation, state: PlayerState, withElytra: boolean, holdJump: boolean, player: PlayerId): void {
  if (withElytra) state.inventory[8] = { item: "elytra", count: 1 };
  state.x = SPAWN_X + 0.5;
  state.y = SURFACE - 40;
  state.vy = 0;
  state.onGround = false;
  sim.tick([{ player, command: { type: "move", dx: 1, jump: holdJump } }]);
}

describe("elytra", () => {
  it("glides: slow descent and fast horizontal travel while holding jump", () => {
    const measure = (withElytra: boolean): { dx: number; dy: number } => {
      const sim = new Simulation(SEED);
      const { player, state } = joinPlayer(sim);
      launch(sim, state, withElytra, true, player);
      const x0 = state.x;
      const y0 = state.y;
      for (let i = 0; i < 40; i++) sim.tick([]);
      return { dx: state.x - x0, dy: state.y - y0 };
    };
    const glide = measure(true);
    const fall = measure(false);
    expect(glide.dy).toBeLessThan(fall.dy * 0.5); // sinks much slower
    expect(glide.dx).toBeGreaterThan(fall.dx * 1.5); // travels much farther
  });

  it("prevents fall damage while gliding to the ground", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    launch(sim, state, true, true, player);
    for (let i = 0; i < 1200 && !state.onGround; i++) sim.tick([]);
    expect(state.onGround).toBe(true);
    expect(state.health).toBe(20);
  });

  it("without holding jump, the elytra does nothing", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    launch(sim, state, true, false, player);
    for (let i = 0; i < 200 && !state.onGround; i++) sim.tick([]);
    expect(state.onGround).toBe(true);
    // Fell ~37 tiles freely: that hurts (or kills and respawns at full HP
    // back at the spawn point).
    expect(state.health < 20 || state.y === SURFACE).toBe(true);
  });
});
