import type { PlayerCommand, PlayerId, SlotRef } from "./commands.js";
import { dispatchCommand } from "./commands/registry.js";
import { runTickSystems } from "./systems/registry.js";
import type { OutboundEvent, SimEvent } from "./events.js";
import { CHUNK_HEIGHT, CHUNK_IDLE_EVICT_TICKS, CHUNK_WIDTH } from "./constants.js";
import { CRAFT_GRID_SIZE, matchGrid, SMALL_GRID_INDICES } from "./crafting/match.js";
import { DEFAULT_COOK_TICKS, fuelTicks, ingredientOptions } from "./crafting/recipe.js";
import { RECIPES } from "./crafting/registry.js";
import { createFurnace, furnaceIdle, furnaceKey, stepFurnace, type FurnaceState } from "./furnace.js";
import {
  ARROW_TTL,
  ATTACK_REACH,
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
import { mobDef, sizeOf, type ExplodesDef } from "./mobs.js";
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
import { liquidDef } from "./liquids.js";
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
  GRAVITY,
  JUMP_VELOCITY,
  PLAYER_HEIGHT,
  PLAYER_WIDTH,
  REACH,
  stepBody,
  TERMINAL_VELOCITY,
  WALK_SPEED,
} from "./physics.js";
import { tryActivateMultiblock } from "./multiblock.js";
import { buildPortal, nearPortal, portalConfig } from "./portal.js";
import type { SimSave } from "./save.js";
import { clickStack } from "./slots.js";
import { structureLootAt } from "./structures/place.js";
import { spawnGenerator } from "./spawning.js";
import { DAY_LENGTH, daylightFactor } from "./time.js";
import {
  allBlocks,
  blastResistanceOf,
  blockByName,
  blockDef,
  blockDrops,
  BlockId,
  liquidBlock,
  stationBlock,
} from "./world/block.js";
import { surfaceHeight } from "./world/gen.js";
import {
  allDimensionIds,
  defaultDimensionId,
  dimensionDef,
  generateArrival,
  generateDefaultSpawnPoint,
} from "./world/dimension.js";
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

/**
 * SimSave.worlds/.portals across the version-6 format change: pre-6
 * saves stored these as a fixed `{overworld: [...], nether: [...]}`
 * object (the per-dimension value being the raw chunk/position array
 * directly); version 6+ stores one `{dim, ...}` entry per registered
 * dimension instead, so a mod's own dimension round-trips the same way
 * the built-in two do. `raw` is deliberately untyped here - an on-disk
 * save's actual shape can predate whatever SimSave currently declares,
 * exactly like decodeChunk tolerating pre-RLE data elsewhere.
 */
function normalizeWorldsField(raw: unknown): SimSave["worlds"] {
  if (Array.isArray(raw)) return raw as SimSave["worlds"];
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, SimSave["worlds"][number]["chunks"]>).map(([dim, chunks]) => ({
      dim,
      chunks,
    }));
  }
  return [];
}

/** See normalizeWorldsField - same pre-version-6 migration, applied to
 * `portals` instead. */
function normalizePortalsField(raw: unknown): SimSave["portals"] {
  if (Array.isArray(raw)) return raw as SimSave["portals"];
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, SimSave["portals"][number]["positions"]>).map(
      ([dim, positions]) => ({ dim, positions }),
    );
  }
  return [];
}

/** Default body color for players who never picked one. */
export const DEFAULT_PLAYER_COLOR = 0x4868e0;

/** A valid 0xRRGGBB color, or null. */
export function sanitizeColor(value: unknown): number | null {
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
export const MAX_CHUNK_COORD = 1_000_000;

/**
 * The authoritative game simulation. Deterministic and tick-based:
 * given the same seed and the same command stream per tick, every instance
 * produces the identical state. It never touches DOM, time, Math.random or
 * any other ambient environment - all inputs arrive via commands.
 */
export class Simulation {
  /** One World per registered dimension (see world/dimension.ts) -
   * populated at construction from every dimension currently registered,
   * not a fixed overworld/nether pair, so a mod's own dimension gets a
   * World the same way the built-in two do. */
  readonly worlds = new Map<string, World>();
  readonly furnaces = new Map<string, FurnaceState>();
  /** Chest contents, keyed like furnaces: "dim:x,y". */
  readonly chests = new Map<string, { dimension: Dimension; x: number; y: number; slots: (ItemStack | null)[] }>();
  readonly entities = new Map<EntityId, Entity>();
  /** Known portal interiors (bottom-left of interior), per dimension -
   * use portalsOf(dimension) rather than indexing this directly. */
  readonly portals = new Map<string, Map<string, { x: number; y: number }>>();
  tickCount = 0;
  /** Time of day in ticks, 0..DAY_LENGTH (writable, e.g. for tests). */
  timeOfDay = 0;
  /** Liquid tiles that may need to flow, per dimension ("x,y"). */
  private readonly liquidActive = new Map<string, Set<string>>();

  readonly rng: Rng;
  private readonly rngState: RngState;
  /** Single allocator for both player and entity ids - they share one
   * id space, so a player and a mob can never collide. */
  private nextId: EntityId = 1;
  /** Disconnected players' state, by name, adopted on rejoin. */
  readonly savedPlayers = new Map<string, PlayerEntity>();
  /** Last facing/held-item state broadcast per player, to detect changes
   * without hooking every place inventory/offhand/facing can mutate. */
  readonly lastGear = new Map<PlayerId, { facing: "left" | "right"; main: string | null; off: string | null }>();

  constructor(seed: number) {
    for (const dim of allDimensionIds()) {
      this.worlds.set(dim, new World(seed, dim));
      this.portals.set(dim, new Map());
      this.liquidActive.set(dim, new Set());
    }
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

  getPlayer(id: PlayerId): PlayerEntity | undefined {
    const e = this.entities.get(id);
    return e && isPlayerEntity(e) ? e : undefined;
  }

  *playerEntities(): IterableIterator<PlayerEntity> {
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
      version: 6,
      blockPalette,
      seed: this.world.seed,
      tickCount: this.tickCount,
      timeOfDay: this.timeOfDay,
      rng: this.rngState.s,
      nextId: this.nextId,
      worlds: [...this.worlds.entries()].map(([dim, world]) => ({ dim, chunks: world.serializeChunks() })),
      furnaces: [...this.furnaces.values()].map((f) => structuredClone(f)),
      chests: [...this.chests.values()].map((c) => structuredClone(c)),
      portals: [...this.portals.entries()].map(([dim, positions]) => ({ dim, positions: [...positions.values()] })),
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
    // Every registered dimension's chunks/portals, whether it's already
    // in this run's registry or not - a dimension no longer registered
    // (a removed mod) is simply skipped below, not an error.
    for (const { dim, chunks } of normalizeWorldsField(save.worlds)) {
      sim.worlds.get(dim)?.loadChunks(chunks, remap);
    }
    for (const f of save.furnaces) {
      // Saves from before per-block furnace speed lack the field.
      sim.furnaces.set(furnaceKey(f.dimension, f.x, f.y), { ...structuredClone(f), speed: f.speed ?? 1 });
    }
    for (const c of save.chests ?? []) {
      sim.chests.set(furnaceKey(c.dimension, c.x, c.y), structuredClone(c));
    }
    for (const { dim, positions } of normalizePortalsField(save.portals)) {
      const portals = sim.portals.get(dim);
      if (!portals) continue;
      for (const pos of positions) {
        portals.set(`${pos.x},${pos.y}`, { ...pos });
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
    return this.worldOf("flatcraft:dimension:overworld");
  }

  worldOf(dimension: Dimension): World {
    const world = this.worlds.get(dimension);
    if (!world) throw new Error(`unknown dimension "${dimension}"`);
    return world;
  }

  /** Like worldOf, for the per-dimension known-portal-position index -
   * see the `portals` field's doc comment. */
  portalsOf(dimension: Dimension): Map<string, { x: number; y: number }> {
    const portals = this.portals.get(dimension);
    if (!portals) throw new Error(`unknown dimension "${dimension}"`);
    return portals;
  }

  /** Drops chunks that have gone unused for CHUNK_IDLE_EVICT_TICKS and
   * have no unsaved changes (see World.evictIdle) - a host with its own
   * save/autosave cadence calls this periodically (not every tick),
   * ideally right after a save so any chunks that were dirty a moment
   * ago are freshly clean and immediately eligible. Both dimensions are
   * swept together, since a long-running server can go idle in either
   * one independently. Returns the total number of chunks evicted, for
   * host-side logging. */
  evictIdleChunks(): number {
    let evicted = 0;
    for (const world of this.worlds.values()) {
      evicted += world.evictIdle(CHUNK_IDLE_EVICT_TICKS);
    }
    return evicted;
  }

  /** Reserve a player id for a new connection (embedded or remote). Draws
   * from the same id space as spawned entities, so a player and a mob
   * can never end up sharing an id. */
  allocatePlayerId(): PlayerId {
    return this.nextId++;
  }

  tick(commands: readonly PlayerCommand[]): OutboundEvent[] {
    const out: OutboundEvent[] = [];
    for (const world of this.worlds.values()) {
      world.setCurrentTick(this.tickCount);
    }
    for (const pc of commands) {
      this.apply(pc, out);
    }
    runTickSystems(this, out);
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

  spawnMob(kind: MobKind, x: number, y: number, out: OutboundEvent[], dimension: Dimension = "flatcraft:dimension:overworld"): MobEntity {
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

  stepFurnaces(out: OutboundEvent[]): void {
    for (const state of this.furnaces.values()) {
      const changed = stepFurnace(state, RECIPES.values());
      if (changed && (this.tickCount % 4 === 0 || furnaceIdle(state))) {
        out.push({ event: this.furnaceEvent(state) });
      }
    }
  }

  furnaceEvent(state: FurnaceState): SimEvent {
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

  /** Mark liquids around a changed tile as needing a flow update. Reads
   * via getBlockGenerating, not getBlock: a neighbor tile can fall in an
   * adjacent chunk that's gone idle and been evicted (see
   * World.evictIdle), and the plain getBlock would silently read that as
   * Air instead of loading it back in - exactly the kind of stale-read
   * gap eviction reintroduces wherever a World read doesn't force
   * residency. */
  wakeLiquids(dimension: Dimension, x: number, y: number): void {
    const world = this.worldOf(dimension);
    for (const [nx, ny] of [
      [x, y],
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (blockDef(world.getBlockGenerating(nx, ny)).liquid) {
        this.liquidActive.get(dimension)?.add(`${nx},${ny}`);
      }
    }
  }

  /**
   * Terraria-style finite liquids: water and lava carry a fill level
   * (1..8); active cells fall into open space below, top up liquid
   * below, and equalize sideways one unit at a time. Lava updates on a
   * slower cadence than water. Water touching lava turns it to obsidian.
   */
  stepLiquids(out: OutboundEvent[]): void {
    const BUDGET = 200;
    // No liquid kind is due this tick (water every 3, lava every 10):
    // skip the scan entirely, active cells just stay queued.
    if (this.tickCount % 3 !== 0 && this.tickCount % 10 !== 0) return;
    for (const [dimension, active] of this.liquidActive) {
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

  stepMining(out: OutboundEvent[]): void {
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
          const altDrop = blockDef(block).altDrop;
          const drops =
            altDrop && this.rng() < altDrop.chance
              ? { item: altDrop.item, count: altDrop.count }
              : blockDrops(block);
          if (drops) {
            this.spawnItem(p.dimension, mining.x + 0.5, mining.y + 0.75, drops, out);
          }
        }
        this.syncInventory(p, out);
      }
    }
  }

  stepEntities(out: OutboundEvent[]): void {
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

        // Daylight burning for undead, only where daylight exists at all.
        if (
          mob?.burnsInDaylight &&
          dimensionDef(entity.dimension)?.hasSky === true &&
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
        const entitySlow = blockDef(world.getBlockGenerating(Math.floor(entity.x), Math.floor(entity.y))).movementSlow;
        if (entitySlow !== undefined) entity.vx *= entitySlow;
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

  stepSpawning(out: OutboundEvent[]): void {
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

    const generatorId = dimensionDef(anchor.dimension)!.spawns;
    const generator = spawnGenerator(generatorId);
    if (!generator) throw new Error(`dimension "${anchor.dimension}" references unknown spawn generator "${generatorId}"`);
    generator({ sim: this, out, anchor, world, x, pickMob, spawnInPocket });
  }

  stepPlayers(out: OutboundEvent[]): void {
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
        const playerSlow = blockDef(world.getBlockGenerating(Math.floor(p.x), Math.floor(p.y))).movementSlow;
        if (playerSlow !== undefined) p.vx *= playerSlow;
        if (swimming) {
          // Liquids slow and carry: gentle sinking, holding jump swims up.
          const liquid = liquidDef(feetBlock.liquid!.kind);
          if (liquid) {
            p.vx *= liquid.swimSpeed;
            p.vy = Math.min(p.vy + liquid.sinkAccel, liquid.sinkCap);
            if (p.input.jump) p.vy = liquid.swimUpVelocity;
          }
          p.fallDistance = 0;
        } else {
          if (p.input.jump && p.onGround) {
            p.vy = JUMP_VELOCITY;
            p.exhaustion += EXHAUST_JUMP;
          }
          p.vy = Math.min(p.vy + GRAVITY, TERMINAL_VELOCITY);

          // Gliding: hold jump while falling with a glider item (e.g.
          // elytra) in the inventory - slow descent, fast horizontal
          // travel, no fall damage.
          if (!p.onGround && p.input.jump && p.vy > 0) {
            const glider = p.inventory.map((s) => (s ? itemDef(s.item)?.glider : undefined)).find(Boolean);
            if (glider) {
              p.vy = Math.min(p.vy, glider.sink);
              p.vx = p.input.dx * WALK_SPEED * glider.glideBoost * speedFactor + p.kbX;
              p.fallDistance = 0;
            }
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
          if (p.portalTicks >= portalConfig().ticks) {
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
  stepGearSync(out: OutboundEvent[]): void {
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
    const portal = dimensionDef(p.dimension)?.portal;
    // No outgoing portal link registered from here - a dimension without
    // one just can't be left this way (a modder's own multiblock could
    // still move players around through the command/multiblock APIs
    // directly).
    if (!portal) return;
    const targetDim: Dimension = portal.to;
    const targetWorld = this.worldOf(targetDim);
    const xt = Math.round(p.x * portal.scale);

    // Reuse a known portal nearby, otherwise build one.
    let arrival: { x: number; y: number } | null = null;
    for (const pos of this.portalsOf(targetDim).values()) {
      if (Math.abs(pos.x - xt) <= 16 && (!arrival || Math.abs(pos.x - xt) < Math.abs(arrival.x - xt))) {
        arrival = pos;
      }
    }
    if (!arrival) {
      const by = generateArrival(targetDim, targetWorld, xt);
      const changes = buildPortal(targetWorld, xt, by);
      for (const c of changes) {
        out.push({ event: { type: "block_changed", dim: targetDim, x: c.x, y: c.y, block: c.block } });
      }
      arrival = { x: xt, y: by };
      this.portalsOf(targetDim).set(`${xt},${by}`, arrival);
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
    p.portalCooldown = portalConfig().cooldown;
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
  hurtMob(entity: MobEntity, amount: number, out: OutboundEvent[], fromX?: number, knockback = 0.3): void {
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
    const cy = creeper.y - sizeOf(creeper.kind).height / 2;
    out.push({ event: { type: "entity_died", id: creeper.id, kind: creeper.kind } });
    this.removeEntity(creeper.id, out);

    // Blast a crater (tough blocks survive; nothing drops).
    const r = def.blockRadius;
    for (let ty = Math.floor(cy - r); ty <= Math.floor(cy + r); ty++) {
      for (let tx = Math.floor(cx - r); tx <= Math.floor(cx + r); tx++) {
        if (Math.hypot(tx + 0.5 - cx, ty + 0.5 - cy) > r) continue;
        const block = world.getBlockGenerating(tx, ty);
        if (block === BlockId.Air || blockDef(block).hardness < 0 || blastResistanceOf(block) >= 100) continue;
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
      const defaultDim = defaultDimensionId();
      const point = generateDefaultSpawnPoint(this.worldOf(defaultDim).seed);
      p.dimension = defaultDim;
      p.x = point.x;
      p.y = point.y;
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
      if (fromDim !== defaultDim) {
        out.push({ event: { type: "player_dimension", player: p.id, dim: defaultDim, x: p.x, y: p.y } });
      } else {
        out.push({ event: { type: "player_moved", player: p.id, x: p.x, y: p.y } });
      }
      this.syncInventory(p, out);
    }
    out.push({ to: p.id, event: { type: "player_health", player: p.id, health: p.health, max: PLAYER_MAX_HEALTH } });
  }

  syncInventory(p: PlayerEntity, out: OutboundEvent[]): void {
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

  /** Applies one command by dispatching to its registered handler (see
   * commands/registry.ts) - every command type, including FlatCraft's
   * own built-ins, goes through the same registry a plugin's handler
   * would. */
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
    dispatchCommand({ sim: this, player, command, out, broadcast, reply, reject });
  }

  applySlotClick(
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
        const craftingTable = stationBlock("crafting_table");
        const tableNearby = craftingTable !== undefined && this.blockNearby(p, craftingTable);
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
        const craftingTable = stationBlock("crafting_table");
        const maxSize = craftingTable !== undefined && this.blockNearby(p, craftingTable) ? 3 : 2;
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

  ensureChest(
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
      this.worldOf(dimension).touchChunk(Math.floor(x / CHUNK_WIDTH), Math.floor(y / CHUNK_HEIGHT));
    }
    return chest;
  }

  dumpGridAndCursor(p: PlayerEntity): void {
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

  withinReach(player: PlayerId, tileX: number, tileY: number): boolean {
    const p = this.getPlayer(player);
    if (!p) return false;
    const dx = tileX + 0.5 - p.x;
    const dy = tileY + 0.5 - (p.y - PLAYER_HEIGHT / 2);
    return dx * dx + dy * dy <= REACH * REACH;
  }

  tileIntersectsAnyPlayer(dimension: Dimension, tileX: number, tileY: number): boolean {
    for (const p of this.playerEntities()) {
      if (p.dimension !== dimension) continue;
      const overlapsX = tileX + 1 > p.x - PLAYER_WIDTH / 2 && tileX < p.x + PLAYER_WIDTH / 2;
      const overlapsY = tileY + 1 > p.y - PLAYER_HEIGHT && tileY < p.y;
      if (overlapsX && overlapsY) return true;
    }
    return false;
  }

  blockNearby(p: PlayerEntity, block: BlockId): boolean {
    const world = this.worldOf(p.dimension);
    const centerY = p.y - PLAYER_HEIGHT / 2;
    const minX = Math.floor(p.x - REACH);
    const maxX = Math.floor(p.x + REACH);
    const minY = Math.floor(centerY - REACH);
    const maxY = Math.floor(centerY + REACH);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        // getBlockGenerating, not getBlock: REACH can poke into a
        // neighboring chunk that's idle-evicted (see World.evictIdle)
        // without a player ever having stood in it directly.
        if (world.getBlockGenerating(tx, ty) === block) return true;
      }
    }
    return false;
  }
}
