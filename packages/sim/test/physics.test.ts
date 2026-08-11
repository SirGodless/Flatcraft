import { describe, expect, it } from "vitest";
import {
  BlockId,
  PLAYER_HEIGHT,
  Simulation,
  surfaceHeight,
  type PlayerId,
  type PlayerState,
} from "../src/index.js";

const SEED = 1337;

function joinPlayer(sim: Simulation): { player: PlayerId; state: PlayerState } {
  const player = sim.allocatePlayerId();
  sim.tick([{ player, command: { type: "join", name: "T" } }]);
  const state = sim.players.get(player)!;
  return { player, state };
}

function settle(sim: Simulation, ticks = 30): void {
  for (let i = 0; i < ticks; i++) sim.tick([]);
}

describe("player physics", () => {
  it("spawns on the surface and rests there under gravity", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    settle(sim);
    expect(state.onGround).toBe(true);
    // Feet exactly on top of the surface block.
    expect(state.y).toBe(surfaceHeight(SEED, 0));
    const yBefore = state.y;
    settle(sim, 10);
    expect(state.y).toBe(yBefore);
  });

  it("walks right while the intent is set and stops when cleared", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    settle(sim);
    const x0 = state.x;

    sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    settle(sim, 5);
    const x1 = state.x;
    expect(x1).toBeGreaterThan(x0);

    sim.tick([{ player, command: { type: "move", dx: 0, jump: false } }]);
    const x2 = state.x;
    settle(sim, 5);
    expect(state.x).toBe(x2);
  });

  it("jumps off the ground and lands again", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    settle(sim);
    const ground = state.y;

    sim.tick([{ player, command: { type: "move", dx: 0, jump: true } }]);
    sim.tick([]);
    expect(state.y).toBeLessThan(ground);
    expect(state.onGround).toBe(false);

    sim.tick([{ player, command: { type: "move", dx: 0, jump: false } }]);
    settle(sim, 30);
    expect(state.y).toBe(ground);
    expect(state.onGround).toBe(true);
  });

  it("is stopped by walls", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    settle(sim);

    // Build a two-block wall directly to the right of the player.
    const wallX = Math.floor(state.x) + 1;
    sim.world.ensureChunk(0, 0);
    sim.world.setBlock(wallX, Math.floor(state.y) - 1, BlockId.Stone);
    sim.world.setBlock(wallX, Math.floor(state.y) - 2, BlockId.Stone);

    sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    settle(sim, 20);
    // The player's right edge must not pass the wall face.
    expect(state.x).toBeLessThanOrEqual(wallX);
    expect(state.vx).toBe(0);
  });

  it("does not fall through the floor at terminal velocity", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    // Long free fall: dig a shaft under the spawn.
    sim.world.ensureChunk(0, 0);
    sim.world.ensureChunk(0, 1);
    const surface = surfaceHeight(SEED, 0);
    for (let y = surface; y < surface + 40; y++) {
      sim.world.setBlock(0, y, BlockId.Air);
    }
    settle(sim, 120);
    expect(state.onGround).toBe(true);
    expect(state.y).toBe(surface + 40);
  });

  it("emits player_moved broadcasts while moving", () => {
    const sim = new Simulation(SEED);
    const { player } = joinPlayer(sim);
    settle(sim);
    const out = sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    const moved = out.filter((o) => o.event.type === "player_moved");
    expect(moved.length).toBe(1);
    expect(moved[0]?.to).toBeUndefined();
    const event = moved[0]?.event;
    expect(event?.type === "player_moved" && event.player).toBe(player);
  });

  it("two simulations replaying the same input schedule stay identical", () => {
    const schedule = (sim: Simulation): Array<[number, number]> => {
      const { player, state } = joinPlayer(sim);
      const positions: Array<[number, number]> = [];
      sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
      for (let i = 0; i < 40; i++) {
        if (i === 10 || i === 25) {
          sim.tick([{ player, command: { type: "move", dx: 1, jump: true } }]);
        } else if (i === 15) {
          sim.tick([{ player, command: { type: "move", dx: -1, jump: false } }]);
        } else {
          sim.tick([]);
        }
        positions.push([state.x, state.y]);
      }
      return positions;
    };
    expect(schedule(new Simulation(SEED))).toEqual(schedule(new Simulation(SEED)));
  });

  it("rejects placing a block into a player's body", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    settle(sim);
    const tileX = Math.floor(state.x);
    const tileY = Math.floor(state.y) - 1; // inside the player's legs
    const result = sim.tick([
      { player, command: { type: "place_block", x: tileX, y: tileY, block: BlockId.Stone } },
    ]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "blocked by player" },
    });
  });
});
