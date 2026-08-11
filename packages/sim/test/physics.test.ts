import { describe, expect, it } from "vitest";
import {
  blockDef,
  BlockId,
  CHUNK_HEIGHT,
  CHUNK_WIDTH,
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
  const state = sim.players.get(player)!;
  return { player, state };
}

function settle(sim: Simulation, ticks = 30): void {
  for (let i = 0; i < ticks; i++) sim.tick([]);
}

function setBlock(sim: Simulation, x: number, y: number, id: BlockId): void {
  sim.world.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
  sim.world.setBlock(x, y, id);
}

describe("player physics", () => {
  it("spawns on dry land and rests there under gravity", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    expect(SURFACE).toBeLessThan(6); // sea level: spawn is not underwater
    settle(sim);
    expect(state.onGround).toBe(true);
    // Feet exactly on top of the surface block.
    expect(state.y).toBe(SURFACE);
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

    // Build a tall wall one column to the right, covering well above and
    // below the surface so slopes cannot route around it.
    const wallX = Math.floor(state.x) + 1;
    for (let y = SURFACE - 5; y <= SURFACE + 6; y++) {
      setBlock(sim, wallX, y, BlockId.Stone);
    }

    sim.tick([{ player, command: { type: "move", dx: 1, jump: false } }]);
    settle(sim, 20);
    // The player's right edge must not pass the wall face.
    expect(state.x).toBeLessThanOrEqual(wallX);
    expect(state.vx).toBe(0);
  });

  it("does not fall through the floor after a long fall", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    // Dig a 40-tile shaft under the spawn column.
    const x = SPAWN_X;
    for (let y = SURFACE; y < SURFACE + 40; y++) {
      setBlock(sim, x, y, BlockId.Air);
    }
    // First solid tile below the shaft (caves may extend it further).
    let floorY = SURFACE + 40;
    while (!blockDef(sim.world.getBlockGenerating(x, floorY)).solid) {
      floorY++;
    }
    settle(sim, 200);
    expect(state.onGround).toBe(true);
    expect(state.y).toBe(floorY);
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
    setBlock(sim, tileX, tileY, BlockId.Air);
    const result = sim.tick([
      { player, command: { type: "place_block", x: tileX, y: tileY, block: BlockId.Stone } },
    ]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "blocked by player" },
    });
  });
});
