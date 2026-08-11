import type { PlayerCommand, PlayerId } from "./commands.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import { createRng, type Rng } from "./math/rng.js";
import {
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  REACH,
  stepBody,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./physics.js";
import { blockDef, BlockId } from "./world/block.js";
import { findSpawnX, surfaceHeight } from "./world/gen.js";
import { World } from "./world/world.js";

/** The player's current movement intent, kept until the next move command. */
export interface PlayerInput {
  dx: -1 | 0 | 1;
  jump: boolean;
}

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Feet-center position in tiles (see physics.ts for the AABB layout). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  input: PlayerInput;
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
   * Advance the world by exactly one tick: apply the given commands in
   * order, then run the physics step for every player. Returns the
   * outbound events for the transport layer to deliver.
   */
  tick(commands: readonly PlayerCommand[]): OutboundEvent[] {
    const out: OutboundEvent[] = [];
    for (const pc of commands) {
      this.apply(pc, out);
    }
    this.stepPlayers(out);
    this.tickCount++;
    return out;
  }

  private stepPlayers(out: OutboundEvent[]): void {
    for (const p of this.players.values()) {
      const prevX = p.x;
      const prevY = p.y;

      p.vx = p.input.dx * WALK_SPEED;
      if (p.input.jump && p.onGround) {
        p.vy = JUMP_VELOCITY;
      }
      p.vy = Math.min(p.vy + GRAVITY, TERMINAL_VELOCITY);
      stepBody(this.world, p, PLAYER_WIDTH, PLAYER_HEIGHT);

      if (p.x !== prevX || p.y !== prevY) {
        out.push({ event: { type: "player_moved", player: p.id, x: p.x, y: p.y } });
      }
    }
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
        const spawnX = findSpawnX(this.world.seed);
        const x = spawnX + 0.5;
        const y = surfaceHeight(this.world.seed, spawnX);
        const state: PlayerState = {
          id: player,
          name: command.name,
          x,
          y,
          vx: 0,
          vy: 0,
          onGround: false,
          input: { dx: 0, jump: false },
        };
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
      case "move": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (![-1, 0, 1].includes(command.dx) || typeof command.jump !== "boolean") {
          reject("invalid input");
          break;
        }
        p.input = { dx: command.dx, jump: command.jump };
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
        if (!this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        const current = this.world.getBlockGenerating(x, y);
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
        // Unknown ids fall back to air; hardness -1 covers bedrock, water etc.
        const def = blockDef(command.block);
        if (def.id === BlockId.Air || def.hardness < 0) {
          reject("block not placeable");
          break;
        }
        if (!this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        if (this.world.getBlockGenerating(x, y) !== BlockId.Air) {
          reject("space occupied");
          break;
        }
        if (this.tileIntersectsAnyPlayer(x, y)) {
          reject("blocked by player");
          break;
        }
        if (this.world.setBlock(x, y, command.block)) {
          broadcast({ type: "block_changed", x, y, block: command.block });
        }
        break;
      }
    }
  }

  private withinReach(player: PlayerId, tileX: number, tileY: number): boolean {
    const p = this.players.get(player);
    if (!p) return false;
    const dx = tileX + 0.5 - p.x;
    const dy = tileY + 0.5 - (p.y - PLAYER_HEIGHT / 2);
    return dx * dx + dy * dy <= REACH * REACH;
  }

  private tileIntersectsAnyPlayer(tileX: number, tileY: number): boolean {
    for (const p of this.players.values()) {
      const overlapsX = tileX + 1 > p.x - PLAYER_WIDTH / 2 && tileX < p.x + PLAYER_WIDTH / 2;
      const overlapsY = tileY + 1 > p.y - PLAYER_HEIGHT && tileY < p.y;
      if (overlapsX && overlapsY) return true;
    }
    return false;
  }
}
