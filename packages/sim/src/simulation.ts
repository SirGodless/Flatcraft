import type { PlayerCommand, PlayerId } from "./commands.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import { createRng, type Rng } from "./math/rng.js";
import { blockDef, BlockId } from "./world/block.js";
import { surfaceHeight } from "./world/gen.js";
import { World } from "./world/world.js";

export interface PlayerState {
  id: PlayerId;
  name: string;
  x: number;
  y: number;
}

/** Reject chunk requests absurdly far out (bad client / future cheat guard). */
const MAX_CHUNK_COORD = 1_000_000;

/**
 * The authoritative game simulation. Deterministic and tick-based:
 * given the same seed and the same command stream per tick, every instance
 * produces the identical state. It never touches DOM, time, Math.random or
 * any other ambient environment - all inputs arrive via commands.
 */
export class Simulation {
  readonly world: World;
  readonly players = new Map<PlayerId, PlayerState>();
  tickCount = 0;

  private readonly rng: Rng;
  private nextPlayerId: PlayerId = 1;

  constructor(seed: number) {
    this.world = new World(seed);
    this.rng = createRng(seed);
  }

  /** Reserve a player id for a new connection (embedded or remote). */
  allocatePlayerId(): PlayerId {
    return this.nextPlayerId++;
  }

  /**
   * Advance the world by exactly one tick, applying the given commands in
   * order. Returns the outbound events for the transport layer to deliver.
   */
  tick(commands: readonly PlayerCommand[]): OutboundEvent[] {
    const out: OutboundEvent[] = [];
    for (const pc of commands) {
      this.apply(pc, out);
    }
    // Entity/physics updates per tick will run here once implemented.
    this.tickCount++;
    return out;
  }

  private apply({ player, command }: PlayerCommand, out: OutboundEvent[]): void {
    const broadcast = (event: SimEvent): void => {
      out.push({ event });
    };
    const reply = (event: SimEvent): void => {
      out.push({ to: player, event });
    };
    const reject = (reason: string): void => {
      reply({ type: "command_rejected", player, reason });
    };

    switch (command.type) {
      case "join": {
        const x = 0;
        const y = surfaceHeight(this.world.seed, x) - 2;
        const state: PlayerState = { id: player, name: command.name, x, y };
        this.players.set(player, state);
        broadcast({ type: "player_joined", player, name: state.name, x, y });
        break;
      }
      case "leave": {
        if (this.players.delete(player)) {
          broadcast({ type: "player_left", player });
        }
        break;
      }
      case "request_chunk": {
        const { cx, cy } = command;
        if (
          !Number.isInteger(cx) ||
          !Number.isInteger(cy) ||
          Math.abs(cx) > MAX_CHUNK_COORD ||
          Math.abs(cy) > MAX_CHUNK_COORD
        ) {
          reject("invalid chunk coordinates");
          break;
        }
        const chunk = this.world.ensureChunk(cx, cy);
        reply({ type: "chunk_data", cx, cy, tiles: Array.from(chunk.tiles) });
        break;
      }
      case "break_block": {
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          reject("invalid coordinates");
          break;
        }
        this.world.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
        const current = this.world.getBlock(x, y);
        if (current === BlockId.Air || blockDef(current).hardness < 0) {
          reject("cannot break block");
          break;
        }
        if (this.world.setBlock(x, y, BlockId.Air)) {
          broadcast({ type: "block_changed", x, y, block: BlockId.Air });
        }
        break;
      }
      case "place_block": {
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          reject("invalid coordinates");
          break;
        }
        if (command.block === BlockId.Air || command.block === BlockId.Bedrock) {
          reject("block not placeable");
          break;
        }
        this.world.ensureChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
        if (this.world.getBlock(x, y) !== BlockId.Air) {
          reject("space occupied");
          break;
        }
        if (this.world.setBlock(x, y, command.block)) {
          broadcast({ type: "block_changed", x, y, block: command.block });
        }
        break;
      }
      case "move":
        // Movement will be resolved by the physics step once it exists.
        break;
    }
  }
}
