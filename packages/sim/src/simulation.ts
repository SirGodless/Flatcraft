import type { PlayerCommand, PlayerId, SlotRef } from "./commands.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_WIDTH } from "./constants.js";
import { CRAFT_GRID_SIZE, matchGrid, SMALL_GRID_INDICES } from "./crafting/match.js";
import { DEFAULT_COOK_TICKS, fuelTicks, ingredientOptions } from "./crafting/recipe.js";
import { RECIPES } from "./data/recipes/index.js";
import { createFurnace, furnaceIdle, furnaceKey, stepFurnace, type FurnaceState } from "./furnace.js";
import {
  ARROW_TTL,
  ATTACK_REACH,
  BOW_ARROW_SPEED,
  BOW_COOLDOWN,
  BOW_DAMAGE,
  ITEM_DESPAWN_TICKS,
  ITEM_PICKUP_DELAY,
  ITEM_PICKUP_RADIUS,
  isArrowEntity,
  isItemEntity,
  isMobEntity,
  isPlayerEntity,
  MOB_CAP,
  MOB_DESPAWN_RANGE,
  type ArrowEntity,
  type Entity,
  type EntityId,
  type ItemEntity,
  type MobEntity,
  type MobKind,
  type PlayerEntity,
} from "./entities.js";
import { mobDef, mobsNearStructure, sizeOf, spawnPool, type ExplodesDef } from "./mobs.js";
import {
  attackDamage,
  attackKnockback,
  HURT_COOLDOWN_TICKS,
  PLAYER_ATTACK_COOLDOWN,
  PLAYER_MAX_HEALTH,
  REGEN_INTERVAL_TICKS,
  SAFE_FALL_TILES,
} from "./combat.js";
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
import {
  EFFECT_DURATION_TICKS,
  ENCHANT_LAPIS_COST,
  ENCHANT_MAX_LEVEL,
  enchantFor,
  potionEffect,
  REGEN_EFFECT_INTERVAL,
  SPEED_MULTIPLIER,
  STRENGTH_BONUS,
} from "./effects.js";
import {
  EXHAUST_JUMP,
  EXHAUST_MINE,
  EXHAUST_REGEN,
  EXHAUST_WALK,
  EXHAUSTION_PER_POINT,
  HUNGER_REGEN_MIN,
  PLAYER_MAX_HUNGER,
  STARVE_INTERVAL_TICKS,
  STARVE_MIN_HEALTH,
} from "./hunger.js";
import { rngNext, type Rng, type RngState } from "./math/rng.js";
import { canHarvest, miningTicks } from "./mining.js";
import {
  ELYTRA_GLIDE_BOOST,
  ELYTRA_SINK,
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  REACH,
  stepBody,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./physics.js";
import {
  buildPortal,
  convertFrame,
  findPortalInterior,
  nearPortal,
  NETHER_SCALE,
  PORTAL_COOLDOWN,
  PORTAL_TICKS,
} from "./portal.js";
import type { SimSave } from "./save.js";
import { clickStack } from "./slots.js";
import { placementsNear, structureLootAt } from "./structures/place.js";
import { TRADES } from "./data/trades/index.js";
import { DAY_LENGTH, daylightFactor, isNight } from "./time.js";
import { allBlocks, blockByName, blockDef, blockDrops, BlockId, liquidBlock } from "./world/block.js";
import { Biome, biomeAt, findSpawnX, surfaceHeight } from "./world/gen.js";
import { LAVA_LEVEL } from "./world/nether.js";
import { World, type Dimension } from "./world/world.js";

/**
 * Old-id -> current-id table from a save's block palette, or null when
 * every id already matches (the common case - skips the remap pass).
 * Exported so a host that loads chunks outside the bulk deserialize path
 * (e.g. the dedicated server's on-demand region-file loader) can apply the
 * exact same remap to a chunk it decodes later, mid-session.
 */
export function buildBlockRemap(palette: Record<number, string> | undefined): Map<number, number> | null {
  if (!palette) return null;
  const remap = new Map<number, number>();
  let identical = true;
  for (const [oldIdRaw, name] of Object.entries(palette)) {
    const oldId = Number(oldIdRaw);
    const current = blockByName(name) ?? BlockId.Air;
    remap.set(oldId, current);
    if (current !== oldId) identical = false;
  }
  return identical ? null : remap;
}

/** One past the highest id already used by any saved entity or player -
 * the fallback for a save whose own nextId can't be trusted (see
 * deserialize). Never collides with what's already on disk, unlike just
 * resuming from 1. */
function safeNextId(save: SimSave): number {
  let max = 0;
  for (const e of save.entities) max = Math.max(max, e.id);
  for (const p of save.players) max = Math.max(max, p.id);
  return max + 1;
}

/** Default body color for players who never picked one. */
export const DEFAULT_PLAYER_COLOR = 0x4868e0;

/** A valid 0xRRGGBB color, or null. */
function sanitizeColor(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff
    ? value
    : null;
}

/** Diving: air supply in ticks, and drowning damage cadence. */
export const MAX_AIR_TICKS = 200;
export const DROWN_DAMAGE_INTERVAL = 40;
/** Grappling hook pull speed, tiles/tick. */
export const GRAPPLE_SPEED = 0.7;

/** Reject chunk requests absurdly far out (bad client / future cheat guard). */
const MAX_CHUNK_COORD = 1_000_000;

/**
 * The authoritative game simulation. Deterministic and tick-based:
 * given the same seed and the same command stream per tick, every instance
 * produces the identical state. It never touches DOM, time, Math.random or
 * any other ambient environment - all inputs arrive via commands.
 */
export class Simulation {
  readonly worlds: Record<Dimension, World>;
  readonly furnaces = new Map<string, FurnaceState>();
  /** Chest contents, keyed like furnaces: "dim:x,y". */
  readonly chests = new Map<string, { dimension: Dimension; x: number; y: number; slots: (ItemStack | null)[] }>();
  readonly entities = new Map<EntityId, Entity>();
  /** Known portal interiors (bottom-left of interior), per dimension. */
  readonly portals: Record<Dimension, Map<string, { x: number; y: number }>> = {
    overworld: new Map(),
    nether: new Map(),
  };
  tickCount = 0;
  /** Time of day in ticks, 0..DAY_LENGTH (writable, e.g. for tests). */
  timeOfDay = 0;
  /** Liquid tiles that may need to flow, per dimension ("x,y"). */
  private readonly liquidActive: Record<Dimension, Set<string>> = {
    overworld: new Set(),
    nether: new Set(),
  };

  private readonly rng: Rng;
  private readonly rngState: RngState;
  /** Single allocator for both player and entity ids - they share one
   * id space, so a player and a mob can never collide. */
  private nextId: EntityId = 1;
  /** Disconnected players' state, by name, adopted on rejoin. */
  private readonly savedPlayers = new Map<string, PlayerEntity>();
  /** Last facing/held-item state broadcast per player, to detect changes
   * without hooking every place inventory/offhand/facing can mutate. */
  private readonly lastGear = new Map<PlayerId, { facing: "left" | "right"; main: string | null; off: string | null }>();

  constructor(seed: number) {
    this.worlds = {
      overworld: new World(seed, "overworld"),
      nether: new World(seed, "nether"),
    };
    this.rngState = { s: seed >>> 0 };
    this.rng = () => rngNext(this.rngState);
  }

  /** Connected players are just entities with kind "player" - this is a
   * read-only snapshot view for callers that want a player-only map (a
   * live player is never removed from `entities` except via "leave"; the
   * returned Map is a fresh snapshot, but its values are the same live
   * entity objects, so mutating them still mutates the simulation). */
  get players(): ReadonlyMap<PlayerId, PlayerEntity> {
    const map = new Map<PlayerId, PlayerEntity>();
    for (const p of this.playerEntities()) map.set(p.id, p);
    return map;
  }

  private getPlayer(id: PlayerId): PlayerEntity | undefined {
    const e = this.entities.get(id);
    return e && isPlayerEntity(e) ? e : undefined;
  }

  private *playerEntities(): IterableIterator<PlayerEntity> {
    for (const e of this.entities.values()) {
      if (isPlayerEntity(e)) yield e;
    }
  }

  private hasPlayers(): boolean {
    for (const _ of this.playerEntities()) return true;
    return false;
  }

  /** Snapshot the complete simulation state as plain serializable data. */
  serialize(): SimSave {
    const blockPalette: Record<number, string> = {};
    for (const def of allBlocks()) {
      blockPalette[def.id] = def.name;
    }
    return {
      version: 5,
      blockPalette,
      seed: this.world.seed,
      tickCount: this.tickCount,
      timeOfDay: this.timeOfDay,
      rng: this.rngState.s,
      nextId: this.nextId,
      worlds: {
        overworld: this.worlds.overworld.serializeChunks(),
        nether: this.worlds.nether.serializeChunks(),
      },
      furnaces: [...this.furnaces.values()].map((f) => structuredClone(f)),
      chests: [...this.chests.values()].map((c) => structuredClone(c)),
      portals: {
        overworld: [...this.portals.overworld.values()],
        nether: [...this.portals.nether.values()],
      },
      // Players live in `entities` too, but are saved separately below.
      entities: [...this.entities.values()].filter((e) => !isPlayerEntity(e)).map((e) => structuredClone(e)),
      // Both connected and previously saved players, by name.
      players: [
        ...[...this.playerEntities()].map((p) => structuredClone(p)),
        ...[...this.savedPlayers.values()].map((p) => structuredClone(p)),
      ],
    };
  }

  /** Rebuild a simulation from a snapshot. */
  static deserialize(save: SimSave): Simulation {
    const sim = new Simulation(save.seed);
    sim.tickCount = save.tickCount;
    sim.timeOfDay = save.timeOfDay;
    sim.rngState.s = save.rng;
    // Saves from before the unified id allocator (version < 3) carry no
    // usable nextId - JSON round-trips a corrupt value (NaN) to `null`,
    // and `null++` happens to land on 1, silently colliding with an id
    // already in use (the exact bug the unified allocator exists to
    // prevent). Fall back to one past the highest id already on record.
    sim.nextId = Number.isFinite(save.nextId) && save.nextId > 0 ? save.nextId : safeNextId(save);
    // Saved block numbers are remapped by their palette names, so a
    // renumbered registry (or removed mod blocks -> air) loads cleanly.
    // Applied inside loadChunks (post-RLE-decode, one id per tile) rather
    // than on the raw run arrays here - those alternate id/count, and
    // remapping every element would corrupt the counts too.
    const remap = buildBlockRemap(save.blockPalette);
    for (const dim of ["overworld", "nether"] as const) {
      sim.worlds[dim].loadChunks(save.worlds[dim], remap);
    }
    for (const f of save.furnaces) {
      // Saves from before per-block furnace speed lack the field.
      sim.furnaces.set(furnaceKey(f.dimension, f.x, f.y), { ...structuredClone(f), speed: f.speed ?? 1 });
    }
    for (const c of save.chests ?? []) {
      sim.chests.set(furnaceKey(c.dimension, c.x, c.y), structuredClone(c));
    }
    for (const dim of ["overworld", "nether"] as const) {
      for (const pos of save.portals[dim]) {
        sim.portals[dim].set(`${pos.x},${pos.y}`, { ...pos });
      }
    }
    for (const e of save.entities) {
      sim.entities.set(e.id, structuredClone(e));
    }
    // Players wait as "saved" until someone joins with their name.
    for (const p of save.players) {
      sim.savedPlayers.set(p.name, structuredClone(p));
    }
    return sim;
  }

  /** Drops every player's saved state (position, inventory, health, ...)
   * so the next join with that name starts fresh, without touching the
   * world itself (blocks, mobs, dropped items). Intended for server
   * startup only, right after construction/deserialize and before any
   * connection has joined - at that point every player is still "saved"
   * (see deserialize), never a live entity yet, so clearing savedPlayers
   * alone is enough. */
  resetPlayers(): void {
    this.savedPlayers.clear();
  }

  /** The overworld (kept for compatibility; use worldOf for others). */
  get world(): World {
    return this.worlds.overworld;
  }

  worldOf(dimension: Dimension): World {
    return this.worlds[dimension];
  }

  /** Reserve a player id for a new connection (embedded or remote). Draws
   * from the same id space as spawned entities, so a player and a mob
   * can never end up sharing an id. */
  allocatePlayerId(): PlayerId {
    return this.nextId++;
  }

  tick(commands: readonly PlayerCommand[]): OutboundEvent[] {
    const out: OutboundEvent[] = [];
    for (const pc of commands) {
      this.apply(pc, out);
    }
    this.stepMining(out);
    this.stepFurnaces(out);
    this.stepLiquids(out);
    this.stepEntities(out);
    this.stepPlayers(out);
    this.stepGearSync(out);
    this.stepSpawning(out);
    this.tickCount++;
    this.timeOfDay = (this.timeOfDay + 1) % DAY_LENGTH;
    if (this.tickCount % 100 === 0) {
      out.push({ event: { type: "time_changed", time: this.timeOfDay } });
    }
    return out;
  }

  /** Spawn an item lying in the world (block drops, mob loot, death drops). */
  spawnItem(dimension: Dimension, x: number, y: number, stack: ItemStack, out: OutboundEvent[]): ItemEntity {
    const entity: ItemEntity = {
      id: this.nextId++,
      kind: "item",
      dimension,
      x,
      y,
      vx: (this.rng() - 0.5) * 0.15,
      vy: -0.15,
      onGround: false,
      stack: { ...stack },
      age: 0,
      pickupDelay: ITEM_PICKUP_DELAY,
    };
    this.entities.set(entity.id, entity);
    out.push({
      event: { type: "entity_spawned", id: entity.id, kind: "item", dim: dimension, x, y, stack: { ...stack } },
    });
    return entity;
  }

  spawnMob(kind: MobKind, x: number, y: number, out: OutboundEvent[], dimension: Dimension = "overworld"): MobEntity {
    const def = mobDef(kind);
    if (!def) throw new Error(`spawnMob: unknown mob kind "${kind}"`);
    const entity: MobEntity = {
      id: this.nextId++,
      kind,
      dimension,
      x,
      y,
      vx: 0,
      vy: 0,
      onGround: false,
      health: def.health,
      hurtCooldown: 0,
      attackCooldown: 0,
      wanderDir: 0,
      wanderTimer: 0,
      ...(def.equipment?.armor !== undefined ? { armor: { item: def.equipment.armor, count: 1 } } : {}),
      ...(def.equipment?.offhand !== undefined ? { offhand: { item: def.equipment.offhand, count: 1 } } : {}),
    };
    this.entities.set(entity.id, entity);
    out.push({ event: { type: "entity_spawned", id: entity.id, kind, dim: dimension, x, y } });
    return entity;
  }

  private removeEntity(id: EntityId, out: OutboundEvent[]): void {
    if (this.entities.delete(id)) {
      out.push({ event: { type: "entity_removed", id } });
    }
  }

  private stepFurnaces(out: OutboundEvent[]): void {
    for (const state of this.furnaces.values()) {
      const changed = stepFurnace(state, RECIPES.values());
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
      dim: state.dimension,
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

  /** Mark liquids around a changed tile as needing a flow update. */
  private wakeLiquids(dimension: Dimension, x: number, y: number): void {
    const world = this.worldOf(dimension);
    for (const [nx, ny] of [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (blockDef(world.getBlock(nx, ny)).liquid) {
        this.liquidActive[dimension].add(`${nx},${ny}`);
      }
    }
  }

  /**
   * Terraria-style finite liquids: water and lava carry a fill level
   * (1..8); active cells fall into open space below, top up liquid
   * below, and equalize sideways one unit at a time. Lava updates on a
   * slower cadence than water. Water touching lava turns it to obsidian.
   */
  private stepLiquids(out: OutboundEvent[]): void {
    const BUDGET = 200;
    // No liquid kind is due this tick (water every 3, lava every 10):
    // skip the scan entirely, active cells just stay queued.
    if (this.tickCount % 3 !== 0 && this.tickCount % 10 !== 0) return;
    for (const dimension of ["overworld", "nether"] as const) {
      const active = this.liquidActive[dimension];
      if (active.size === 0) continue;
      const world = this.worldOf(dimension);

      // Cells often change several times per tick while liquid shuffles
      // around; clients only need one event with the final state.
      const touched = new Map<string, { x: number; y: number; before: BlockId }>();
      const setBlockTracked = (x: number, y: number, block: BlockId): void => {
        const key = `${x},${y}`;
        if (!touched.has(key)) {
          touched.set(key, { x, y, before: world.getBlockGenerating(x, y) });
        }
        world.setBlock(x, y, block);
      };

      const setLiquid = (x: number, y: number, kind: "water" | "lava", level: number): void => {
        const block = level <= 0 ? BlockId.Air : liquidBlock(kind, level);
        setBlockTracked(x, y, block);
        active.add(`${x},${y}`);
        this.wakeLiquids(dimension, x, y);
      };
      /** Open for liquid: not solid, not a liquid, not a slab. */
      const isOpen = (x: number, y: number): boolean => {
        const def = blockDef(world.getBlockGenerating(x, y));
        return !def.solid && def.liquid === undefined && !def.slab;
      };

      const cells = [...active];
      active.clear();
      let processed = 0;
      for (const key of cells) {
        if (processed >= BUDGET) {
          active.add(key); // keep the rest for the next tick
          continue;
        }
        const [xs, ys] = key.split(",");
        const x = Number(xs);
        const y = Number(ys);
        const def = blockDef(world.getBlockGenerating(x, y));
        const liquid = def.liquid;
        if (!liquid) continue;
        // Lava flows slower than water.
        const cadence = liquid.kind === "lava" ? 10 : 3;
        if (this.tickCount % cadence !== 0) {
          active.add(key);
          continue;
        }
        processed++;
        let level = liquid.level;

        // 1) Fall: everything drops into open space below...
        const belowDef = blockDef(world.getBlockGenerating(x, y + 1));
        if (isOpen(x, y + 1)) {
          setLiquid(x, y + 1, liquid.kind, level);
          setLiquid(x, y, liquid.kind, 0);
          continue;
        }
        // ...or tops up same-kind liquid below.
        if (belowDef.liquid?.kind === liquid.kind && belowDef.liquid.level < 8) {
          const transfer = Math.min(level, 8 - belowDef.liquid.level);
          setLiquid(x, y + 1, liquid.kind, belowDef.liquid.level + transfer);
          level -= transfer;
          setLiquid(x, y, liquid.kind, level);
          if (level === 0) continue;
        }
        // Water over lava (or vice versa): the contact hardens.
        if (belowDef.liquid && belowDef.liquid.kind !== liquid.kind) {
          setLiquid(x, y + 1, "water", 0);
          setBlockTracked(x, y + 1, BlockId.Obsidian);
        }

        // 2) Drain: prefer a neighbor that itself hangs over a drop, so
        // liquid keeps moving downhill (off ledges, down stairs) instead
        // of settling on a step above open space. Alternates the
        // preferred side per row so drainage looks symmetric.
        const order = (x + y) % 2 === 0 ? [-1, 1] : [1, -1];
        let drained = false;
        for (const dir of order) {
          const nx = x + dir;
          const neighborDef = blockDef(world.getBlockGenerating(nx, y));
          if (neighborDef.liquid && neighborDef.liquid.kind !== liquid.kind) {
            setBlockTracked(nx, y, BlockId.Obsidian);
            continue;
          }
          const neighborLevel = neighborDef.liquid?.kind === liquid.kind ? neighborDef.liquid.level : isOpen(nx, y) ? 0 : null;
          if (neighborLevel === null || neighborLevel >= 8) continue;
          const belowNeighbor = blockDef(world.getBlockGenerating(nx, y + 1));
          const drop =
            isOpen(nx, y + 1) || (belowNeighbor.liquid?.kind === liquid.kind && belowNeighbor.liquid.level < 8);
          if (drop) {
            setLiquid(nx, y, liquid.kind, neighborLevel + 1);
            level -= 1;
            setLiquid(x, y, liquid.kind, level);
            drained = true;
            break;
          }
        }
        if (drained) continue; // the neighbor falls on its own turn next.

        // 3) Level: flatten the resting run this cell belongs to (this
        // row only, bounded by walls or a drop on either side) by
        // spreading its total volume evenly. This is an exact solve
        // instead of one-unit-at-a-time diffusion, so pools settle
        // completely flat rather than getting stuck wherever
        // neighboring cells merely differ by 1 - which a pairwise rule
        // treats as "close enough" and a whole pond can end up as a
        // permanent staircase of such differences.
        if (level <= 0) continue;
        const restsHere = (cx: number): boolean => {
          const cdef = blockDef(world.getBlockGenerating(cx, y));
          const isSameLiquid = cdef.liquid?.kind === liquid.kind;
          if (!isSameLiquid && !isOpen(cx, y)) return false;
          const belowDef2 = blockDef(world.getBlockGenerating(cx, y + 1));
          const wouldFall = isOpen(cx, y + 1) || (belowDef2.liquid?.kind === liquid.kind && belowDef2.liquid.level < 8);
          return !wouldFall;
        };
        const MAX_RUN_RADIUS = 64;
        let left = x;
        while (left > x - MAX_RUN_RADIUS && restsHere(left - 1)) left--;
        let right = x;
        while (right < x + MAX_RUN_RADIUS && restsHere(right + 1)) right++;
        if (right === left) continue;
        let total = 0;
        for (let cx = left; cx <= right; cx++) {
          const cdef = blockDef(world.getBlockGenerating(cx, y));
          total += cdef.liquid?.kind === liquid.kind ? cdef.liquid.level : 0;
        }
        const count = right - left + 1;
        const base = Math.floor(total / count);
        let remainder = total - base * count;
        for (let cx = left; cx <= right; cx++) {
          const target = remainder > 0 ? base + 1 : base;
          if (remainder > 0) remainder--;
          const cdef = blockDef(world.getBlockGenerating(cx, y));
          const current = cdef.liquid?.kind === liquid.kind ? cdef.liquid.level : 0;
          if (current !== target) setLiquid(cx, y, liquid.kind, target);
        }
      }

      // One event per cell that actually ended up different.
      for (const { x, y, before } of touched.values()) {
        const block = world.getBlockGenerating(x, y);
        if (block !== before) {
          out.push({ event: { type: "block_changed", dim: dimension, x, y, block } });
        }
      }
    }
  }

  private stepMining(out: OutboundEvent[]): void {
    for (const p of this.playerEntities()) {
      const mining = p.mining;
      if (!mining) continue;
      const world = this.worldOf(p.dimension);

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

      // Background wall mining (hammer): only where the foreground is open.
      if (mining.wall) {
        const wall = world.getWallGenerating(mining.x, mining.y);
        const held = p.inventory[p.selected] ?? null;
        const tool = held ? itemDef(held.item)?.tool : undefined;
        if (
          wall === BlockId.Air ||
          blockDef(world.getBlockGenerating(mining.x, mining.y)).solid ||
          (!p.creative && tool?.kind !== "hammer")
        ) {
          clear();
          continue;
        }
        const total = p.creative
          ? 1
          : Math.max(1, Math.ceil(Math.max(1, blockDef(wall).hardness) / (tool?.speed ?? 1)));
        mining.progress++;
        if (mining.progress < total) {
          out.push({
            event: { type: "mining_progress", player: p.id, x: mining.x, y: mining.y, progress: mining.progress, total },
          });
          continue;
        }
        clear();
        world.setWall(mining.x, mining.y, BlockId.Air);
        out.push({ event: { type: "wall_changed", dim: p.dimension, x: mining.x, y: mining.y, block: BlockId.Air } });
        if (!p.creative) {
          const drops = blockDrops(wall);
          if (drops) this.spawnItem(p.dimension, mining.x + 0.5, mining.y + 0.75, drops, out);
        }
        continue;
      }

      const block = world.getBlockGenerating(mining.x, mining.y);
      if (block === BlockId.Air || blockDef(block).hardness < 0) {
        clear();
        continue;
      }

      const held = p.inventory[p.selected] ?? null;
      const total = p.creative ? 1 : miningTicks(block, held);
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
      if (world.setBlock(mining.x, mining.y, BlockId.Air)) {
        out.push({
          event: { type: "block_changed", dim: p.dimension, x: mining.x, y: mining.y, block: BlockId.Air },
        });
        this.wakeLiquids(p.dimension, mining.x, mining.y);
        // Doors span two tiles: breaking one half removes the other.
        if (blockDef(block).tall) {
          for (const dy of [-1, 1]) {
            if (world.getBlockGenerating(mining.x, mining.y + dy) === block) {
              world.setBlock(mining.x, mining.y + dy, BlockId.Air);
              out.push({
                event: { type: "block_changed", dim: p.dimension, x: mining.x, y: mining.y + dy, block: BlockId.Air },
              });
            }
          }
        }
        if (blockDef(block).furnace !== undefined) {
          const state = this.furnaces.get(furnaceKey(p.dimension, mining.x, mining.y));
          if (state) {
            for (const stack of [state.input, state.fuel, state.output]) {
              if (stack) addToInventory(p.inventory, stack.item, stack.count);
            }
            this.furnaces.delete(furnaceKey(p.dimension, mining.x, mining.y));
          }
        }
        const minedContainerSlots = blockDef(block).container;
        if (minedContainerSlots !== undefined) {
          // Materialize structure loot before spilling.
          const chest = this.ensureChest(p.dimension, mining.x, mining.y, minedContainerSlots);
          if (chest) {
            // Contents spill out as item entities, like Minecraft.
            for (const stack of chest.slots) {
              if (stack) this.spawnItem(p.dimension, mining.x + 0.5, mining.y + 0.5, stack, out);
            }
            this.chests.delete(furnaceKey(p.dimension, mining.x, mining.y));
          }
        }
        if (!p.creative && canHarvest(block, held)) {
          // Gravel sometimes yields flint instead, like Minecraft.
          const drops =
            block === BlockId.Gravel && this.rng() < 0.25
              ? { item: "flint", count: 1 }
              : blockDrops(block);
          if (drops) {
            this.spawnItem(p.dimension, mining.x + 0.5, mining.y + 0.75, drops, out);
          }
        }
        this.syncInventory(p, out);
      }
    }
  }

  private stepEntities(out: OutboundEvent[]): void {
    for (const entity of [...this.entities.values()]) {
      // Players are stepped separately (stepPlayers) - very different
      // physics (input-driven, creative flight, ...).
      if (isPlayerEntity(entity)) continue;
      const prevX = entity.x;
      const prevY = entity.y;
      const size = sizeOf(entity.kind);
      const world = this.worldOf(entity.dimension);

      if (isItemEntity(entity)) {
        entity.age++;
        if (entity.pickupDelay > 0) entity.pickupDelay--;
        if (entity.age >= ITEM_DESPAWN_TICKS) {
          this.removeEntity(entity.id, out);
          continue;
        }
        // Items burn up in lava.
        if (world.getBlockGenerating(Math.floor(entity.x), Math.floor(entity.y - 0.1)) === BlockId.Lava) {
          this.removeEntity(entity.id, out);
          continue;
        }
        entity.vx *= 0.85;
        if (Math.abs(entity.vx) < 0.005) entity.vx = 0;
        entity.vy = Math.min(entity.vy + GRAVITY, TERMINAL_VELOCITY);
        stepBody(world, entity, size.width, size.height);
        if (entity.pickupDelay === 0) {
          const taker = this.playerNearBox(entity.dimension, entity.x, entity.y - size.height / 2, ITEM_PICKUP_RADIUS);
          if (taker) {
            const leftover = addToInventory(taker.inventory, entity.stack.item, entity.stack.count);
            if (leftover === 0) {
              this.removeEntity(entity.id, out);
            } else {
              entity.stack = { item: entity.stack.item, count: leftover };
            }
            this.syncInventory(taker, out);
          }
        }
      } else if (isArrowEntity(entity)) {
        entity.ttl--;
        if (entity.ttl <= 0) {
          this.removeEntity(entity.id, out);
          continue;
        }
        entity.vy = Math.min(entity.vy + GRAVITY * 0.6, TERMINAL_VELOCITY);
        const beforeVx = entity.vx;
        stepBody(world, entity, size.width, size.height);
        // Stuck in a wall or floor: gone.
        if ((beforeVx !== 0 && entity.vx === 0) || entity.onGround) {
          this.removeEntity(entity.id, out);
          continue;
        }
        if (entity.owner !== undefined) {
          // Player-shot arrows hit mobs, not players.
          const mob = this.mobNear(entity.dimension, entity.x, entity.y, 0.3);
          if (mob) {
            mob.hurtCooldown = 0; // arrows always connect
            this.hurtMob(mob, entity.damage, out, entity.x - entity.vx * 5);
            this.removeEntity(entity.id, out);
            continue;
          }
        } else {
          const hit = this.playerNearBox(entity.dimension, entity.x, entity.y, 0.3);
          if (hit) {
            this.hurtPlayer(hit, entity.damage, out, entity.x - entity.vx * 5);
            this.removeEntity(entity.id, out);
            continue;
          }
        }
        if (entity.x !== prevX || entity.y !== prevY) {
          out.push({ event: { type: "entity_moved", id: entity.id, x: entity.x, y: entity.y } });
        }
        continue;
      } else {
        if (entity.hurtCooldown > 0) entity.hurtCooldown--;
        if (entity.attackCooldown > 0) entity.attackCooldown--;

        // Lava hurts mobs too.
        if (world.getBlockGenerating(Math.floor(entity.x), Math.floor(entity.y - 0.1)) === BlockId.Lava) {
          this.hurtMob(entity, 2, out);
          if (!this.entities.has(entity.id)) continue;
        }

        const mob = mobDef(entity.kind);

        // Daylight burning for undead (not in the nether).
        if (
          mob?.burnsInDaylight &&
          entity.dimension === "overworld" &&
          this.tickCount % 40 === 0 &&
          daylightFactor(this.timeOfDay) > 0.5 &&
          entity.y <= surfaceHeight(world.seed, Math.floor(entity.x))
        ) {
          this.hurtMob(entity, 1, out);
          if (!this.entities.has(entity.id)) continue;
        }

        let dir: -1 | 0 | 1 = 0;
        const target = this.nearestPlayer(entity.dimension, entity.x, entity.y);
        /** Is the target within followRange (and not comically far by
         * pure x-distance, for the tighter horizontal chase check)? */
        const approaching = (followRange: number): boolean =>
          target !== null && Math.abs(target.p.x - entity.x) <= followRange && target.dist <= followRange * 1.5;

        const melee = mob?.melee;
        const ranged = mob?.ranged;
        const explodes = mob?.explodes;
        if (melee) {
          if (target && approaching(melee.followRange)) {
            const dx = target.p.x - entity.x;
            dir = Math.abs(dx) > 0.4 ? (dx > 0 ? 1 : -1) : 0;
            if (entity.attackCooldown === 0 && this.entityTouchesPlayer(entity, target.p)) {
              entity.attackCooldown = melee.cooldown;
              this.hurtPlayer(target.p, melee.damage, out, entity.x);
            }
          }
        } else if (ranged) {
          if (target && target.dist <= ranged.range + 2) {
            const dx = target.p.x - entity.x;
            // Kite: back off when close, approach when far.
            dir =
              target.dist < ranged.kiteNear ? (dx > 0 ? -1 : 1) : target.dist > ranged.kiteFar ? (dx > 0 ? 1 : -1) : 0;
            if (entity.attackCooldown === 0 && target.dist <= ranged.range) {
              entity.attackCooldown = ranged.shootCooldown;
              this.shootArrow(entity, target.p, ranged.damage, out);
            }
          }
        } else if (explodes) {
          if (entity.fuse !== undefined && entity.fuse >= 0) {
            // Hissing: stand still and count down.
            entity.fuse--;
            if (entity.fuse < 0) {
              this.explode(entity, explodes, out);
              continue;
            }
          } else if (target && approaching(explodes.followRange)) {
            const dx = target.p.x - entity.x;
            dir = Math.abs(dx) > 0.4 ? (dx > 0 ? 1 : -1) : 0;
            if (target.dist <= explodes.triggerRange) {
              entity.fuse = explodes.fuseTicks;
            }
          }
        } else if (mob?.wanders) {
          entity.wanderTimer--;
          if (entity.wanderTimer <= 0) {
            const roll = this.rng();
            entity.wanderDir = roll < 0.4 ? 0 : roll < 0.7 ? 1 : -1;
            entity.wanderTimer = 40 + Math.floor(this.rng() * 80);
          }
          dir = entity.wanderDir;
        }

        entity.vx = dir * (mob?.speed ?? 0);
        if (world.getBlockGenerating(Math.floor(entity.x), Math.floor(entity.y)) === BlockId.SoulSand) {
          entity.vx *= 0.4;
        }
        entity.vy = Math.min(entity.vy + GRAVITY, TERMINAL_VELOCITY);
        stepBody(world, entity, size.width, size.height);
        if (dir !== 0 && entity.vx === 0 && entity.onGround) {
          entity.vy = JUMP_VELOCITY;
        }

        const nearest = this.nearestPlayer(entity.dimension, entity.x, entity.y);
        if (!nearest || nearest.dist > MOB_DESPAWN_RANGE) {
          this.removeEntity(entity.id, out);
          continue;
        }
      }

      if (entity.x !== prevX || entity.y !== prevY) {
        out.push({ event: { type: "entity_moved", id: entity.id, x: entity.x, y: entity.y } });
      }
    }
  }

  private stepSpawning(out: OutboundEvent[]): void {
    if (this.tickCount % 50 !== 0 || !this.hasPlayers()) return;
    let mobCount = 0;
    for (const e of this.entities.values()) {
      if (!isItemEntity(e) && !isPlayerEntity(e)) mobCount++;
    }
    if (mobCount >= MOB_CAP) return;

    const players = [...this.playerEntities()];
    const anchor = players[Math.floor(this.rng() * players.length)]!;
    const world = this.worldOf(anchor.dimension);
    const offset = 12 + Math.floor(this.rng() * 20);
    const x = Math.floor(anchor.x) + (this.rng() < 0.5 ? -offset : offset);

    const pickMob = (kinds: readonly MobKind[]): MobKind =>
      kinds[Math.floor(this.rng() * kinds.length)]!;

    const spawnInPocket = (yStart: number, yEnd: number, kind: MobKind): boolean => {
      for (let y = yStart; y < yEnd; y++) {
        const feetFree = world.getBlockGenerating(x, y - 1) === BlockId.Air;
        const headFree = world.getBlockGenerating(x, y - 2) === BlockId.Air;
        const floorSolid = blockDef(world.getBlockGenerating(x, y)).solid;
        if (feetFree && headFree && floorSolid) {
          this.spawnMob(kind, x + 0.5, y, out, anchor.dimension);
          return true;
        }
      }
      return false;
    };

    // Structure-anchored mobs (villagers move into houses): if a
    // structure with such a mob stands near the player and has no
    // instance around yet, one appears. Generalizes past just
    // villagers/houses to whatever a datapack mob declares via
    // spawn.near_structure.
    if (anchor.dimension === "overworld" && this.tickCount % 200 === 0) {
      const pcx = Math.floor(anchor.x / CHUNK_WIDTH);
      for (let cx = pcx - 2; cx <= pcx + 2; cx++) {
        for (let cy = -2; cy <= 3; cy++) {
          for (const placement of placementsNear(world.seed, "overworld", cx, cy)) {
            const residents = mobsNearStructure(placement.structure.id);
            if (residents.length === 0) continue;
            const homeX = placement.originX + 3.5;
            const homeY = placement.originY + 4;
            let occupied = false;
            for (const e of this.entities.values()) {
              if (residents.includes(e.kind) && Math.abs(e.x - homeX) < 20) occupied = true;
            }
            if (!occupied) {
              this.spawnMob(residents[0]!, homeX, homeY, out);
              return;
            }
          }
        }
      }
    }

    if (anchor.dimension === "nether") {
      const yStart = 10 + Math.floor(this.rng() * 50);
      spawnInPocket(yStart, yStart + 16, pickMob(spawnPool("nether_pocket")));
      return;
    }

    const surface = surfaceHeight(world.seed, x);
    const night = isNight(this.timeOfDay);
    const hostiles = spawnPool("hostile_surface");
    if (this.rng() < 0.5) {
      if (night) {
        // At night, hostile mobs rise on the surface instead of animals.
        const kind = pickMob(hostiles);
        const feetFree = world.getBlockGenerating(x, surface - 1) === BlockId.Air;
        const headFree = world.getBlockGenerating(x, surface - 2) === BlockId.Air;
        if (feetFree && headFree && blockDef(world.getBlockGenerating(x, surface)).solid) {
          this.spawnMob(kind, x + 0.5, surface, out);
        }
        return;
      }
      if (world.getBlockGenerating(x, surface) !== BlockId.Grass) return;
      const biome = biomeAt(world.seed, x);
      if (biome !== Biome.Plains && biome !== Biome.Forest) return;
      this.spawnMob(pickMob(spawnPool("grass_day")), x + 0.5, surface, out);
    } else {
      const yStart = surface + 6 + Math.floor(this.rng() * 40);
      spawnInPocket(yStart, yStart + 12, pickMob(hostiles));
    }
  }

  private stepPlayers(out: OutboundEvent[]): void {
    for (const p of this.playerEntities()) {
      const prevX = p.x;
      const prevY = p.y;
      const wasOnGround = p.onGround;
      const world = this.worldOf(p.dimension);

      if (p.hurtCooldown > 0) p.hurtCooldown--;
      if (p.attackCooldown > 0) p.attackCooldown--;

      // Potion effects tick down; expiry syncs the client.
      let effectsChanged = false;
      for (const key of Object.keys(p.effects)) {
        p.effects[key]!--;
        if (p.effects[key]! <= 0) {
          delete p.effects[key];
          effectsChanged = true;
        }
      }
      if (effectsChanged) {
        out.push({ to: p.id, event: { type: "player_effects", player: p.id, effects: { ...p.effects } } });
      }
      if (p.effects["regeneration"] !== undefined && this.tickCount % REGEN_EFFECT_INTERVAL === 0 && p.health < PLAYER_MAX_HEALTH) {
        p.health++;
        out.push({ to: p.id, event: { type: "player_health", player: p.id, health: p.health, max: PLAYER_MAX_HEALTH } });
      }

      const feetBlock = blockDef(world.getBlockGenerating(Math.floor(p.x), Math.floor(p.y - 0.1)));
      const headBlock = blockDef(
        world.getBlockGenerating(Math.floor(p.x), Math.floor(p.y - PLAYER_HEIGHT + 0.2)),
      );
      const swimming = feetBlock.liquid !== undefined && feetBlock.liquid.level >= 2;

      const speedFactor = p.effects["speed"] !== undefined ? SPEED_MULTIPLIER : 1;
      if (p.creative) {
        // Creative flight: no gravity; jump rises, down (shift) sinks.
        p.vx = p.input.dx * WALK_SPEED * 1.8 * speedFactor;
        p.vy = p.input.jump ? -0.35 : p.input.down === true ? 0.35 : 0;
        p.kbX = 0;
        p.fallDistance = 0;
        p.grapple = null;
      } else if (p.grapple) {
        // Grappling: pulled straight toward the anchor, gravity off.
        const g = p.grapple;
        const dx = g.x - p.x;
        const dy = g.y - (p.y - PLAYER_HEIGHT / 2);
        const dist = Math.hypot(dx, dy);
        g.ticks++;
        if (dist < 1 || g.ticks > 120) {
          p.grapple = null;
          p.vx = 0;
          p.vy = Math.min(p.vy, 0);
        } else {
          p.vx = (dx / dist) * GRAPPLE_SPEED;
          p.vy = (dy / dist) * GRAPPLE_SPEED;
          p.fallDistance = 0;
        }
      }
      if (!p.creative && !p.grapple) {
        p.vx = p.input.dx * WALK_SPEED * speedFactor + p.kbX;
        p.kbX *= 0.6;
        if (Math.abs(p.kbX) < 0.01) p.kbX = 0;
        if (world.getBlockGenerating(Math.floor(p.x), Math.floor(p.y)) === BlockId.SoulSand) {
          p.vx *= 0.4;
        }
        if (swimming) {
          // Liquids slow and carry: gentle sinking, holding jump swims up.
          const lava = feetBlock.liquid!.kind === "lava";
          p.vx *= lava ? 0.35 : 0.6;
          p.vy = Math.min(p.vy + (lava ? 0.02 : 0.03), lava ? 0.08 : 0.15);
          if (p.input.jump) p.vy = lava ? -0.1 : -0.22;
          p.fallDistance = 0;
        } else {
          if (p.input.jump && p.onGround) {
            p.vy = JUMP_VELOCITY;
            p.exhaustion += EXHAUST_JUMP;
          }
          p.vy = Math.min(p.vy + GRAVITY, TERMINAL_VELOCITY);

          // Elytra gliding: hold jump while falling with wings in the
          // inventory - slow descent, fast horizontal travel, no fall damage.
          if (
            !p.onGround &&
            p.input.jump &&
            p.vy > 0 &&
            p.inventory.some((s) => s?.item === "elytra")
          ) {
            p.vy = Math.min(p.vy, ELYTRA_SINK);
            p.vx = p.input.dx * WALK_SPEED * ELYTRA_GLIDE_BOOST * speedFactor + p.kbX;
            p.fallDistance = 0;
          }
        }
      }
      const beforeStepX = p.x;
      const beforeStepY = p.y;
      stepBody(world, p, PLAYER_WIDTH, PLAYER_HEIGHT);
      // A grapple that can't move you any further lets go.
      if (p.grapple && p.x === beforeStepX && p.y === beforeStepY) {
        p.grapple = null;
      }

      // Fall damage: accumulate while falling, apply on landing.
      if (p.y > prevY) {
        p.fallDistance += p.y - prevY;
      } else if (p.vy < 0) {
        p.fallDistance = 0;
      }
      if (p.onGround && !wasOnGround) {
        const excess = Math.floor(p.fallDistance - SAFE_FALL_TILES);
        p.fallDistance = 0;
        if (excess > 0) {
          p.hurtCooldown = 0;
          this.hurtPlayer(p, excess, out);
        }
      }

      // Lava.
      if (world.getBlockGenerating(Math.floor(p.x), Math.floor(p.y - 0.5)) === BlockId.Lava) {
        this.hurtPlayer(p, 2, out);
      }

      // Nether portals: standing next to one counts (2D adaptation).
      const inPortal = nearPortal(world, p.x, p.y - 0.9);
      if (inPortal) {
        if (p.portalCooldown === 0) {
          p.portalTicks++;
          if (p.portalTicks >= PORTAL_TICKS) {
            this.teleportThroughPortal(p, out);
          }
        }
      } else {
        p.portalTicks = 0;
        if (p.portalCooldown > 0) p.portalCooldown--;
      }

      // Diving: a fully submerged head drains the air supply; at zero,
      // drowning damage sets in (ignores i-frames on its own cadence).
      const headSubmerged = headBlock.liquid !== undefined && headBlock.liquid.level >= 6;
      if (!p.creative && headSubmerged) {
        p.air--;
        if (p.air >= 0 && p.air % 20 === 0) {
          out.push({ to: p.id, event: { type: "player_air", player: p.id, air: Math.max(0, p.air), max: MAX_AIR_TICKS } });
        }
        if (p.air <= 0 && this.tickCount % DROWN_DAMAGE_INTERVAL === 0) {
          p.hurtCooldown = 0;
          this.hurtPlayer(p, 2, out);
        }
      } else if (p.air < MAX_AIR_TICKS) {
        p.air = MAX_AIR_TICKS;
        out.push({ to: p.id, event: { type: "player_air", player: p.id, air: p.air, max: MAX_AIR_TICKS } });
      }

      // Eating in progress: finishes after the food's eat_ticks, as long
      // as the same item stays selected.
      if (p.eating) {
        const held = p.inventory[p.selected];
        if (!held || held.item !== p.eating.item) {
          p.eating = null;
        } else if (--p.eating.ticks <= 0) {
          p.eating = null;
          const food = itemDef(held.item)?.food;
          if (food && p.hunger < PLAYER_MAX_HUNGER) {
            held.count -= 1;
            if (held.count === 0) p.inventory[p.selected] = null;
            if (food.returns) addToInventory(p.inventory, food.returns, 1);
            p.hunger = Math.min(PLAYER_MAX_HUNGER, p.hunger + food.hunger);
            p.saturation = Math.min(p.hunger, p.saturation + food.saturation);
            this.syncInventory(p, out);
            out.push({ to: p.id, event: { type: "player_hunger", player: p.id, hunger: p.hunger, max: PLAYER_MAX_HUNGER } });
          }
        }
      }

      // Hunger: activity accumulates exhaustion, which drains saturation
      // first, then the bar itself (paused entirely in creative mode).
      if (!p.creative) {
        if (p.input.dx !== 0) p.exhaustion += EXHAUST_WALK;
        if (p.mining) p.exhaustion += EXHAUST_MINE;
      }
      if (p.exhaustion >= EXHAUSTION_PER_POINT) {
        p.exhaustion -= EXHAUSTION_PER_POINT;
        if (p.saturation > 0) {
          p.saturation--;
        } else if (p.hunger > 0) {
          p.hunger--;
          out.push({ to: p.id, event: { type: "player_hunger", player: p.id, hunger: p.hunger, max: PLAYER_MAX_HUNGER } });
        }
      }

      // Passive regeneration - only on a nearly full hunger bar, and
      // regenerating makes you hungrier (like Minecraft).
      if (
        this.tickCount % REGEN_INTERVAL_TICKS === 0 &&
        p.health > 0 &&
        p.health < PLAYER_MAX_HEALTH &&
        p.hunger >= HUNGER_REGEN_MIN
      ) {
        p.health++;
        p.exhaustion += EXHAUST_REGEN;
        out.push({ to: p.id, event: { type: "player_health", player: p.id, health: p.health, max: PLAYER_MAX_HEALTH } });
      }

      // Starving: an empty bar wears you down to 1 HP (never kills).
      if (
        !p.creative &&
        p.hunger === 0 &&
        this.tickCount % STARVE_INTERVAL_TICKS === 0 &&
        p.health > STARVE_MIN_HEALTH
      ) {
        this.hurtPlayer(p, 1, out);
      }

      if (p.x !== prevX || p.y !== prevY) {
        out.push({ event: { type: "player_moved", player: p.id, x: p.x, y: p.y } });
      }
    }
  }

  /** Broadcast facing/held-item changes - covers every way the selected
   * slot or offhand can change (crafting, mining, eating, drag-and-drop,
   * ...) without hooking each site individually. */
  private stepGearSync(out: OutboundEvent[]): void {
    for (const p of this.playerEntities()) {
      const current = {
        facing: p.facing,
        main: p.inventory[p.selected]?.item ?? null,
        off: p.offhand?.item ?? null,
      };
      const last = this.lastGear.get(p.id);
      if (last && last.facing === current.facing && last.main === current.main && last.off === current.off) {
        continue;
      }
      this.lastGear.set(p.id, current);
      out.push({ event: { type: "player_gear", player: p.id, ...current } });
    }
  }

  private teleportThroughPortal(p: PlayerEntity, out: OutboundEvent[]): void {
    const targetDim: Dimension = p.dimension === "overworld" ? "nether" : "overworld";
    const targetWorld = this.worldOf(targetDim);
    const xt = Math.round(p.dimension === "overworld" ? p.x / NETHER_SCALE : p.x * NETHER_SCALE);

    // Reuse a known portal nearby, otherwise build one.
    let arrival: { x: number; y: number } | null = null;
    for (const pos of this.portals[targetDim].values()) {
      if (Math.abs(pos.x - xt) <= 16 && (!arrival || Math.abs(pos.x - xt) < Math.abs(arrival.x - xt))) {
        arrival = pos;
      }
    }
    if (!arrival) {
      let by: number;
      if (targetDim === "nether") {
        // Find open floor space in the nether band, else carve at y=40.
        by = 40;
        for (let y = 10; y < LAVA_LEVEL - 4; y++) {
          const floorSolid = blockDef(targetWorld.getBlockGenerating(xt, y + 1)).solid;
          const space =
            targetWorld.getBlockGenerating(xt, y) === BlockId.Air &&
            targetWorld.getBlockGenerating(xt, y - 1) === BlockId.Air;
          if (floorSolid && space) {
            by = y;
            break;
          }
        }
      } else {
        by = surfaceHeight(targetWorld.seed, xt) - 1;
      }
      const changes = buildPortal(targetWorld, xt, by);
      for (const c of changes) {
        out.push({ event: { type: "block_changed", dim: targetDim, x: c.x, y: c.y, block: c.block } });
      }
      arrival = { x: xt, y: by };
      this.portals[targetDim].set(`${xt},${by}`, arrival);
    }

    p.dimension = targetDim;
    // Arrive beside the frame (in 2D the interior is walled off).
    p.x = arrival.x - 2.5;
    p.y = arrival.y + 1;
    p.vx = 0;
    p.vy = 0;
    p.kbX = 0;
    p.fallDistance = 0;
    p.portalTicks = 0;
    p.portalCooldown = PORTAL_COOLDOWN;
    p.mining = null;
    out.push({ event: { type: "player_dimension", player: p.id, dim: targetDim, x: p.x, y: p.y } });
  }

  /**
   * Shared health/cooldown bookkeeping for anything hurtable. PlayerEntity
   * and MobEntity both structurally carry {health, hurtCooldown}, so this
   * works for either without needing a common base class - this just
   * kills the duplicated cooldown/health math. Knockback and death
   * handling stay in each caller: players and mobs apply knockback
   * through different mechanisms (a decaying kbX overlay vs a direct vx
   * nudge) and diverge completely on death (respawn vs loot-and-despawn).
   */
  private applyDamageCore(
    target: { health: number; hurtCooldown: number },
    amount: number,
  ): { applied: boolean; lethal: boolean } {
    if (amount <= 0 || target.hurtCooldown > 0) return { applied: false, lethal: false };
    target.hurtCooldown = HURT_COOLDOWN_TICKS;
    target.health -= amount;
    return { applied: true, lethal: target.health <= 0 };
  }

  /** Mob armor/offhand absorb damage exactly like a player's would (see
   * hurtPlayer); unset for every built-in mob today, but a datapack mob
   * or Stage-6 equipped spawn can carry them (mobs.ts). */
  private hurtMob(entity: MobEntity, amount: number, out: OutboundEvent[], fromX?: number, knockback = 0.3): void {
    const armorAbsorb = entity.armor ? (itemDef(entity.armor.item)?.armor ?? 0) : 0;
    const shieldBlock = entity.offhand ? (itemDef(entity.offhand.item)?.shieldBlock ?? 0) : 0;
    const reduced =
      armorAbsorb > 0 || shieldBlock > 0
        ? Math.max(1, Math.round(amount * (1 - armorAbsorb) * (1 - shieldBlock)))
        : amount;
    const hit = this.applyDamageCore(entity, reduced);
    if (!hit.applied) return;
    if (fromX !== undefined) {
      entity.vx += (entity.x >= fromX ? 1 : -1) * knockback;
      entity.vy = Math.min(entity.vy, -0.2);
    }
    if (!hit.lethal) {
      out.push({ event: { type: "entity_hurt", id: entity.id, health: entity.health } });
      return;
    }
    for (const loot of mobDef(entity.kind)?.loot ?? []) {
      const roll = this.rng();
      const countRoll = this.rng();
      if (roll < loot.chance) {
        const count = 1 + Math.floor(countRoll * loot.max);
        this.spawnItem(entity.dimension, entity.x, entity.y - 0.5, { item: loot.item, count }, out);
      }
    }
    // Equipped/carrying mobs (Stage 6) drop their gear just like a player.
    if (entity.inventory) {
      for (const stack of entity.inventory) {
        if (stack) this.spawnItem(entity.dimension, entity.x, entity.y - 0.5, stack, out);
      }
    }
    if (entity.armor) this.spawnItem(entity.dimension, entity.x, entity.y - 0.5, entity.armor, out);
    if (entity.offhand) this.spawnItem(entity.dimension, entity.x, entity.y - 0.5, entity.offhand, out);
    out.push({ event: { type: "entity_died", id: entity.id, kind: entity.kind } });
    this.removeEntity(entity.id, out);
  }

  private shootArrow(from: MobEntity, target: PlayerEntity, damage: number, out: OutboundEvent[]): void {
    const originY = from.y - sizeOf(from.kind).height * 0.75;
    const dx = target.x - from.x;
    const dy = target.y - PLAYER_HEIGHT / 2 - originY;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const arrow: ArrowEntity = {
      id: this.nextId++,
      kind: "arrow",
      dimension: from.dimension,
      x: from.x + Math.sign(dx) * 0.5,
      y: originY,
      vx: (dx / dist) * 0.6,
      // Arc the shot slightly upward for the travel time.
      vy: (dy / dist) * 0.6 - dist * 0.015,
      onGround: false,
      damage,
      ttl: ARROW_TTL,
    };
    this.entities.set(arrow.id, arrow);
    out.push({
      event: { type: "entity_spawned", id: arrow.id, kind: "arrow", dim: arrow.dimension, x: arrow.x, y: arrow.y },
    });
  }

  private explode(creeper: MobEntity, def: ExplodesDef, out: OutboundEvent[]): void {
    const world = this.worldOf(creeper.dimension);
    const cx = creeper.x;
    const cy = creeper.y - sizeOf("creeper").height / 2;
    out.push({ event: { type: "entity_died", id: creeper.id, kind: creeper.kind } });
    this.removeEntity(creeper.id, out);

    // Blast a crater (tough blocks survive; nothing drops).
    const r = def.blockRadius;
    for (let ty = Math.floor(cy - r); ty <= Math.floor(cy + r); ty++) {
      for (let tx = Math.floor(cx - r); tx <= Math.floor(cx + r); tx++) {
        if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) > r) continue;
        const block = world.getBlockGenerating(tx, ty);
        const blockInfo = blockDef(block);
        if (block === BlockId.Air || blockInfo.hardness < 0 || blockInfo.hardness >= 100) continue;
        world.setBlock(tx, ty, BlockId.Air);
        out.push({ event: { type: "block_changed", dim: creeper.dimension, x: tx, y: ty, block: BlockId.Air } });
      }
    }

    // Hurt anything nearby, scaled by distance.
    for (const p of this.playerEntities()) {
      if (p.dimension !== creeper.dimension) continue;
      const dist = Math.hypot(p.x - cx, p.y - PLAYER_HEIGHT / 2 - cy);
      if (dist > def.damageRadius) continue;
      p.hurtCooldown = 0; // explosions pierce invulnerability frames
      this.hurtPlayer(p, Math.round(def.maxDamage * (1 - dist / def.damageRadius)), out, cx);
    }
    for (const other of this.entities.values()) {
      if (!isMobEntity(other)) continue;
      if (other.dimension !== creeper.dimension) continue;
      const dist = Math.hypot(other.x - cx, other.y - cy);
      if (dist > def.damageRadius) continue;
      other.hurtCooldown = 0;
      this.hurtMob(other, Math.round(def.maxDamage * (1 - dist / def.damageRadius)), out, cx);
    }
  }

  private nearestPlayer(dimension: Dimension, x: number, y: number): { p: PlayerEntity; dist: number } | null {
    let best: { p: PlayerEntity; dist: number } | null = null;
    for (const p of this.playerEntities()) {
      if (p.dimension !== dimension) continue;
      const dist = Math.hypot(p.x - x, p.y - PLAYER_HEIGHT / 2 - y);
      if (!best || dist < best.dist) best = { p, dist };
    }
    return best;
  }

  /** Mob whose AABB (expanded by radius) contains the point. */
  private mobNear(dimension: Dimension, x: number, y: number, radius: number): MobEntity | null {
    for (const entity of this.entities.values()) {
      if (!isMobEntity(entity)) continue;
      if (entity.dimension !== dimension) continue;
      const size = sizeOf(entity.kind);
      const dx = Math.max(0, Math.abs(x - entity.x) - size.width / 2);
      const top = entity.y - size.height;
      const dy = y < top ? top - y : y > entity.y ? y - entity.y : 0;
      if (Math.hypot(dx, dy) <= radius) return entity;
    }
    return null;
  }

  /** Player whose AABB (expanded by radius) contains the point. */
  private playerNearBox(dimension: Dimension, x: number, y: number, radius: number): PlayerEntity | null {
    for (const p of this.playerEntities()) {
      if (p.dimension !== dimension) continue;
      const dx = Math.max(0, Math.abs(x - p.x) - PLAYER_WIDTH / 2);
      const top = p.y - PLAYER_HEIGHT;
      const dy = y < top ? top - y : y > p.y ? y - p.y : 0;
      if (Math.hypot(dx, dy) <= radius) return p;
    }
    return null;
  }

  private entityTouchesPlayer(entity: MobEntity, p: PlayerEntity): boolean {
    const size = sizeOf(entity.kind);
    const overlapsX = Math.abs(entity.x - p.x) < (size.width + PLAYER_WIDTH) / 2 + 0.2;
    const overlapsY = entity.y > p.y - PLAYER_HEIGHT - 0.2 && entity.y - size.height < p.y + 0.2;
    return overlapsX && overlapsY;
  }

  private hurtPlayer(p: PlayerEntity, amount: number, out: OutboundEvent[], fromX?: number): void {
    if (p.creative) return;
    if (amount <= 0) return;
    // Armor absorbs a fraction; an offhand shield blocks another share.
    const armorAbsorb = p.armor ? (itemDef(p.armor.item)?.armor ?? 0) : 0;
    const shieldBlock = p.offhand ? (itemDef(p.offhand.item)?.shieldBlock ?? 0) : 0;
    const reduced = Math.max(1, Math.round(amount * (1 - armorAbsorb) * (1 - shieldBlock)));
    const hit = this.applyDamageCore(p, reduced);
    if (!hit.applied) return;
    if (fromX !== undefined) {
      p.kbX = (p.x >= fromX ? 1 : -1) * 0.35;
      p.vy = Math.min(p.vy, -0.2);
    }
    if (hit.lethal) {
      // Death: drop the inventory (and grid/cursor/armor/offhand) as
      // item entities, respawn at the overworld spawn.
      this.dumpGridAndCursor(p);
      for (let i = 0; i < p.inventory.length; i++) {
        const stack = p.inventory[i];
        if (stack) {
          this.spawnItem(p.dimension, p.x, p.y - 1, stack, out);
          p.inventory[i] = null;
        }
      }
      if (p.armor) {
        this.spawnItem(p.dimension, p.x, p.y - 1, p.armor, out);
        p.armor = null;
      }
      if (p.offhand) {
        this.spawnItem(p.dimension, p.x, p.y - 1, p.offhand, out);
        p.offhand = null;
      }
      p.grapple = null;
      const fromDim = p.dimension;
      const spawnX = findSpawnX(this.world.seed);
      p.dimension = "overworld";
      p.x = spawnX + 0.5;
      p.y = surfaceHeight(this.world.seed, spawnX);
      p.vx = 0;
      p.vy = 0;
      p.kbX = 0;
      p.fallDistance = 0;
      p.health = PLAYER_MAX_HEALTH;
      p.hunger = PLAYER_MAX_HUNGER;
      p.exhaustion = 0;
      p.saturation = 5;
      p.eating = null;
      p.mining = null;
      p.portalTicks = 0;
      p.portalCooldown = 0;
      out.push({ to: p.id, event: { type: "player_hunger", player: p.id, hunger: p.hunger, max: PLAYER_MAX_HUNGER } });
      if (fromDim !== "overworld") {
        out.push({ event: { type: "player_dimension", player: p.id, dim: "overworld", x: p.x, y: p.y } });
      } else {
        out.push({ event: { type: "player_moved", player: p.id, x: p.x, y: p.y } });
      }
      this.syncInventory(p, out);
    }
    out.push({ to: p.id, event: { type: "player_health", player: p.id, health: p.health, max: PLAYER_MAX_HEALTH } });
  }

  private syncInventory(p: PlayerEntity, out: OutboundEvent[]): void {
    out.push({
      to: p.id,
      event: {
        type: "inventory_changed",
        player: p.id,
        slots: cloneInventory(p.inventory),
        selected: p.selected,
        cursor: p.cursor ? { ...p.cursor } : null,
        craftGrid: cloneInventory(p.craftGrid),
        armor: p.armor ? structuredClone(p.armor) : null,
        offhand: p.offhand ? structuredClone(p.offhand) : null,
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
    const syncInventory = (p: PlayerEntity): void => {
      this.syncInventory(p, out);
    };

    switch (command.type) {
      case "join": {
        // One live player per name (names are identity for saves/rejoins).
        if ([...this.playerEntities()].some((p) => p.name === command.name)) {
          reject("name already in use");
          break;
        }
        // Tell the joiner who is already in the world.
        const replayPlayers = (): void => {
          for (const other of this.playerEntities()) {
            if (other.id === player) continue;
            reply({
              type: "player_joined",
              player: other.id,
              name: other.name,
              x: other.x,
              y: other.y,
              dim: other.dimension,
              color: other.color,
              facing: other.facing,
              main: other.inventory[other.selected]?.item ?? null,
              off: other.offhand?.item ?? null,
            });
          }
        };
        const chosenColor = sanitizeColor(command.color);
        // A returning player (same name) picks up exactly where they left.
        const saved = this.savedPlayers.get(command.name);
        if (saved) {
          this.savedPlayers.delete(command.name);
          const state: PlayerEntity = { ...structuredClone(saved), id: player };
          // Older saves lack newer fields; default them on adoption.
          state.hunger = Number.isFinite(state.hunger) ? state.hunger : PLAYER_MAX_HUNGER;
          state.exhaustion = Number.isFinite(state.exhaustion) ? state.exhaustion : 0;
          state.color = chosenColor ?? sanitizeColor(state.color) ?? DEFAULT_PLAYER_COLOR;
          state.armor = state.armor ?? null;
          state.offhand = state.offhand ?? null;
          state.saturation = Number.isFinite(state.saturation) ? state.saturation : 5;
          state.eating = null;
          state.grapple = null;
          state.creative = state.creative === true;
          state.air = Number.isFinite(state.air) ? state.air : MAX_AIR_TICKS;
          state.facing = state.facing === "left" ? "left" : "right";
          this.entities.set(player, state);
          const rejoinMain = state.inventory[state.selected]?.item ?? null;
          const rejoinOff = state.offhand?.item ?? null;
          this.lastGear.set(player, { facing: state.facing, main: rejoinMain, off: rejoinOff });
          broadcast({
            type: "player_joined",
            player,
            name: state.name,
            x: state.x,
            y: state.y,
            dim: state.dimension,
            color: state.color,
            facing: state.facing,
            main: rejoinMain,
            off: rejoinOff,
          });
          this.syncInventory(state, out);
          reply({ type: "player_health", player, health: state.health, max: PLAYER_MAX_HEALTH });
          reply({ type: "player_hunger", player, hunger: state.hunger, max: PLAYER_MAX_HUNGER });
          reply({ type: "time_changed", time: this.timeOfDay });
          reply({ type: "player_dimension", player, dim: state.dimension, x: state.x, y: state.y });
          replayPlayers();
          for (const entity of this.entities.values()) {
            if (isPlayerEntity(entity)) continue;
            reply({
              type: "entity_spawned",
              id: entity.id,
              kind: entity.kind,
              dim: entity.dimension,
              x: entity.x,
              y: entity.y,
              ...(isItemEntity(entity) ? { stack: { ...entity.stack } } : {}),
            });
          }
          break;
        }
        const spawnX = findSpawnX(this.world.seed);
        const x = spawnX + 0.5;
        const y = surfaceHeight(this.world.seed, spawnX);
        const state: PlayerEntity = {
          id: player,
          kind: "player",
          name: command.name,
          color: chosenColor ?? DEFAULT_PLAYER_COLOR,
          dimension: "overworld",
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
          health: PLAYER_MAX_HEALTH,
          hunger: PLAYER_MAX_HUNGER,
          exhaustion: 0,
          hurtCooldown: 0,
          attackCooldown: 0,
          kbX: 0,
          fallDistance: 0,
          effects: {},
          portalTicks: 0,
          portalCooldown: 0,
          saturation: 5,
          eating: null,
          armor: null,
          offhand: null,
          grapple: null,
          creative: false,
          air: MAX_AIR_TICKS,
          facing: "right",
        };
        this.entities.set(player, state);
        this.lastGear.set(player, { facing: state.facing, main: null, off: null });
        broadcast({
          type: "player_joined",
          player,
          name: state.name,
          x,
          y,
          dim: "overworld",
          color: state.color,
          facing: state.facing,
          main: null,
          off: null,
        });
        syncInventory(state);
        reply({ type: "player_health", player, health: state.health, max: PLAYER_MAX_HEALTH });
        reply({ type: "player_hunger", player, hunger: state.hunger, max: PLAYER_MAX_HUNGER });
        reply({ type: "time_changed", time: this.timeOfDay });
        replayPlayers();
        for (const entity of this.entities.values()) {
          if (isPlayerEntity(entity)) continue;
          reply({
            type: "entity_spawned",
            id: entity.id,
            kind: entity.kind,
            dim: entity.dimension,
            x: entity.x,
            y: entity.y,
            ...(isItemEntity(entity) ? { stack: { ...entity.stack } } : {}),
          });
        }
        break;
      }
      case "leave": {
        const p = this.getPlayer(player);
        if (p && this.entities.delete(player)) {
          // Keep the state for a future rejoin (and for saves).
          this.savedPlayers.set(p.name, p);
          this.lastGear.delete(player);
          broadcast({ type: "player_left", player });
        }
        break;
      }
      case "move": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (![-1, 0, 1].includes(command.dx) || typeof command.jump !== "boolean") {
          reject("invalid input");
          break;
        }
        p.input = { dx: command.dx, jump: command.jump, down: command.down === true };
        if (command.dx !== 0) p.facing = command.dx > 0 ? "right" : "left";
        break;
      }
      case "set_color": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const color = sanitizeColor(command.color);
        if (color === null) {
          reject("invalid color");
          break;
        }
        p.color = color;
        broadcast({ type: "player_color", player, color });
        break;
      }
      case "select_slot": {
        const p = this.getPlayer(player);
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
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const recipe = RECIPES.get(command.recipe);
        if (!recipe || recipe.kind === "smelting") {
          reject("unknown recipe");
          break;
        }
        if (recipe.kind === "brewing" && !this.blockNearby(p, BlockId.BrewingStand)) {
          reject("requires brewing stand");
          break;
        }
        if (recipe.kind === "crafting" && recipe.gridSize === 3 && !this.blockNearby(p, BlockId.CraftingTable)) {
          reject("requires crafting table");
          break;
        }
        // Ingredient keys may be tags ("#planks"): any member counts.
        for (const [key, count] of recipe.ingredients) {
          const available = ingredientOptions(key).reduce(
            (sum, item) => sum + countInInventory(p.inventory, item),
            0,
          );
          if (available < count) {
            reject("missing ingredients");
            return;
          }
        }
        for (const [key, count] of recipe.ingredients) {
          let remaining = count;
          for (const item of ingredientOptions(key)) {
            while (remaining > 0 && removeFromInventory(p.inventory, item, 1)) {
              remaining--;
            }
          }
        }
        addToInventory(p.inventory, recipe.result.item, recipe.result.count);
        syncInventory(p);
        break;
      }
      case "slot_click": {
        const p = this.getPlayer(player);
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
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        this.dumpGridAndCursor(p);
        syncInventory(p);
        break;
      }
      case "open_furnace": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        const furnaceDef = blockDef(this.worldOf(p.dimension).getBlockGenerating(x, y)).furnace;
        if (furnaceDef === undefined) {
          reject("no furnace there");
          break;
        }
        let state = this.furnaces.get(furnaceKey(p.dimension, x, y));
        if (!state) {
          state = createFurnace(p.dimension, x, y, furnaceDef.speed);
          this.furnaces.set(furnaceKey(p.dimension, x, y), state);
        }
        reply(this.furnaceEvent(state));
        break;
      }
      case "open_chest": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        const slots = blockDef(this.worldOf(p.dimension).getBlockGenerating(x, y)).container;
        if (slots === undefined) {
          reject("no chest there");
          break;
        }
        const chest = this.ensureChest(p.dimension, x, y, slots);
        reply({ type: "chest_changed", dim: p.dimension, x, y, slots: cloneInventory(chest.slots) });
        break;
      }
      case "request_chunk": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
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
        const chunk = this.worldOf(p.dimension).ensureChunk(cx, cy);
        reply({
          type: "chunk_data",
          dim: p.dimension,
          cx,
          cy,
          tiles: Array.from(chunk.tiles),
          walls: Array.from(chunk.walls),
        });
        break;
      }
      case "start_mining": {
        const p = this.getPlayer(player);
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
        const world = this.worldOf(p.dimension);
        const current = world.getBlockGenerating(x, y);
        const held = p.inventory[p.selected];
        const holdsHammer = held ? itemDef(held.item)?.tool?.kind === "hammer" : false;
        // A hammer aimed at open foreground mines the wall behind it.
        if (
          holdsHammer &&
          !blockDef(current).solid &&
          world.getWallGenerating(x, y) !== BlockId.Air
        ) {
          p.mining = { x, y, progress: 0, wall: true };
          break;
        }
        if (current === BlockId.Air || blockDef(current).hardness < 0) {
          reject("cannot mine");
          break;
        }
        p.mining = { x, y, progress: 0 };
        break;
      }
      case "stop_mining": {
        const p = this.getPlayer(player);
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
      case "attack": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (p.attackCooldown > 0) {
          break;
        }
        const entity = this.entities.get(command.entity);
        if (!entity || !isMobEntity(entity) || entity.dimension !== p.dimension) {
          reject("no such target");
          break;
        }
        const size = sizeOf(entity.kind);
        const dist = Math.hypot(entity.x - p.x, entity.y - size.height / 2 - (p.y - PLAYER_HEIGHT / 2));
        if (dist > ATTACK_REACH) {
          reject("out of reach");
          break;
        }
        p.attackCooldown = PLAYER_ATTACK_COOLDOWN;
        const held = p.inventory[p.selected] ?? null;
        const strength = p.effects["strength"] !== undefined ? STRENGTH_BONUS : 0;
        this.hurtMob(entity, attackDamage(held) + strength, out, p.x, attackKnockback(held));
        break;
      }
      case "trade": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const villager = this.entities.get(command.entity);
        if (!villager || villager.kind !== "villager" || villager.dimension !== p.dimension) {
          reject("no villager");
          break;
        }
        if (Math.hypot(villager.x - p.x, villager.y - p.y) > ATTACK_REACH + 1) {
          reject("out of reach");
          break;
        }
        const trade = TRADES[command.trade];
        if (!trade) {
          reject("unknown trade");
          break;
        }
        if (!removeFromInventory(p.inventory, trade.cost.item, trade.cost.count)) {
          reject("missing items");
          break;
        }
        addToInventory(p.inventory, trade.result.item, trade.result.count);
        syncInventory(p);
        break;
      }
      case "use_item": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const stack = p.inventory[p.selected];
        if (!stack) {
          reject("nothing to use");
          break;
        }
        const def = itemDef(stack.item);
        if (def?.effect) {
          // Potions apply instantly; the datapack decides the effect,
          // its duration and what stays behind (the bottle).
          stack.count -= 1;
          if (stack.count === 0) p.inventory[p.selected] = null;
          if (def.effect.returns) {
            addToInventory(p.inventory, def.effect.returns, 1);
          }
          p.effects[def.effect.id] = def.effect.ticks;
          syncInventory(p);
          reply({ type: "player_effects", player: p.id, effects: { ...p.effects } });
          break;
        }
        if (def?.food) {
          if (p.hunger >= PLAYER_MAX_HUNGER) {
            reject("not hungry");
            break;
          }
          // Eating takes the item's eat_ticks; finished in stepPlayers.
          if (!p.eating) {
            p.eating = { item: stack.item, ticks: def.food.eatTicks };
          }
          break;
        }
        reject("nothing to use");
        break;
      }
      case "shoot": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { dx, dy } = command;
        if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) {
          reject("invalid direction");
          break;
        }
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          reject("invalid direction");
          break;
        }
        if (p.inventory[p.selected]?.item !== "bow") {
          reject("no bow");
          break;
        }
        if (p.attackCooldown > 0) {
          break;
        }
        if (!removeFromInventory(p.inventory, "arrow", 1)) {
          reject("no arrows");
          break;
        }
        p.attackCooldown = BOW_COOLDOWN;
        const originY = p.y - PLAYER_HEIGHT * 0.6;
        const arrow: ArrowEntity = {
          id: this.nextId++,
          kind: "arrow",
          dimension: p.dimension,
          x: p.x + (dx / len) * 0.8,
          y: originY + (dy / len) * 0.8,
          vx: (dx / len) * BOW_ARROW_SPEED,
          vy: (dy / len) * BOW_ARROW_SPEED,
          onGround: false,
          damage: BOW_DAMAGE,
          ttl: ARROW_TTL,
          owner: player,
        };
        this.entities.set(arrow.id, arrow);
        broadcast({
          type: "entity_spawned",
          id: arrow.id,
          kind: "arrow",
          dim: arrow.dimension,
          x: arrow.x,
          y: arrow.y,
        });
        syncInventory(p);
        break;
      }
      case "enchant": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (!this.blockNearby(p, BlockId.EnchantingTable)) {
          reject("requires enchanting table");
          break;
        }
        const stack = p.inventory[p.selected];
        const enchId = stack ? enchantFor(stack) : null;
        if (!stack || !enchId) {
          reject("cannot enchant this");
          break;
        }
        const existing = stack.ench?.find((e) => e.id === enchId);
        if (existing && existing.level >= ENCHANT_MAX_LEVEL) {
          reject("already maxed");
          break;
        }
        if (!removeFromInventory(p.inventory, "lapis_lazuli", ENCHANT_LAPIS_COST)) {
          reject("missing lapis");
          break;
        }
        if (existing) {
          existing.level++;
        } else {
          stack.ench = [...(stack.ench ?? []), { id: enchId, level: 1 }];
        }
        syncInventory(p);
        break;
      }
      case "place_block": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y)) {
          reject("invalid coordinates");
          break;
        }
        const world = this.worldOf(p.dimension);
        const stack = p.inventory[p.selected];
        if (!stack) {
          reject("nothing to place");
          break;
        }
        if (!this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        // Flint and steel lights portals instead of placing a block.
        if (stack.item === "flint_and_steel") {
          const interior = findPortalInterior(world, x, y);
          if (!interior) {
            reject("no portal frame");
            break;
          }
          for (let ty = interior.top; ty <= interior.bottom; ty++) {
            for (let tx = interior.left; tx <= interior.right; tx++) {
              world.setBlock(tx, ty, BlockId.NetherPortal);
              broadcast({ type: "block_changed", dim: p.dimension, x: tx, y: ty, block: BlockId.NetherPortal });
            }
          }
          // Lit frames turn side-permeable so players can walk in.
          for (const change of convertFrame(world, interior)) {
            broadcast({ type: "block_changed", dim: p.dimension, x: change.x, y: change.y, block: change.block });
          }
          this.portals[p.dimension].set(`${interior.left},${interior.bottom}`, {
            x: interior.left,
            y: interior.bottom,
          });
          break;
        }
        const def = itemDef(stack.item);
        if (def?.block === undefined) {
          reject("item not placeable");
          break;
        }
        const consume = (): void => {
          if (!p.creative) {
            stack.count -= 1;
            if (stack.count === 0) p.inventory[p.selected] = null;
          }
          syncInventory(p);
        };
        const hasCardinal = (test: (nx: number, ny: number) => boolean): boolean =>
          test(x - 1, y) || test(x + 1, y) || test(x, y - 1) || test(x, y + 1);

        if (command.layer === "bg") {
          // Background walls: the wall slot must be free and at least one
          // cardinal neighbor must already have a wall.
          if (world.getWallGenerating(x, y) !== BlockId.Air) {
            reject("space occupied");
            break;
          }
          if (
            !p.creative &&
            !hasCardinal((nx, ny) => world.getWallGenerating(nx, ny) !== BlockId.Air)
          ) {
            reject("needs an adjacent wall");
            break;
          }
          if (world.setWall(x, y, def.block)) {
            broadcast({ type: "wall_changed", dim: p.dimension, x, y, block: def.block });
            consume();
          }
          break;
        }

        if (world.getBlockGenerating(x, y) !== BlockId.Air) {
          reject("space occupied");
          break;
        }
        // Foreground rule: a cardinal foreground block, or a wall behind
        // the target position.
        if (
          !p.creative &&
          world.getWallGenerating(x, y) === BlockId.Air &&
          !hasCardinal((nx, ny) => world.getBlockGenerating(nx, ny) !== BlockId.Air)
        ) {
          reject("needs support");
          break;
        }
        if (blockDef(def.block).solid && this.tileIntersectsAnyPlayer(p.dimension, x, y)) {
          reject("blocked by player");
          break;
        }
        // Doors occupy two tiles (placed tile + the one above).
        if (blockDef(def.block).tall) {
          if (world.getBlockGenerating(x, y - 1) !== BlockId.Air) {
            reject("needs headroom");
            break;
          }
          if (blockDef(def.block).solid && this.tileIntersectsAnyPlayer(p.dimension, x, y - 1)) {
            reject("blocked by player");
            break;
          }
          world.setBlock(x, y, def.block);
          world.setBlock(x, y - 1, def.block);
          broadcast({ type: "block_changed", dim: p.dimension, x, y, block: def.block });
          broadcast({ type: "block_changed", dim: p.dimension, x, y: y - 1, block: def.block });
          consume();
          break;
        }
        if (world.setBlock(x, y, def.block)) {
          broadcast({ type: "block_changed", dim: p.dimension, x, y, block: def.block });
          this.wakeLiquids(p.dimension, x, y);
          consume();
        }
        break;
      }
      case "use_block": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        const world = this.worldOf(p.dimension);
        const block = world.getBlockGenerating(x, y);
        const def = blockDef(block);
        if (def.toggleTo === undefined) {
          reject("nothing to use");
          break;
        }
        // Can't close a door/trapdoor onto somebody.
        const target = blockDef(def.toggleTo);
        const tiles: Array<[number, number]> = [[x, y]];
        if (def.tall) {
          for (const dy of [-1, 1]) {
            if (world.getBlockGenerating(x, y + dy) === block) tiles.push([x, y + dy]);
          }
        }
        if (target.solid && tiles.some(([tx, ty]) => this.tileIntersectsAnyPlayer(p.dimension, tx, ty))) {
          reject("blocked by player");
          break;
        }
        for (const [tx, ty] of tiles) {
          world.setBlock(tx, ty, def.toggleTo);
          broadcast({ type: "block_changed", dim: p.dimension, x: tx, y: ty, block: def.toggleTo });
        }
        break;
      }
      case "use_bucket": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const { x, y } = command;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(player, x, y)) {
          reject("out of reach");
          break;
        }
        const stack = p.inventory[p.selected];
        const capacity = stack ? itemDef(stack.item)?.bucket : undefined;
        if (!stack || capacity === undefined) {
          reject("no bucket");
          break;
        }
        const world = this.worldOf(p.dimension);
        const targetDef = blockDef(world.getBlockGenerating(x, y));
        const heldLiquid = stack.data?.liquid;
        const heldAmount = stack.data?.amount ?? 0;

        // Scoop: only full source tiles can be bucketed (matches the
        // liquid model's own source/flowing distinction), and only
        // into an empty bucket or one already carrying the same kind.
        if (
          targetDef.liquid?.level === 8 &&
          (heldLiquid === undefined || heldLiquid === targetDef.liquid.kind) &&
          heldAmount < capacity
        ) {
          world.setBlock(x, y, BlockId.Air);
          broadcast({ type: "block_changed", dim: p.dimension, x, y, block: BlockId.Air });
          this.wakeLiquids(p.dimension, x, y);
          stack.data = { ...stack.data, liquid: targetDef.liquid.kind, amount: heldAmount + 1 };
          syncInventory(p);
          break;
        }

        // Pour: onto open space, or topping up a non-full pool of the
        // same kind - always leaves a full source block, like a real
        // bucket, consuming exactly one charge.
        if (heldLiquid !== undefined && heldAmount > 0) {
          const isOpen = !targetDef.solid && targetDef.liquid === undefined && !targetDef.slab;
          const canPourInto = isOpen || (targetDef.liquid?.kind === heldLiquid && targetDef.liquid.level < 8);
          if (!canPourInto) {
            reject("cannot pour here");
            break;
          }
          const sourceBlock = liquidBlock(heldLiquid, 8);
          world.setBlock(x, y, sourceBlock);
          broadcast({ type: "block_changed", dim: p.dimension, x, y, block: sourceBlock });
          this.wakeLiquids(p.dimension, x, y);
          // Clay dissolves the moment it pours lava - every other tier
          // survives (copper and up don't melt).
          if (!p.creative && stack.item === "clay_bucket" && heldLiquid === "lava") {
            p.inventory[p.selected] = null;
          } else {
            const remaining = heldAmount - 1;
            stack.data = remaining > 0 ? { ...stack.data, amount: remaining } : undefined;
          }
          syncInventory(p);
          break;
        }

        reject("nothing to do");
        break;
      }
      case "grapple": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        const held = p.inventory[p.selected];
        const range = held ? itemDef(held.item)?.grapple : undefined;
        if (range === undefined) {
          reject("no grappling hook");
          break;
        }
        const { dx, dy } = command;
        if (typeof dx !== "number" || typeof dy !== "number" || !Number.isFinite(dx) || !Number.isFinite(dy)) {
          reject("invalid direction");
          break;
        }
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          reject("invalid direction");
          break;
        }
        // March the ray; anchor just before the first solid tile.
        const world = this.worldOf(p.dimension);
        const ox = p.x;
        const oy = p.y - PLAYER_HEIGHT / 2;
        let anchor: { x: number; y: number } | null = null;
        const step = 0.25;
        for (let d = step; d <= range; d += step) {
          const sx = ox + (dx / len) * d;
          const sy = oy + (dy / len) * d;
          if (blockDef(world.getBlockGenerating(Math.floor(sx), Math.floor(sy))).solid) {
            const back = d - step;
            anchor = { x: ox + (dx / len) * back, y: oy + (dy / len) * back };
            break;
          }
        }
        if (!anchor) {
          reject("no anchor in range");
          break;
        }
        p.grapple = { x: anchor.x, y: anchor.y, ticks: 0 };
        break;
      }
      case "set_creative": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        p.creative = command.on === true;
        if (!p.creative) p.vy = Math.min(p.vy, 0);
        reply({ type: "player_creative", player, on: p.creative });
        break;
      }
      case "creative_give": {
        const p = this.getPlayer(player);
        if (!p) {
          reject("not joined");
          break;
        }
        if (!p.creative) {
          reject("not in creative mode");
          break;
        }
        const def = itemDef(command.item);
        const count = Number(command.count);
        if (!def || !Number.isInteger(count) || count < 1 || count > 64) {
          reject("invalid item");
          break;
        }
        addToInventory(p.inventory, def.id, Math.min(count, def.maxStack));
        syncInventory(p);
        break;
      }
    }
  }

  private applySlotClick(
    p: PlayerEntity,
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
        if (
          p.cursor &&
          (p.cursor.item !== result.item ||
            p.cursor.count + result.count > (itemDef(result.item)?.maxStack ?? 64))
        ) {
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
      case "chest": {
        const { x, y } = slot;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(p.id, x, y)) {
          reject("out of reach");
          return;
        }
        const chestSlots = blockDef(this.worldOf(p.dimension).getBlockGenerating(x, y)).container;
        if (chestSlots === undefined) {
          reject("no chest there");
          return;
        }
        if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= chestSlots) {
          reject("invalid slot");
          return;
        }
        const chest = this.ensureChest(p.dimension, x, y, chestSlots);
        const result = clickStack(p.cursor, chest.slots[slot.index] ?? null, button);
        p.cursor = result.cursor;
        chest.slots[slot.index] = result.slot;
        broadcast({
          type: "chest_changed",
          dim: p.dimension,
          x,
          y,
          slots: cloneInventory(chest.slots),
        });
        return;
      }
      case "armor": {
        // Only armor items may be worn.
        if (p.cursor && itemDef(p.cursor.item)?.armor === undefined) {
          reject("not armor");
          return;
        }
        const result = clickStack(p.cursor, p.armor, button);
        p.cursor = result.cursor;
        p.armor = result.slot;
        return;
      }
      case "offhand": {
        const result = clickStack(p.cursor, p.offhand, button);
        p.cursor = result.cursor;
        p.offhand = result.slot;
        return;
      }
      case "backpack": {
        const held = p.inventory[p.selected];
        const capacity = held ? itemDef(held.item)?.container : undefined;
        if (!held || capacity === undefined) {
          reject("no container in hand");
          return;
        }
        if (!Number.isInteger(slot.index) || slot.index < 0 || slot.index >= capacity) {
          reject("invalid slot");
          return;
        }
        // No containers inside containers.
        if (p.cursor && itemDef(p.cursor.item)?.container !== undefined) {
          reject("container in container");
          return;
        }
        const makeSlots = (): (ItemStack | null)[] => new Array<ItemStack | null>(capacity).fill(null);
        held.data ??= { slots: makeSlots() };
        const containerSlots = (held.data.slots ??= makeSlots());
        const result = clickStack(p.cursor, containerSlots[slot.index] ?? null, button);
        p.cursor = result.cursor;
        containerSlots[slot.index] = result.slot;
        return;
      }
      case "furnace": {
        const { x, y } = slot;
        if (!Number.isInteger(x) || !Number.isInteger(y) || !this.withinReach(p.id, x, y)) {
          reject("out of reach");
          return;
        }
        const clickFurnaceDef = blockDef(this.worldOf(p.dimension).getBlockGenerating(x, y)).furnace;
        if (clickFurnaceDef === undefined) {
          reject("no furnace there");
          return;
        }
        let state = this.furnaces.get(furnaceKey(p.dimension, x, y));
        if (!state) {
          state = createFurnace(p.dimension, x, y, clickFurnaceDef.speed);
          this.furnaces.set(furnaceKey(p.dimension, x, y), state);
        }
        if (slot.slot === "output") {
          if (!state.output) return;
          if (p.cursor && p.cursor.item !== state.output.item) return;
          const maxStack = itemDef(state.output.item)?.maxStack ?? 64;
          const take = Math.min(state.output.count, maxStack - (p.cursor?.count ?? 0));
          if (take <= 0) return;
          p.cursor = { item: state.output.item, count: (p.cursor?.count ?? 0) + take };
          const rest = state.output.count - take;
          state.output = rest > 0 ? { item: state.output.item, count: rest } : null;
        } else if (slot.slot === "fuel") {
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

  private ensureChest(
    dimension: Dimension,
    x: number,
    y: number,
    slotCount: number,
  ): { dimension: Dimension; x: number; y: number; slots: (ItemStack | null)[] } {
    const key = furnaceKey(dimension, x, y);
    let chest = this.chests.get(key);
    if (!chest) {
      chest = { dimension, x, y, slots: new Array<ItemStack | null>(slotCount).fill(null) };
      // Structure chests come pre-filled with their rolled loot.
      const loot = structureLootAt(this.worldOf(dimension).seed, dimension, x, y);
      if (loot) {
        loot.forEach((stack, i) => {
          chest!.slots[i] = stack;
        });
      }
      this.chests.set(key, chest);
    }
    return chest;
  }

  private dumpGridAndCursor(p: PlayerEntity): void {
    for (let i = 0; i < CRAFT_GRID_SIZE; i++) {
      const cell = p.craftGrid[i];
      if (!cell) continue;
      addToInventory(p.inventory, cell.item, cell.count);
      p.craftGrid[i] = null;
    }
    if (p.cursor) {
      addToInventory(p.inventory, p.cursor.item, p.cursor.count);
      p.cursor = null;
    }
  }

  private withinReach(player: PlayerId, tileX: number, tileY: number): boolean {
    const p = this.getPlayer(player);
    if (!p) return false;
    const dx = tileX + 0.5 - p.x;
    const dy = tileY + 0.5 - (p.y - PLAYER_HEIGHT / 2);
    return dx * dx + dy * dy <= REACH * REACH;
  }

  private tileIntersectsAnyPlayer(dimension: Dimension, tileX: number, tileY: number): boolean {
    for (const p of this.playerEntities()) {
      if (p.dimension !== dimension) continue;
      const overlapsX = tileX + 1 > p.x - PLAYER_WIDTH / 2 && tileX < p.x + PLAYER_WIDTH / 2;
      const overlapsY = tileY + 1 > p.y - PLAYER_HEIGHT && tileY < p.y;
      if (overlapsX && overlapsY) return true;
    }
    return false;
  }

  private blockNearby(p: PlayerEntity, block: BlockId): boolean {
    const world = this.worldOf(p.dimension);
    const centerY = p.y - PLAYER_HEIGHT / 2;
    const minX = Math.floor(p.x - REACH);
    const maxX = Math.floor(p.x + REACH);
    const minY = Math.floor(centerY - REACH);
    const maxY = Math.floor(centerY + REACH);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        if (world.getBlock(tx, ty) === block) return true;
      }
    }
    return false;
  }
}
