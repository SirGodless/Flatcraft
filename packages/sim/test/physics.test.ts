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

  it("jumps high enough to climb one block, but not two", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    settle(sim);

    // A one-block step directly to the right of the player, walled off
    // behind so the jump-running player (the move intent persists) can't
    // simply fly across it. At some tick they must stand on top of it.
    const stepX = Math.floor(state.x) + 1;
    setBlock(sim, stepX, SURFACE - 1, BlockId.Stone);
    setBlock(sim, stepX + 1, SURFACE - 1, BlockId.Stone);
    for (let dy = 1; dy <= 4; dy++) setBlock(sim, stepX + 2, SURFACE - dy, BlockId.Stone);
    sim.tick([{ player, command: { type: "move", dx: 1, jump: true } }]);
    let stoodOnStep = false;
    for (let i = 0; i < 60 && !stoodOnStep; i++) {
      sim.tick([]);
      stoodOnStep =
        state.onGround &&
        state.y === SURFACE - 1 &&
        Math.floor(state.x) >= stepX &&
        Math.floor(state.x) <= stepX + 1;
    }
    expect(stoodOnStep).toBe(true);

    // Raise it to a two-block wall: jumping must not clear it.
    sim.tick([{ player, command: { type: "move", dx: 0, jump: false } }]);
    state.x = stepX - 1.5;
    state.y = SURFACE;
    state.vx = 0;
    state.vy = 0;
    setBlock(sim, stepX, SURFACE - 2, BlockId.Stone);
    sim.tick([{ player, command: { type: "move", dx: 1, jump: true } }]);
    for (let i = 0; i < 60; i++) sim.tick([]);
    expect(state.x).toBeLessThan(stepX); // still stuck in front of the wall
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

  it("lands on the floor after a fall and takes fall damage", () => {
    const sim = new Simulation(SEED);
    const { state } = joinPlayer(sim);
    // Dig an 8-tile shaft under the spawn column (survivable fall).
    const x = SPAWN_X;
    for (let y = SURFACE; y < SURFACE + 8; y++) {
      setBlock(sim, x, y, BlockId.Air);
    }
    // First solid tile below the shaft (caves may extend it further).
    let floorY = SURFACE + 8;
    while (!blockDef(sim.world.getBlockGenerating(x, floorY)).solid) {
      floorY++;
    }
    settle(sim, 100);
    expect(state.onGround).toBe(true);
    expect(state.y).toBe(floorY);
    // Fell floorY - SURFACE tiles; everything past 3 hurts (minus possible regen).
    const excess = floorY - SURFACE - 3;
    expect(state.health).toBeLessThanOrEqual(20 - excess + 2);
    expect(state.health).toBeLessThan(20);
  });

  it("dies from a lethal fall and respawns at the spawn point", () => {
    const sim = new Simulation(SEED);
    const { player, state } = joinPlayer(sim);
    // A 30-tile shaft in the NEIGHBOR column (the spawn column must stay
    // intact for the respawn), far beyond lethal (30 - 3 = 27 damage).
    const x = SPAWN_X + 1;
    const colSurface = surfaceHeight(SEED, x);
    for (let y = colSurface; y < colSurface + 30; y++) {
      setBlock(sim, x, y, BlockId.Air);
    }
    // Teleport the player over the shaft (white-box).
    state.x = x + 0.5;
    state.y = colSurface - 1;
    state.inventory[0] = { item: "cobblestone", count: 5 };
    const events: unknown[] = [];
    for (let i = 0; i < 150; i++) {
      events.push(...sim.tick([]));
    }
    // Respawned on the surface at full (possibly regenerating) health...
    expect(state.y).toBe(SURFACE);
    expect(state.onGround).toBe(true);
    expect(state.health).toBeGreaterThanOrEqual(19);
    // ...and the inventory was dropped as item entities down in the shaft.
    expect(state.inventory.every((s) => s === null || s.item !== "cobblestone")).toBe(true);
    expect(player).toBeGreaterThan(0);
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
    state.inventory[0] = { item: "cobblestone", count: 1 };
    const result = sim.tick([{ player, command: { type: "place_block", x: tileX, y: tileY } }]);
    expect(result).toContainEqual({
      to: player,
      event: { type: "command_rejected", player, reason: "blocked by player" },
    });
  });
});
