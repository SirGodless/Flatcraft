import type { PlayerCommand, PlayerId } from "./commands.js";
import type { SimEvent } from "./events.js";
import { createRng, type Rng } from "./math/rng.js";
import { blockDef, BlockId } from "./world/block.js";
import { World } from "./world/world.js";

export interface PlayerState {
  id: PlayerId;
  name: string;
  x: number;
  y: number;
}

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
   * order. Returns the events produced, for clients/transports to consume.
   */
  tick(commands: readonly PlayerCommand[]): SimEvent[] {
    const events: SimEvent[] = [];
    for (const pc of commands) {
      this.apply(pc, events);
    }
    // Entity/physics updates per tick will run here once implemented.
    this.tickCount++;
    return events;
  }

  private apply({ player, command }: PlayerCommand, events: SimEvent[]): void {
    switch (command.type) {
      case "join": {
        const state: PlayerState = { id: player, name: command.name, x: 0, y: 0 };
        this.players.set(player, state);
        events.push({ type: "player_joined", player, name: state.name, x: state.x, y: state.y });
        break;
      }
      case "leave": {
        if (this.players.delete(player)) {
          events.push({ type: "player_left", player });
        }
        break;
      }
      case "break_block": {
        const current = this.world.getBlock(command.x, command.y);
        if (current === BlockId.Air || blockDef(current).hardness < 0) {
          events.push({ type: "command_rejected", player, reason: "cannot break block" });
          break;
        }
        if (this.world.setBlock(command.x, command.y, BlockId.Air)) {
          events.push({ type: "block_changed", x: command.x, y: command.y, block: BlockId.Air });
        }
        break;
      }
      case "place_block": {
        if (this.world.getBlock(command.x, command.y) !== BlockId.Air) {
          events.push({ type: "command_rejected", player, reason: "space occupied" });
          break;
        }
        if (this.world.setBlock(command.x, command.y, command.block)) {
          events.push({ type: "block_changed", x: command.x, y: command.y, block: command.block });
        }
        break;
      }
      case "move":
        // Movement will be resolved by the physics step once it exists.
        break;
    }
  }
}
