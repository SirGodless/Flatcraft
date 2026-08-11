import type { PlayerCommand, PlayerId } from "./commands.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import { RECIPES } from "./data/recipes/index.js";
import {
  addToInventory,
  cloneInventory,
  countInInventory,
  createInventory,
  HOTBAR_SIZE,
  removeFromInventory,
  type InventorySlots,
} from "./inventory.js";
import { itemDef } from "./items.js";
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
import { blockDef, blockDrops, BlockId } from "./world/block.js";
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
  inventory: InventorySlots;
  /** Selected hotbar slot, 0..8. */
  selected: number;
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
    const syncInventory = (p: PlayerState): void => {
      reply({
        type: "inventory_changed",
        player: p.id,
        slots: cloneInventory(p.inventory),
        selected: p.selected,
      });
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
          inventory: createInventory(),
          selected: 0,
        };
        this.players.set(player, state);
        broadcast({ type: "player_joined", player, name: state.name, x, y });
        syncInventory(state);
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
      case "select_slot": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (!Number.isInteger(command.index) || command.index < 0 || command.index >= HOTBAR_SIZE) {
          reject("invalid slot");
          break;
        }
        p.selected = command.index;
        syncInventory(p);
        break;
      }
      case "craft": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const recipe = RECIPES.get(command.recipe);
        if (!recipe) {
          reject("unknown recipe");
          break;
        }
        if (recipe.gridSize === 3 && !this.craftingTableNearby(p)) {
          reject("requires crafting table");
          break;
        }
        for (const [item, count] of recipe.ingredients) {
          if (countInInventory(p.inventory, item) < count) {
            reject("missing ingredients");
            return;
          }
        }
        for (const [item, count] of recipe.ingredients) {
          removeFromInventory(p.inventory, item, count);
        }
        // Leftover that does not fit is lost until item entities exist.
        addToInventory(p.inventory, recipe.result.item, recipe.result.count);
        syncInventory(p);
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
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
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
          const drops = blockDrops(current);
          if (drops) {
            // Leftover that does not fit is lost until item entities exist.
            addToInventory(p.inventory, drops.item, drops.count);
            syncInventory(p);
          }
        }
        break;
      }
      case "place_block": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          reject("invalid coordinates");
          break;
        }
        const stack = p.inventory[p.selected];
        if (!stack) {
          reject("nothing to place");
          break;
        }
        const def = itemDef(stack.item);
        if (def?.block === undefined) {
          reject("item not placeable");
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
        if (blockDef(def.block).solid && this.tileIntersectsAnyPlayer(x, y)) {
          reject("blocked by player");
          break;
        }
        if (this.world.setBlock(x, y, def.block)) {
          stack.count -= 1;
          if (stack.count === 0) {
            p.inventory[p.selected] = null;
          }
          broadcast({ type: "block_changed", x, y, block: def.block });
          syncInventory(p);
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

  private craftingTableNearby(p: PlayerState): boolean {
    const centerY = p.y - PLAYER_HEIGHT / 2;
    const minX = Math.floor(p.x - REACH);
    const maxX = Math.floor(p.x + REACH);
    const minY = Math.floor(centerY - REACH);
    const maxY = Math.floor(centerY + REACH);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (this.world.getBlock(tx, ty) === BlockId.CraftingTable) return true;
      }
    }
    return false;
  }
}
