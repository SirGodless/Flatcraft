import type { PlayerCommand, PlayerId, SlotRef } from "./commands.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import { CRAFT_GRID_SIZE, matchGrid, SMALL_GRID_INDICES } from "./crafting/match.js";
import { DEFAULT_COOK_TICKS, fuelTicks } from "./crafting/recipe.js";
import { RECIPES } from "./data/recipes/index.js";
import { createFurnace, furnaceIdle, furnaceKey, stepFurnace, type FurnaceState } from "./furnace.js";
import {
  addToInventory,
  cloneInventory,
  countInInventory,
  createInventory,
  HOTBAR_SIZE,
  INVENTORY_SIZE,
  removeFromInventory,
  type InventorySlots,
  type ItemStack,
} from "./inventory.js";
import { itemDef } from "./items.js";
import { createRng, type Rng } from "./math/rng.js";
import { canHarvest, miningTicks } from "./mining.js";
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
import { clickStack } from "./slots.js";
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
  /** Stack held on the cursor while a UI is open. */
  cursor: ItemStack | null;
  /** Personal 3x3 crafting grid (only the 2x2 corner without a table). */
  craftGrid: (ItemStack | null)[];
  /** Block currently being mined, with accumulated progress ticks. */
  mining: { x: number; y: number; progress: number } | null;
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
  readonly furnaces = new Map<string, FurnaceState>();
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
   * order, then run mining, furnaces and physics. Returns the outbound
   * events for the transport layer to deliver.
   */
  tick(commands: readonly PlayerCommand[]): OutboundEvent[] {
    const out: OutboundEvent[] = [];
    for (const pc of commands) {
      this.apply(pc, out);
    }
    this.stepMining(out);
    this.stepFurnaces(out);
    this.stepPlayers(out);
    this.tickCount++;
    return out;
  }

  private stepFurnaces(out: OutboundEvent[]): void {
    for (const state of this.furnaces.values()) {
      const changed = stepFurnace(state, RECIPES.values());
      // Broadcast at a low rate while active plus when turning idle, so
      // progress bars stay fresh without an event per tick.
      if (changed && (this.tickCount % 4 === 0 || furnaceIdle(state))) {
        out.push({ event: this.furnaceEvent(state) });
      }
    }
  }

  private furnaceEvent(state: FurnaceState): SimEvent {
    const recipe = state.input
      ? [...RECIPES.values()].find((r) => r.kind === "smelting" && r.ingredients.has(state.input!.item))
      : undefined;
    return {
      type: "furnace_changed",
      x: state.x,
      y: state.y,
      input: state.input ? { ...state.input } : null,
      fuel: state.fuel ? { ...state.fuel } : null,
      output: state.output ? { ...state.output } : null,
      burnLeft: state.burnLeft,
      burnTotal: state.burnTotal,
      cookProgress: state.cookProgress,
      cookTotal: recipe?.cookingTime ?? DEFAULT_COOK_TICKS,
    };
  }

  private stepMining(out: OutboundEvent[]): void {
    for (const p of this.players.values()) {
      const mining = p.mining;
      if (!mining) continue;

      const clear = (): void => {
        p.mining = null;
        out.push({
          event: { type: "mining_progress", player: p.id, x: mining.x, y: mining.y, progress: 0, total: 0 },
        });
      };

      if (!this.withinReach(p.id, mining.x, mining.y)) {
        clear();
        continue;
      }
      const block = this.world.getBlockGenerating(mining.x, mining.y);
      if (block === BlockId.Air || blockDef(block).hardness < 0) {
        clear();
        continue;
      }

      const held = p.inventory[p.selected] ?? null;
      // Recomputed every tick, so switching the held item mid-mining
      // changes the remaining time (progress is kept).
      const total = miningTicks(block, held);
      mining.progress++;

      if (mining.progress < total) {
        out.push({
          event: {
            type: "mining_progress",
            player: p.id,
            x: mining.x,
            y: mining.y,
            progress: mining.progress,
            total,
          },
        });
        continue;
      }

      clear();
      if (this.world.setBlock(mining.x, mining.y, BlockId.Air)) {
        out.push({ event: { type: "block_changed", x: mining.x, y: mining.y, block: BlockId.Air } });
        // A broken furnace hands its contents to the miner.
        if (block === BlockId.Furnace) {
          const state = this.furnaces.get(furnaceKey(mining.x, mining.y));
          if (state) {
            for (const stack of [state.input, state.fuel, state.output]) {
              if (stack) addToInventory(p.inventory, stack.item, stack.count);
            }
            this.furnaces.delete(furnaceKey(mining.x, mining.y));
          }
        }
        if (canHarvest(block, held)) {
          const drops = blockDrops(block);
          if (drops) {
            // Leftover that does not fit is lost until item entities exist.
            addToInventory(p.inventory, drops.item, drops.count);
          }
        }
        this.syncInventory(p, out);
      }
    }
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

  private syncInventory(p: PlayerState, out: OutboundEvent[]): void {
    out.push({
      to: p.id,
      event: {
        type: "inventory_changed",
        player: p.id,
        slots: cloneInventory(p.inventory),
        selected: p.selected,
        cursor: p.cursor ? { ...p.cursor } : null,
        craftGrid: cloneInventory(p.craftGrid),
      },
    });
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
      this.syncInventory(p, out);
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
          cursor: null,
          craftGrid: new Array<ItemStack | null>(CRAFT_GRID_SIZE).fill(null),
          mining: null,
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
        if (!recipe || recipe.kind !== "crafting") {
          reject("unknown recipe");
          break;
        }
        if (recipe.gridSize === 3 && !this.blockNearby(p, BlockId.CraftingTable)) {
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
      case "slot_click": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (command.button !== "left" && command.button !== "right") {
          reject("invalid button");
          break;
        }
        this.applySlotClick(p, command.slot, command.button, reject, broadcast);
        syncInventory(p);
        break;
      }
      case "return_grid": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        this.dumpGridAndCursor(p);
        syncInventory(p);
        break;
      }
      case "open_furnace": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        if (this.world.getBlockGenerating(x, y) !== BlockId.Furnace) {
          reject("no furnace there");
          break;
        }
        let state = this.furnaces.get(furnaceKey(x, y));
        if (!state) {
          state = createFurnace(x, y);
          this.furnaces.set(furnaceKey(x, y), state);
        }
        reply(this.furnaceEvent(state));
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
      case "start_mining": {
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
          reject("cannot mine");
          break;
        }
        p.mining = { x, y, progress: 0 };
        break;
      }
      case "stop_mining": {
        const p = this.players.get(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (p.mining) {
          const { x, y } = p.mining;
          p.mining = null;
          broadcast({ type: "mining_progress", player, x, y, progress: 0, total: 0 });
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

  private applySlotClick(
    p: PlayerState,
    slot: SlotRef,
    button: "left" | "right",
    reject: (reason: string) => void,
    broadcast: (event: SimEvent) => void,
  ): void {
    switch (slot.container) {
      case "inventory": {
        if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= INVENTORY_SIZE) {
          reject("invalid slot");
          return;
        }
        const result = clickStack(p.cursor, p.inventory[slot.index] ?? null, button);
        p.cursor = result.cursor;
        p.inventory[slot.index] = result.slot;
        return;
      }
      case "craft_grid": {
        if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= CRAFT_GRID_SIZE) {
          reject("invalid slot");
          return;
        }
        const tableNearby = this.blockNearby(p, BlockId.CraftingTable);
        if (!tableNearby && !SMALL_GRID_INDICES.includes(slot.index)) {
          reject("requires crafting table");
          return;
        }
        const result = clickStack(p.cursor, p.craftGrid[slot.index] ?? null, button);
        p.cursor = result.cursor;
        p.craftGrid[slot.index] = result.slot;
        return;
      }
      case "craft_result": {
        const maxSize = this.blockNearby(p, BlockId.CraftingTable) ? 3 : 2;
        const recipe = matchGrid(p.craftGrid, RECIPES.values(), maxSize);
        if (!recipe) {
          return;
        }
        const result = recipe.result;
        if (p.cursor && (p.cursor.item !== result.item || p.cursor.count + result.count > (itemDef(result.item)?.maxStack ?? 64))) {
          return;
        }
        p.cursor = p.cursor
          ? { item: p.cursor.item, count: p.cursor.count + result.count }
          : { item: result.item, count: result.count };
        for (let i = 0; i < CRAFT_GRID_SIZE; i++) {
          const cell = p.craftGrid[i];
          if (!cell) continue;
          p.craftGrid[i] = cell.count > 1 ? { item: cell.item, count: cell.count - 1 } : null;
        }
        return;
      }
      case "furnace": {
        const { x, y } = slot;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(p.id, x, y)) {
          reject("out of reach");
          return;
        }
        if (this.world.getBlockGenerating(x, y) !== BlockId.Furnace) {
          reject("no furnace there");
          return;
        }
        let state = this.furnaces.get(furnaceKey(x, y));
        if (!state) {
          state = createFurnace(x, y);
          this.furnaces.set(furnaceKey(x, y), state);
        }
        if (slot.slot === "output") {
          // Output is take-only.
          if (!state.output) return;
          if (p.cursor && p.cursor.item !== state.output.item) return;
          const maxStack = itemDef(state.output.item)?.maxStack ?? 64;
          const take = Math.min(state.output.count, maxStack - (p.cursor?.count ?? 0));
          if (take <= 0) return;
          p.cursor = {
            item: state.output.item,
            count: (p.cursor?.count ?? 0) + take,
          };
          const rest = state.output.count - take;
          state.output = rest > 0 ? { item: state.output.item, count: rest } : null;
        } else if (slot.slot === "fuel") {
          // Only fuel goes into the fuel slot.
          if (p.cursor && fuelTicks(p.cursor.item) === 0) {
            reject("not a fuel");
            return;
          }
          const result = clickStack(p.cursor, state.fuel, button);
          p.cursor = result.cursor;
          state.fuel = result.slot;
        } else {
          const result = clickStack(p.cursor, state.input, button);
          p.cursor = result.cursor;
          state.input = result.slot;
        }
        broadcast(this.furnaceEvent(state));
        return;
      }
    }
  }

  private dumpGridAndCursor(p: PlayerState): void {
    for (let i = 0; i < CRAFT_GRID_SIZE; i++) {
      const cell = p.craftGrid[i];
      if (!cell) continue;
      // Leftover that does not fit is lost until item entities exist.
      addToInventory(p.inventory, cell.item, cell.count);
      p.craftGrid[i] = null;
    }
    if (p.cursor) {
      addToInventory(p.inventory, p.cursor.item, p.cursor.count);
      p.cursor = null;
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

  private blockNearby(p: PlayerState, block: BlockId): boolean {
    const centerY = p.y - PLAYER_HEIGHT / 2;
    const minX = Math.floor(p.x - REACH);
    const maxX = Math.floor(p.x + REACH);
    const minY = Math.floor(centerY - REACH);
    const maxY = Math.floor(centerY + REACH);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (this.world.getBlock(tx, ty) === block) return true;
      }
    }
    return false;
  }
}
